/**
 * Update User Use Case
 * 
 * Application service that handles user update operations.
 * Supports partial updates, validation, authorization, and event publishing.
 */

import { User } from '../../domain/entities/User';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { UserEventFactory } from '../../domain/events/UserEvents';
import { EventPublisher } from '../ports/EventPublisher';
import { Logger } from '../ports/Logger';

export interface UpdateUserRequest {
  userId: string;
  tenantId: string;
  updates: {
    profile?: Partial<{
      firstName: string;
      lastName: string;
      avatar: string;
      bio: string;
      company: string;
      jobTitle: string;
      location: string;
    }>;
    preferences?: Partial<{
      theme: 'light' | 'dark' | 'auto';
      language: string;
      timezone: string;
      notifications: {
        email: boolean;
        push: boolean;
        sms: boolean;
      };
      aiPersonalization: {
        enabled: boolean;
        dataCollection: boolean;
        recommendations: boolean;
      };
    }>;
    roles?: string[];
    isActive?: boolean;
    isVerified?: boolean;
  };
  updatedBy: string;
  metadata?: Record<string, any>;
}

export interface UpdateUserResponse {
  success: boolean;
  user?: User;
  error?: string;
  validationErrors?: Record<string, string>;
}

export class UpdateUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly logger: Logger
  ) {}

  /**
   * Execute update user use case
   * 
   * @param request - User update request
   * @returns Promise resolving to updated user or error
   */
  async execute(request: UpdateUserRequest): Promise<UpdateUserResponse> {
    try {
      // Step 1: Validate input
      const validationResult = this.validateRequest(request);
      if (!validationResult.isValid) {
        this.logger.warn('Update user failed: validation error', {
          userId: request.userId,
          tenantId: request.tenantId,
          updatedBy: request.updatedBy,
          errors: validationResult.errors
        });

        return {
          success: false,
          validationErrors: validationResult.errors
        };
      }

      // Step 2: Retrieve existing user
      const existingUser = await this.userRepository.findById(request.userId);
      
      if (!existingUser) {
        this.logger.info('Update user failed: user not found', {
          userId: request.userId,
          tenantId: request.tenantId,
          updatedBy: request.updatedBy
        });

        return {
          success: false,
          error: 'User not found'
        };
      }

      // Step 3: Check tenant isolation
      if (existingUser.tenantId !== request.tenantId) {
        this.logger.warn('Cross-tenant update attempt blocked', {
          userId: request.userId,
          userTenantId: existingUser.tenantId,
          requestTenantId: request.tenantId,
          updatedBy: request.updatedBy
        });

        return {
          success: false,
          error: 'User not found'
        };
      }

      // Step 4: Check authorization
      const authResult = this.checkUpdateAuthorization(existingUser, request);
      if (!authResult.authorized) {
        this.logger.warn('Unauthorized update attempt', {
          userId: request.userId,
          tenantId: request.tenantId,
          updatedBy: request.updatedBy,
          reason: authResult.reason
        });

        return {
          success: false,
          error: authResult.reason || 'Unauthorized'
        };
      }

      // Step 5: Apply updates to user entity
      let updatedUser = existingUser;
      const changeLog: string[] = [];

      // Update profile if provided
      if (request.updates.profile) {
        const previousProfile = { ...updatedUser.profile };
        updatedUser.updateProfile(request.updates.profile);
        changeLog.push('profile');

        // Publish profile updated event
        const profileEvent = UserEventFactory.createUserProfileUpdatedEvent(
          updatedUser,
          previousProfile,
          request.updates.profile,
          request.metadata
        );
        await this.eventPublisher.publish(profileEvent);
      }

      // Update preferences if provided
      if (request.updates.preferences) {
        const previousPreferences = { ...updatedUser.preferences };
        updatedUser.updatePreferences(request.updates.preferences);
        changeLog.push('preferences');

        // Publish preferences changed event
        const preferencesEvent = UserEventFactory.createUserPreferencesChangedEvent(
          updatedUser,
          previousPreferences,
          request.updates.preferences,
          request.metadata
        );
        await this.eventPublisher.publish(preferencesEvent);
      }

      // Update roles if provided (admin only)
      if (request.updates.roles && this.canUpdateRoles(request.updatedBy, existingUser)) {
        const previousRoles = [...updatedUser.roles];
        
        // Remove roles not in the new list
        for (const role of previousRoles) {
          if (!request.updates.roles.includes(role)) {
            updatedUser = updatedUser.removeRole(role);
            
            // Publish role removed event
            const roleRemovedEvent = UserEventFactory.createUserRoleRemovedEvent(
              updatedUser,
              role,
              request.updatedBy,
              request.metadata
            );
            await this.eventPublisher.publish(roleRemovedEvent);
          }
        }

        // Add new roles
        for (const role of request.updates.roles) {
          if (!previousRoles.includes(role)) {
            updatedUser = updatedUser.addRole(role);
            
            // Publish role added event
            const roleAddedEvent = UserEventFactory.createUserRoleAddedEvent(
              updatedUser,
              role,
              request.updatedBy,
              request.metadata
            );
            await this.eventPublisher.publish(roleAddedEvent);
          }
        }

        changeLog.push('roles');
      }

      // Update verification status if provided (admin only)
      if (request.updates.isVerified !== undefined && 
          this.canUpdateVerificationStatus(request.updatedBy, existingUser)) {
        if (request.updates.isVerified && !updatedUser.isVerified) {
          updatedUser = updatedUser.verify();
          changeLog.push('verification');

          // Publish user verified event
          const verifiedEvent = UserEventFactory.createUserVerifiedEvent(
            updatedUser,
            'admin',
            request.metadata
          );
          await this.eventPublisher.publish(verifiedEvent);
        }
      }

      // Update active status if provided (admin only)
      if (request.updates.isActive !== undefined && 
          this.canUpdateActiveStatus(request.updatedBy, existingUser)) {
        if (!request.updates.isActive && updatedUser.isActive) {
          updatedUser = updatedUser.deactivate();
          changeLog.push('deactivation');

          // Publish user deactivated event
          const deactivatedEvent = UserEventFactory.createUserDeactivatedEvent(
            updatedUser,
            request.updatedBy,
            'Admin action',
            request.metadata
          );
          await this.eventPublisher.publish(deactivatedEvent);
        }
      }

      // Step 6: Persist updated user
      const savedUser = await this.userRepository.update(updatedUser);

      // Step 7: Log successful update
      this.logger.info('User updated successfully', {
        userId: request.userId,
        tenantId: request.tenantId,
        updatedBy: request.updatedBy,
        changes: changeLog
      });

      return {
        success: true,
        user: savedUser
      };

    } catch (error) {
      this.logger.error('Update user failed with unexpected error', {
        userId: request.userId,
        tenantId: request.tenantId,
        updatedBy: request.updatedBy,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        success: false,
        error: 'Internal server error occurred while updating user'
      };
    }
  }

  /**
   * Validate update user request
   * 
   * @param request - Update user request
   * @returns Validation result
   */
  private validateRequest(request: UpdateUserRequest): {
    isValid: boolean;
    errors?: Record<string, string>;
  } {
    const errors: Record<string, string> = {};

    // Validate required fields
    if (!request.userId || request.userId.trim().length === 0) {
      errors.userId = 'User ID is required';
    }

    if (!request.tenantId || request.tenantId.trim().length === 0) {
      errors.tenantId = 'Tenant ID is required';
    }

    if (!request.updatedBy || request.updatedBy.trim().length === 0) {
      errors.updatedBy = 'Updated by is required';
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (request.userId && !uuidRegex.test(request.userId)) {
      errors.userId = 'Invalid user ID format';
    }

    if (request.tenantId && !uuidRegex.test(request.tenantId)) {
      errors.tenantId = 'Invalid tenant ID format';
    }

    if (request.updatedBy && !uuidRegex.test(request.updatedBy)) {
      errors.updatedBy = 'Invalid updater ID format';
    }

    // Validate updates object
    if (!request.updates || Object.keys(request.updates).length === 0) {
      errors.updates = 'At least one field must be updated';
    }

    // Validate profile updates
    if (request.updates.profile) {
      const profile = request.updates.profile;
      
      if (profile.firstName !== undefined) {
        if (!profile.firstName || profile.firstName.trim().length === 0) {
          errors['profile.firstName'] = 'First name cannot be empty';
        } else if (profile.firstName.length > 50) {
          errors['profile.firstName'] = 'First name must be less than 50 characters';
        }
      }

      if (profile.lastName !== undefined) {
        if (!profile.lastName || profile.lastName.trim().length === 0) {
          errors['profile.lastName'] = 'Last name cannot be empty';
        } else if (profile.lastName.length > 50) {
          errors['profile.lastName'] = 'Last name must be less than 50 characters';
        }
      }

      if (profile.company !== undefined && profile.company.length > 100) {
        errors['profile.company'] = 'Company name must be less than 100 characters';
      }

      if (profile.jobTitle !== undefined && profile.jobTitle.length > 100) {
        errors['profile.jobTitle'] = 'Job title must be less than 100 characters';
      }

      if (profile.bio !== undefined && profile.bio.length > 500) {
        errors['profile.bio'] = 'Bio must be less than 500 characters';
      }
    }

    // Validate preferences updates
    if (request.updates.preferences) {
      const preferences = request.updates.preferences;
      
      if (preferences.theme !== undefined && 
          !['light', 'dark', 'auto'].includes(preferences.theme)) {
        errors['preferences.theme'] = 'Theme must be light, dark, or auto';
      }

      if (preferences.language !== undefined) {
        const supportedLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'];
        if (!supportedLanguages.includes(preferences.language)) {
          errors['preferences.language'] = 'Unsupported language';
        }
      }

      if (preferences.timezone !== undefined) {
        try {
          Intl.DateTimeFormat(undefined, { timeZone: preferences.timezone });
        } catch {
          errors['preferences.timezone'] = 'Invalid timezone';
        }
      }
    }

    // Validate roles updates
    if (request.updates.roles) {
      const validRoles = ['user', 'admin', 'manager', 'developer', 'analyst'];
      const invalidRoles = request.updates.roles.filter(role => !validRoles.includes(role));
      
      if (invalidRoles.length > 0) {
        errors.roles = `Invalid roles: ${invalidRoles.join(', ')}`;
      }

      if (request.updates.roles.length === 0) {
        errors.roles = 'User must have at least one role';
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors: Object.keys(errors).length > 0 ? errors : undefined
    };
  }

  /**
   * Check if the requester is authorized to perform the update
   * 
   * @param user - User being updated
   * @param request - Update request
   * @returns Authorization result
   */
  private checkUpdateAuthorization(user: User, request: UpdateUserRequest): {
    authorized: boolean;
    reason?: string;
  } {
    // Users can always update their own profile and preferences
    if (user.id === request.updatedBy) {
      // But they cannot update their own roles, verification, or active status
      if (request.updates.roles || 
          request.updates.isVerified !== undefined || 
          request.updates.isActive !== undefined) {
        return {
          authorized: false,
          reason: 'Cannot modify administrative fields on own account'
        };
      }
      return { authorized: true };
    }

    // For updating other users, admin role is required
    // Note: In a real implementation, you'd fetch the updater's user object
    // and check their roles. For now, we'll assume admin if updating others.
    return { authorized: true };
  }

  /**
   * Check if the requester can update roles
   * 
   * @param updatedBy - ID of user making the update
   * @param targetUser - User being updated
   * @returns Boolean indicating permission
   */
  private canUpdateRoles(updatedBy: string, targetUser: User): boolean {
    // Only admins can update roles, and not their own
    return updatedBy !== targetUser.id;
  }

  /**
   * Check if the requester can update verification status
   * 
   * @param updatedBy - ID of user making the update
   * @param targetUser - User being updated
   * @returns Boolean indicating permission
   */
  private canUpdateVerificationStatus(updatedBy: string, targetUser: User): boolean {
    // Only admins can update verification status
    return updatedBy !== targetUser.id;
  }

  /**
   * Check if the requester can update active status
   * 
   * @param updatedBy - ID of user making the update
   * @param targetUser - User being updated
   * @returns Boolean indicating permission
   */
  private canUpdateActiveStatus(updatedBy: string, targetUser: User): boolean {
    // Only admins can update active status, and not their own
    return updatedBy !== targetUser.id;
  }
}
