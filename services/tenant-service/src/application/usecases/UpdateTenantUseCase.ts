import { Tenant } from '../../domain/entities/Tenant';
import { TenantRepository } from '../../domain/repositories/TenantRepository';
import { EventPublisher } from '../ports/EventPublisher';
import { Logger } from '../ports/Logger';
import { TenantEventFactory } from '../../domain/events/TenantEvents';

export interface UpdateTenantRequest {
  tenantId: string;
  requesterId: string;
  updates: {
    name?: string;
    settings?: {
      branding?: {
        logoUrl?: string;
        primaryColor?: string;
        customDomain?: string;
      };
      features?: {
        aiEnabled?: boolean;
        analyticsEnabled?: boolean;
        customIntegrations?: boolean;
      };
      security?: {
        passwordPolicy?: {
          minLength?: number;
          requireSpecialChars?: boolean;
          requireNumbers?: boolean;
        };
        sessionTimeout?: number;
        mfaRequired?: boolean;
      };
      compliance?: {
        gdprEnabled?: boolean;
        hipaaEnabled?: boolean;
        soc2Enabled?: boolean;
      };
    };
    billingInfo?: {
      paymentMethodId?: string;
      billingEmail?: string;
      taxId?: string;
    };
  };
}

export interface UpdateTenantResponse {
  success: boolean;
  tenant?: Tenant;
  error?: string;
}

export class UpdateTenantUseCase {
  constructor(
    private tenantRepository: TenantRepository,
    private eventPublisher: EventPublisher,
    private logger: Logger
  ) {}

  async execute(request: UpdateTenantRequest): Promise<UpdateTenantResponse> {
    try {
      this.logger.info('Updating tenant', { 
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

      if (!request.updates || Object.keys(request.updates).length === 0) {
        return {
          success: false,
          error: 'No updates provided'
        };
      }

      // Get existing tenant
      const existingTenant = await this.tenantRepository.findById(request.tenantId);
      if (!existingTenant) {
        return {
          success: false,
          error: 'Tenant not found'
        };
      }

      // Authorization check - only owner can update tenant
      if (existingTenant.ownerId !== request.requesterId) {
        this.logger.warn('Unauthorized tenant update attempt', {
          tenantId: request.tenantId,
          requesterId: request.requesterId,
          ownerId: existingTenant.ownerId
        });
        
        return {
          success: false,
          error: 'Only tenant owner can update tenant settings'
        };
      }

      // Validate tenant is in updatable state
      if (existingTenant.status === 'cancelled') {
        return {
          success: false,
          error: 'Cannot update cancelled tenant'
        };
      }

      // Create updated tenant
      const updatedTenant = this.applyUpdates(existingTenant, request.updates);

      // Validate updated tenant
      const validationResult = updatedTenant.validate();
      if (!validationResult.isValid) {
        return {
          success: false,
          error: `Validation failed: ${validationResult.errors.join(', ')}`
        };
      }

      // Save updated tenant
      const savedTenant = await this.tenantRepository.update(updatedTenant);

      // Publish events for significant changes
      await this.publishUpdateEvents(existingTenant, savedTenant);

      this.logger.info('Tenant updated successfully', { 
        tenantId: request.tenantId,
        tenantName: savedTenant.name 
      });

      return {
        success: true,
        tenant: savedTenant
      };

    } catch (error) {
      this.logger.error('Error updating tenant', error as Error, {
        tenantId: request.tenantId,
        requesterId: request.requesterId
      });

      return {
        success: false,
        error: 'Failed to update tenant'
      };
    }
  }

  private applyUpdates(tenant: Tenant, updates: UpdateTenantRequest['updates']): Tenant {
    // Create a copy of the tenant with updates applied
    const updatedData = {
      ...tenant,
      updatedAt: new Date()
    };

    if (updates.name) {
      updatedData.name = updates.name;
    }

    if (updates.settings) {
      updatedData.settings = {
        ...tenant.settings,
        ...updates.settings,
        branding: updates.settings.branding ? {
          ...tenant.settings.branding,
          ...updates.settings.branding
        } : tenant.settings.branding,
        features: updates.settings.features ? {
          ...tenant.settings.features,
          ...updates.settings.features
        } : tenant.settings.features,
        security: updates.settings.security ? {
          ...tenant.settings.security,
          ...updates.settings.security,
          passwordPolicy: updates.settings.security.passwordPolicy ? {
            ...tenant.settings.security.passwordPolicy,
            ...updates.settings.security.passwordPolicy
          } : tenant.settings.security.passwordPolicy
        } : tenant.settings.security,
        compliance: updates.settings.compliance ? {
          ...tenant.settings.compliance,
          ...updates.settings.compliance
        } : tenant.settings.compliance
      };
    }

    if (updates.billingInfo) {
      updatedData.billingInfo = {
        ...tenant.billingInfo,
        ...updates.billingInfo
      };
    }

    return new Tenant(
      updatedData.id,
      updatedData.name,
      updatedData.ownerId,
      updatedData.plan,
      updatedData.status,
      updatedData.resourceLimits,
      updatedData.currentUsage,
      updatedData.billingInfo,
      updatedData.settings,
      updatedData.createdAt,
      updatedData.updatedAt,
      updatedData.trialEndsAt
    );
  }

  private async publishUpdateEvents(oldTenant: Tenant, newTenant: Tenant): Promise<void> {
    const events = [];

    // Check for significant changes that warrant events
    if (oldTenant.name !== newTenant.name) {
      events.push(TenantEventFactory.createTenantUpdatedEvent(newTenant.id, {
        field: 'name',
        oldValue: oldTenant.name,
        newValue: newTenant.name
      }));
    }

    if (oldTenant.plan !== newTenant.plan) {
      events.push(TenantEventFactory.createTenantPlanChangedEvent(
        newTenant.id,
        oldTenant.plan,
        newTenant.plan
      ));
    }

    if (JSON.stringify(oldTenant.settings) !== JSON.stringify(newTenant.settings)) {
      events.push(TenantEventFactory.createTenantSettingsUpdatedEvent(
        newTenant.id,
        newTenant.settings
      ));
    }

    if (JSON.stringify(oldTenant.billingInfo) !== JSON.stringify(newTenant.billingInfo)) {
      events.push(TenantEventFactory.createTenantBillingUpdatedEvent(
        newTenant.id,
        newTenant.billingInfo
      ));
    }

    // Publish all events
    for (const event of events) {
      try {
        await this.eventPublisher.publish(event);
      } catch (error) {
        this.logger.error('Failed to publish tenant update event', error as Error, {
          tenantId: newTenant.id,
          eventType: event.type
        });
      }
    }
  }
}
