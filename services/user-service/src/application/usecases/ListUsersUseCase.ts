/**
 * List Users Use Case
 * 
 * Application service that handles user listing operations with
 * pagination, filtering, sorting, and authorization.
 */

import { User } from '../../domain/entities/User';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { Logger } from '../ports/Logger';

export interface ListUsersRequest {
  tenantId: string;
  requestedBy: string;
  pagination: {
    page: number;
    limit: number;
  };
  filters?: {
    search?: string;
    role?: string;
    isActive?: boolean;
    isVerified?: boolean;
    createdAfter?: Date;
    createdBefore?: Date;
  };
  sorting?: {
    field: string;
    order: 'asc' | 'desc';
  };
}

export interface ListUsersResponse {
  success: boolean;
  users?: User[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
  error?: string;
}

export class ListUsersUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: Logger
  ) {}

  /**
   * Execute list users use case
   * 
   * @param request - List users request
   * @returns Promise resolving to paginated user list
   */
  async execute(request: ListUsersRequest): Promise<ListUsersResponse> {
    try {
      // Step 1: Validate input
      const validationResult = this.validateRequest(request);
      if (!validationResult.isValid) {
        this.logger.warn('List users failed: validation error', {
          tenantId: request.tenantId,
          requestedBy: request.requestedBy,
          error: validationResult.error
        });

        return {
          success: false,
          error: validationResult.error
        };
      }

      // Step 2: Check authorization
      const authResult = await this.checkListAuthorization(request);
      if (!authResult.authorized) {
        this.logger.warn('Unauthorized list users attempt', {
          tenantId: request.tenantId,
          requestedBy: request.requestedBy,
          reason: authResult.reason
        });

        return {
          success: false,
          error: authResult.reason || 'Unauthorized'
        };
      }

      // Step 3: Build search criteria
      const searchCriteria = this.buildSearchCriteria(request);

      // Step 4: Get total count for pagination
      const totalCount = await this.userRepository.countByTenantId(request.tenantId);

      // Step 5: Calculate pagination
      const pagination = this.calculatePagination(
        request.pagination.page,
        request.pagination.limit,
        totalCount
      );

      // Step 6: Retrieve users with filters and pagination
      const users = await this.userRepository.search({
        ...searchCriteria,
        offset: (pagination.page - 1) * pagination.limit,
        limit: pagination.limit
      });

      // Step 7: Filter sensitive data based on requester permissions
      const filteredUsers = users.map(user => 
        this.filterUserData(user, request.requestedBy)
      );

      // Step 8: Log successful operation
      this.logger.info('Users listed successfully', {
        tenantId: request.tenantId,
        requestedBy: request.requestedBy,
        resultCount: filteredUsers.length,
        totalCount,
        page: pagination.page,
        filters: request.filters
      });

      return {
        success: true,
        users: filteredUsers,
        pagination: {
          ...pagination,
          total: totalCount,
          totalPages: Math.ceil(totalCount / pagination.limit),
          hasNext: pagination.page < Math.ceil(totalCount / pagination.limit),
          hasPrevious: pagination.page > 1
        }
      };

    } catch (error) {
      this.logger.error('List users failed with unexpected error', {
        tenantId: request.tenantId,
        requestedBy: request.requestedBy,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        success: false,
        error: 'Internal server error occurred while listing users'
      };
    }
  }

  /**
   * Validate list users request
   * 
   * @param request - List users request
   * @returns Validation result
   */
  private validateRequest(request: ListUsersRequest): {
    isValid: boolean;
    error?: string;
  } {
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

    // Validate pagination
    if (!request.pagination) {
      return {
        isValid: false,
        error: 'Pagination parameters are required'
      };
    }

    if (request.pagination.page < 1) {
      return {
        isValid: false,
        error: 'Page must be greater than 0'
      };
    }

    if (request.pagination.limit < 1 || request.pagination.limit > 100) {
      return {
        isValid: false,
        error: 'Limit must be between 1 and 100'
      };
    }

    // Validate UUID format
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
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

    // Validate sorting
    if (request.sorting) {
      const validSortFields = [
        'createdAt', 'updatedAt', 'email', 'firstName', 'lastName', 'company'
      ];
      
      if (!validSortFields.includes(request.sorting.field)) {
        return {
          isValid: false,
          error: `Invalid sort field. Must be one of: ${validSortFields.join(', ')}`
        };
      }

      if (!['asc', 'desc'].includes(request.sorting.order)) {
        return {
          isValid: false,
          error: 'Sort order must be asc or desc'
        };
      }
    }

    // Validate filters
    if (request.filters) {
      if (request.filters.role) {
        const validRoles = ['user', 'admin', 'manager', 'developer', 'analyst'];
        if (!validRoles.includes(request.filters.role)) {
          return {
            isValid: false,
            error: `Invalid role filter. Must be one of: ${validRoles.join(', ')}`
          };
        }
      }

      if (request.filters.search && request.filters.search.length > 100) {
        return {
          isValid: false,
          error: 'Search term must be less than 100 characters'
        };
      }

      if (request.filters.createdAfter && request.filters.createdBefore) {
        if (request.filters.createdAfter >= request.filters.createdBefore) {
          return {
            isValid: false,
            error: 'createdAfter must be before createdBefore'
          };
        }
      }
    }

    return {
      isValid: true
    };
  }

  /**
   * Check if the requester is authorized to list users
   * 
   * @param request - List users request
   * @returns Authorization result
   */
  private async checkListAuthorization(request: ListUsersRequest): Promise<{
    authorized: boolean;
    reason?: string;
  }> {
    try {
      // Get the requester's user object to check permissions
      const requester = await this.userRepository.findById(request.requestedBy);
      
      if (!requester) {
        return {
          authorized: false,
          reason: 'Requester not found'
        };
      }

      // Check tenant isolation
      if (requester.tenantId !== request.tenantId) {
        return {
          authorized: false,
          reason: 'Cross-tenant access denied'
        };
      }

      // Check if requester is active
      if (!requester.isActive) {
        return {
          authorized: false,
          reason: 'Inactive user cannot list users'
        };
      }

      // Check if requester has admin role
      if (!requester.hasRole('admin')) {
        return {
          authorized: false,
          reason: 'Admin role required to list users'
        };
      }

      return {
        authorized: true
      };

    } catch (error) {
      this.logger.error('Error checking list authorization', {
        requestedBy: request.requestedBy,
        tenantId: request.tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      return {
        authorized: false,
        reason: 'Authorization check failed'
      };
    }
  }

  /**
   * Build search criteria from request filters
   * 
   * @param request - List users request
   * @returns Search criteria for repository
   */
  private buildSearchCriteria(request: ListUsersRequest): any {
    const criteria: any = {
      tenantId: request.tenantId
    };

    if (request.filters) {
      // Text search across email and name fields
      if (request.filters.search) {
        criteria.email = request.filters.search;
        criteria.firstName = request.filters.search;
        criteria.lastName = request.filters.search;
        criteria.company = request.filters.search;
      }

      // Role filter
      if (request.filters.role) {
        criteria.role = request.filters.role;
      }

      // Status filters
      if (request.filters.isActive !== undefined) {
        criteria.isActive = request.filters.isActive;
      }

      if (request.filters.isVerified !== undefined) {
        criteria.isVerified = request.filters.isVerified;
      }

      // Date range filters
      if (request.filters.createdAfter) {
        criteria.createdAfter = request.filters.createdAfter;
      }

      if (request.filters.createdBefore) {
        criteria.createdBefore = request.filters.createdBefore;
      }
    }

    return criteria;
  }

  /**
   * Calculate pagination parameters
   * 
   * @param page - Requested page number
   * @param limit - Items per page
   * @param total - Total number of items
   * @returns Pagination parameters
   */
  private calculatePagination(page: number, limit: number, total: number): {
    page: number;
    limit: number;
  } {
    // Ensure page is within valid range
    const maxPage = Math.max(1, Math.ceil(total / limit));
    const validPage = Math.min(Math.max(1, page), maxPage);

    return {
      page: validPage,
      limit
    };
  }

  /**
   * Filter user data based on requester permissions
   * 
   * @param user - User entity
   * @param requestedBy - ID of user making the request
   * @returns Filtered user data
   */
  private filterUserData(user: User, requestedBy: string): User {
    // For admin users listing other users, we filter out sensitive information
    const filteredUserData = user.toPersistence();
    
    // Always remove password hash
    filteredUserData.passwordHash = '[REDACTED]';
    
    // For listing, we typically don't include full metrics and preferences
    // to reduce payload size and protect privacy
    filteredUserData.metrics = {
      loginCount: user.metrics.loginCount,
      sessionDuration: 0,
      featuresUsed: [],
      aiInteractions: 0,
      errorReports: 0
    };

    // Only include basic preference information
    filteredUserData.preferences = {
      theme: user.preferences.theme,
      language: user.preferences.language,
      timezone: user.preferences.timezone,
      notifications: {
        email: false,
        push: false,
        sms: false
      },
      aiPersonalization: {
        enabled: user.preferences.aiPersonalization.enabled,
        dataCollection: false,
        recommendations: false
      }
    };

    return User.fromPersistence(filteredUserData);
  }
}
