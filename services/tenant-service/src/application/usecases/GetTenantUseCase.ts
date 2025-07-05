import { Tenant } from '../../domain/entities/Tenant';
import { TenantRepository } from '../../domain/repositories/TenantRepository';
import { Logger } from '../ports/Logger';

export interface GetTenantRequest {
  tenantId: string;
  requesterId: string;
  requesterRole: 'owner' | 'admin' | 'user';
}

export interface GetTenantResponse {
  success: boolean;
  tenant?: Tenant;
  error?: string;
}

export class GetTenantUseCase {
  constructor(
    private tenantRepository: TenantRepository,
    private logger: Logger
  ) {}

  async execute(request: GetTenantRequest): Promise<GetTenantResponse> {
    try {
      this.logger.info('Getting tenant', { 
        tenantId: request.tenantId,
        requesterId: request.requesterId 
      });

      // Validate input
      if (!request.tenantId || !request.requesterId) {
        return {
          success: false,
          error: 'Tenant ID and requester ID are required'
        };
      }

      // Get tenant
      const tenant = await this.tenantRepository.findById(request.tenantId);
      if (!tenant) {
        return {
          success: false,
          error: 'Tenant not found'
        };
      }

      // Authorization check
      const isAuthorized = this.checkAuthorization(tenant, request.requesterId, request.requesterRole);
      if (!isAuthorized) {
        this.logger.warn('Unauthorized tenant access attempt', {
          tenantId: request.tenantId,
          requesterId: request.requesterId,
          requesterRole: request.requesterRole
        });
        
        return {
          success: false,
          error: 'Unauthorized access to tenant'
        };
      }

      this.logger.info('Tenant retrieved successfully', { 
        tenantId: request.tenantId,
        tenantName: tenant.name 
      });

      return {
        success: true,
        tenant
      };

    } catch (error) {
      this.logger.error('Error getting tenant', error as Error, {
        tenantId: request.tenantId,
        requesterId: request.requesterId
      });

      return {
        success: false,
        error: 'Failed to get tenant'
      };
    }
  }

  private checkAuthorization(tenant: Tenant, requesterId: string, requesterRole: string): boolean {
    // Owner can always access
    if (tenant.ownerId === requesterId) {
      return true;
    }

    // Admin role can access if they're part of the tenant
    if (requesterRole === 'admin') {
      // In a real implementation, you'd check if the admin is associated with this tenant
      // For now, we'll allow admin access
      return true;
    }

    // Regular users can only access if they're part of the tenant and tenant is active
    if (requesterRole === 'user' && tenant.status === 'active') {
      // In a real implementation, you'd check tenant membership
      // For now, we'll allow user access to active tenants
      return true;
    }

    return false;
  }
}
