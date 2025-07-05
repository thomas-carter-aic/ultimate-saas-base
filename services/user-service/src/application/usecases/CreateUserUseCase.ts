/**
 * Create User Use Case
 * 
 * Application service that orchestrates user creation business logic.
 * This use case handles the complete user creation workflow including
 * validation, password hashing, event publishing, and AI personalization setup.
 */

import bcrypt from 'bcryptjs';
import { User, UserProfile } from '../../domain/entities/User';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { UserEventFactory } from '../../domain/events/UserEvents';
import { EventPublisher } from '../ports/EventPublisher';
import { Logger } from '../ports/Logger';
import { AIPersonalizationService } from '../ports/AIPersonalizationService';

export interface CreateUserRequest {
  email: string;
  password: string;
  tenantId: string;
  profile: UserProfile;
  roles?: string[];
  metadata?: Record<string, any>;
}

export interface CreateUserResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    tenantId: string;
    profile: UserProfile;
    roles: string[];
    createdAt: Date;
    isActive: boolean;
    isVerified: boolean;
  };
  error?: string;
  validationErrors?: Record<string, string>;
}

export class CreateUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly logger: Logger,
    private readonly aiPersonalizationService: AIPersonalizationService
  ) {}

  /**
   * Execute user creation use case
   * 
   * @param request - User creation request data
   * @returns Promise resolving to creation response
   */
  async execute(request: CreateUserRequest): Promise<CreateUserResponse> {
    try {
      // Step 1: Validate input data
      const validationResult = await this.validateRequest(request);
      if (!validationResult.isValid) {
        this.logger.warn('User creation failed: validation errors', {
          email: request.email,
          tenantId: request.tenantId,
          errors: validationResult.errors
        });
        
        return {
          success: false,
          validationErrors: validationResult.errors
        };
      }

      // Step 2: Check if user already exists
      const existingUser = await this.userRepository.findByEmail(request.email);
      if (existingUser) {
        this.logger.warn('User creation failed: email already exists', {
          email: request.email,
          tenantId: request.tenantId
        });
        
        return {
          success: false,
          error: 'User with this email already exists'
        };
      }

      // Step 3: Hash password securely
      const passwordHash = await this.hashPassword(request.password);

      // Step 4: Create user domain entity
      const user = User.create(
        request.email,
        passwordHash,
        request.tenantId,
        request.profile
      );

      // Step 5: Add additional roles if provided
      let userWithRoles = user;
      if (request.roles && request.roles.length > 0) {
        for (const role of request.roles) {
          if (role !== 'user') { // 'user' is default role
            userWithRoles = userWithRoles.addRole(role);
          }
        }
      }

      // Step 6: Persist user to database
      const savedUser = await this.userRepository.save(userWithRoles);

      // Step 7: Initialize AI personalization profile
      await this.initializeAIPersonalization(savedUser);

      // Step 8: Publish domain event for other services
      const userCreatedEvent = UserEventFactory.createUserCreatedEvent(
        savedUser,
        request.metadata
      );
      await this.eventPublisher.publish(userCreatedEvent);

      // Step 9: Log successful creation
      this.logger.info('User created successfully', {
        userId: savedUser.id,
        email: savedUser.email,
        tenantId: savedUser.tenantId,
        roles: savedUser.roles
      });

      // Step 10: Return success response
      return {
        success: true,
        user: {
          id: savedUser.id,
          email: savedUser.email,
          tenantId: savedUser.tenantId,
          profile: savedUser.profile,
          roles: savedUser.roles,
          createdAt: savedUser.createdAt,
          isActive: savedUser.isActive,
          isVerified: savedUser.isVerified
        }
      };

    } catch (error) {
      // Log error for monitoring and debugging
      this.logger.error('User creation failed with unexpected error', {
        email: request.email,
        tenantId: request.tenantId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        success: false,
        error: 'Internal server error occurred during user creation'
      };
    }
  }

  /**
   * Validate user creation request
   * 
   * @param request - User creation request
   * @returns Validation result with errors if any
   */
  private async validateRequest(request: CreateUserRequest): Promise<{
    isValid: boolean;
    errors: Record<string, string>;
  }> {
    const errors: Record<string, string> = {};

    // Validate email format
    if (!request.email || !this.isValidEmail(request.email)) {
      errors.email = 'Valid email address is required';
    }

    // Validate password strength
    if (!request.password || !this.isValidPassword(request.password)) {
      errors.password = 'Password must be at least 8 characters with uppercase, lowercase, number, and special character';
    }

    // Validate tenant ID
    if (!request.tenantId || request.tenantId.trim().length === 0) {
      errors.tenantId = 'Tenant ID is required';
    }

    // Validate profile data
    if (!request.profile) {
      errors.profile = 'User profile is required';
    } else {
      if (!request.profile.firstName || request.profile.firstName.trim().length === 0) {
        errors.firstName = 'First name is required';
      }
      
      if (!request.profile.lastName || request.profile.lastName.trim().length === 0) {
        errors.lastName = 'Last name is required';
      }

      // Validate optional fields if provided
      if (request.profile.firstName && request.profile.firstName.length > 50) {
        errors.firstName = 'First name must be less than 50 characters';
      }
      
      if (request.profile.lastName && request.profile.lastName.length > 50) {
        errors.lastName = 'Last name must be less than 50 characters';
      }

      if (request.profile.company && request.profile.company.length > 100) {
        errors.company = 'Company name must be less than 100 characters';
      }

      if (request.profile.jobTitle && request.profile.jobTitle.length > 100) {
        errors.jobTitle = 'Job title must be less than 100 characters';
      }
    }

    // Validate roles if provided
    if (request.roles) {
      const validRoles = ['user', 'admin', 'manager', 'developer', 'analyst'];
      const invalidRoles = request.roles.filter(role => !validRoles.includes(role));
      if (invalidRoles.length > 0) {
        errors.roles = `Invalid roles: ${invalidRoles.join(', ')}`;
      }
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  }

  /**
   * Hash password using bcrypt
   * 
   * @param password - Plain text password
   * @returns Promise resolving to hashed password
   */
  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 12; // High security salt rounds
    return bcrypt.hash(password, saltRounds);
  }

  /**
   * Initialize AI personalization profile for new user
   * 
   * @param user - Created user entity
   */
  private async initializeAIPersonalization(user: User): Promise<void> {
    try {
      // Only initialize if user has AI personalization enabled
      if (user.preferences.aiPersonalization.enabled) {
        await this.aiPersonalizationService.initializeUserProfile({
          userId: user.id,
          tenantId: user.tenantId,
          profile: user.profile,
          preferences: user.preferences,
          initialContext: {
            createdAt: user.createdAt,
            roles: user.roles,
            source: 'user_creation'
          }
        });

        this.logger.info('AI personalization profile initialized', {
          userId: user.id,
          tenantId: user.tenantId
        });
      }
    } catch (error) {
      // Log error but don't fail user creation
      this.logger.warn('Failed to initialize AI personalization profile', {
        userId: user.id,
        tenantId: user.tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Validate email format
   * 
   * @param email - Email address to validate
   * @returns Boolean indicating if email is valid
   */
  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.toLowerCase());
  }

  /**
   * Validate password strength
   * 
   * @param password - Password to validate
   * @returns Boolean indicating if password meets requirements
   */
  private isValidPassword(password: string): boolean {
    // Password must be at least 8 characters
    if (password.length < 8) return false;
    
    // Must contain at least one uppercase letter
    if (!/[A-Z]/.test(password)) return false;
    
    // Must contain at least one lowercase letter
    if (!/[a-z]/.test(password)) return false;
    
    // Must contain at least one number
    if (!/\d/.test(password)) return false;
    
    // Must contain at least one special character
    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) return false;
    
    return true;
  }
}
