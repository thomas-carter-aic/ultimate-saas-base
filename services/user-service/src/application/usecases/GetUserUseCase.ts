/**
 * Get User Use Case
 * 
 * Application service that handles user retrieval operations.
 * Includes authorization checks, data filtering, and audit logging.
 */

import { User } from '../../domain/entities/User';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { Logger } from '../ports/Logger';

export interface GetUserRequest {
  userId: string;
  tenantId: string;
  requestedBy: string;
  includeMetrics?: boolean;
  includePreferences?: boolean;
}

export interface GetUserResponse {
  success: boolean;
  user?: User;
  error?: string;
}

export class GetUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: Logger
  ) {}

  /**
   * Execute get user use case
   * 
   * @param request - User retrieval request
   * @returns Promise resolving to user data or error
   */
  async execute(request: GetUserRequest): Promise<GetUserResponse> {
    try {
      // Step 1: Validate input
      const validationResult = this.validateRequest(request);
      if (!validationResult.isValid) {
        this.logger.warn('Get user failed: validation error', {
          userId: request.userId,
          tenantId: request.tenantId,
          requestedBy: request.requestedBy,
          error: validationResult.error
        });

        return {
          success: false,
          error: validationResult.error
        };
      }

      // Step 2: Retrieve user from repository
      const user = await this.userRepository.findById(request.userId);

      if (!user) {
        this.logger.info('User not found', {
          userId: request.userId,
          tenantId: request.tenantId,
          requestedBy: request.requestedBy
        });

        return {
          success: false,
          error: 'User not found'
        };
      }

      // Step 3: Check tenant isolation
      if (user.tenantId !== request.tenantId) {
        this.logger.warn('Cross-tenant access attempt blocked', {
          userId: request.userId,
          userTenantId: user.tenantId,
          requestTenantId: request.tenantId,
          requestedBy: request.requestedBy
        });

        return {
          success: false,
          error: 'User not found' // Don't reveal cross-tenant information
        };
      }

      // Step 4: Check if user is active
      if (!user.isActive) {
        this.logger.info('Inactive user access attempt', {
          userId: request.userId,
          tenantId: request.tenantId,
          requestedBy: request.requestedBy
        });

        return {
          success: false,
          error: 'User not found' // Don't reveal inactive status
        };
      }

      // Step 5: Apply data filtering based on requester permissions
      const filteredUser = this.filterUserData(user, request);

      // Step 6: Log successful access
      this.logger.info('User retrieved successfully', {
        userId: request.userId,
        tenantId: request.tenantId,
        requestedBy: request.requestedBy,
        includeMetrics: request.includeMetrics,
        includePreferences: request.includePreferences
      });

      return {
        success: true,
        user: filteredUser
      };

    } catch (error) {
      this.logger.error('Get user failed with unexpected error', {
        userId: request.userId,
        tenantId: request.tenantId,
        requestedBy: request.requestedBy,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        success: false,
        error: 'Internal server error occurred while retrieving user'
      };
    }
  }

  /**
   * Validate get user request
   * 
   * @param request - Get user request
   * @returns Validation result
   */
  private validateRequest(request: GetUserRequest): {
    isValid: boolean;
    error?: string;
  } {
    if (!request.userId || request.userId.trim().length === 0) {
      return {
        isValid: false,
        error: 'User ID is required'
      };
    }

    if (!request.tenantId || request.tenantId.trim().length === 0) {
      return {
        isValid: false,
        error: 'Tenant ID is required'
      };
    }

    if (!request.requestedBy || request.requestedBy.trim().length === 0) {
      return {
        isValid: false,
        error: 'Requester ID is required'
      };
    }

    // Validate UUID format (basic check)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    if (!uuidRegex.test(request.userId)) {
      return {
        isValid: false,
        error: 'Invalid user ID format'
      };
    }

    if (!uuidRegex.test(request.tenantId)) {
      return {
        isValid: false,
        error: 'Invalid tenant ID format'
      };
    }

    if (!uuidRegex.test(request.requestedBy)) {
      return {
        isValid: false,
        error: 'Invalid requester ID format'
      };
    }

    return {
      isValid: true
    };
  }

  /**
   * Filter user data based on requester permissions
   * 
   * @param user - User entity
   * @param request - Get user request
   * @returns Filtered user data
   */
  private filterUserData(user: User, request: GetUserRequest): User {
    // If requesting own data, return full user object
    if (user.id === request.requestedBy) {
      return user;
    }

    // For other users, we need to check permissions and filter sensitive data
    // This is a simplified implementation - in production, you'd check roles and permissions
    
    // Create a filtered version of the user
    // Note: This is a conceptual approach - in practice, you might create DTOs
    const filteredUserData = user.toPersistence();
    
    // Remove sensitive information for non-self requests
    if (!request.includeMetrics) {
      filteredUserData.metrics = {
        loginCount: 0,
        sessionDuration: 0,
        featuresUsed: [],
        aiInteractions: 0,
        errorReports: 0
      };
    }

    if (!request.includePreferences) {
      filteredUserData.preferences = {
        theme: 'auto',
        language: 'en',
        timezone: 'UTC',
        notifications: {
          email: false,
          push: false,
          sms: false
        },
        aiPersonalization: {
          enabled: false,
          dataCollection: false,
          recommendations: false
        }
      };
    }

    // Remove password hash (should never be exposed)
    filteredUserData.passwordHash = '[REDACTED]';

    return User.fromPersistence(filteredUserData);
  }
}
