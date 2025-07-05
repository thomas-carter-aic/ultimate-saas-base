import { Tenant } from '../../domain/entities/Tenant';
import { TenantRepository } from '../../domain/repositories/TenantRepository';
import { Logger } from '../ports/Logger';

export interface ListTenantsRequest {
  requesterId: string;
  requesterRole: 'admin' | 'owner' | 'user';
  filters?: {
    status?: 'trial' | 'active' | 'suspended' | 'cancelled';
    plan?: 'starter' | 'professional' | 'enterprise' | 'custom';
    ownerId?: string;
    search?: string; // Search in tenant name
  };
  pagination?: {
    page: number;
    limit: number;
  };
  sorting?: {
    field: 'name' | 'createdAt' | 'updatedAt' | 'status' | 'plan';
    direction: 'asc' | 'desc';
  };
}

export interface ListTenantsResponse {
  success: boolean;
  tenants?: Tenant[];
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  error?: string;
}

export class ListTenantsUseCase {
  constructor(
    private tenantRepository: TenantRepository,
    private logger: Logger
  ) {}

  async execute(request: ListTenantsRequest): Promise<ListTenantsResponse> {
    try {
      this.logger.info('Listing tenants', { 
        requesterId: request.requesterId,
        requesterRole: request.requesterRole,
        filters: request.filters
      });

      // Validate input
      if (!request.requesterId || !request.requesterRole) {
        return {
          success: false,
          error: 'Requester ID and role are required'
        };
      }

      // Set default pagination
      const pagination = {
        page: request.pagination?.page || 1,
        limit: Math.min(request.pagination?.limit || 20, 100) // Max 100 per page
      };

      // Set default sorting
      const sorting = {
        field: request.sorting?.field || 'createdAt',
        direction: request.sorting?.direction || 'desc'
      };

      // Apply role-based filtering
      const enhancedFilters = this.applyRoleBasedFilters(request);

      // Get tenants with filters, pagination, and sorting
      const result = await this.tenantRepository.findWithFilters({
        filters: enhancedFilters,
        pagination,
        sorting
      });

      // Get total count for pagination
      const totalCount = await this.tenantRepository.countWithFilters(enhancedFilters);

      const paginationInfo = {
        page: pagination.page,
        limit: pagination.limit,
        total: totalCount,
        totalPages: Math.ceil(totalCount / pagination.limit)
      };

      this.logger.info('Tenants listed successfully', { 
        requesterId: request.requesterId,
        count: result.length,
        total: totalCount
      });

      return {
        success: true,
        tenants: result,
        pagination: paginationInfo
      };

    } catch (error) {
      this.logger.error('Error listing tenants', error as Error, {
        requesterId: request.requesterId,
        requesterRole: request.requesterRole
      });

      return {
        success: false,
        error: 'Failed to list tenants'
      };
    }
  }

  private applyRoleBasedFilters(request: ListTenantsRequest): any {
    const filters = { ...request.filters };

    // Role-based access control
    switch (request.requesterRole) {
      case 'admin':
        // Admins can see all tenants (no additional filtering)
        break;
        
      case 'owner':
        // Owners can only see their own tenants
        filters.ownerId = request.requesterId;
        break;
        
      case 'user':
        // Regular users can only see active tenants they're part of
        // In a real implementation, you'd check tenant membership
        filters.status = 'active';
        // For now, we'll limit to tenants owned by the user
        filters.ownerId = request.requesterId;
        break;
        
      default:
        // Unknown role - no access
        filters.ownerId = 'no-access';
        break;
    }

    return filters;
  }
}
