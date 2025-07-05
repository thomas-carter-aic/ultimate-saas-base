/**
 * Create Tenant Use Case
 * 
 * Application service that orchestrates tenant creation business logic.
 * This use case handles the complete tenant provisioning workflow including
 * validation, resource allocation, billing setup, and event publishing.
 */

import { Tenant, BillingInfo } from '../../domain/entities/Tenant';
import { TenantRepository } from '../../domain/repositories/TenantRepository';
import { TenantEventFactory } from '../../domain/events/TenantEvents';
import { EventPublisher } from '../ports/EventPublisher';
import { Logger } from '../ports/Logger';
import { BillingService } from '../ports/BillingService';
import { ResourceProvisioningService } from '../ports/ResourceProvisioningService';

export interface CreateTenantRequest {
  name: string;
  slug: string;
  ownerId: string;
  plan?: 'starter' | 'professional' | 'enterprise' | 'custom';
  billingInfo?: Partial<BillingInfo>;
  settings?: {
    branding?: {
      companyName?: string;
      primaryColor?: string;
      secondaryColor?: string;
      customDomain?: string;
    };
    features?: {
      aiPersonalization?: boolean;
      advancedAnalytics?: boolean;
      customIntegrations?: boolean;
      whiteLabeling?: boolean;
      apiAccess?: boolean;
      ssoIntegration?: boolean;
    };
  };
  metadata?: Record<string, any>;
}

export interface CreateTenantResponse {
  success: boolean;
  tenant?: {
    id: string;
    name: string;
    slug: string;
    ownerId: string;
    status: string;
    plan: string;
    trialEndsAt?: Date;
    createdAt: Date;
    settings: any;
    resourceLimits: any;
  };
  error?: string;
  validationErrors?: Record<string, string>;
}

export class CreateTenantUseCase {
  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly logger: Logger,
    private readonly billingService: BillingService,
    private readonly resourceProvisioningService: ResourceProvisioningService
  ) {}

  /**
   * Execute tenant creation use case
   * 
   * @param request - Tenant creation request data
   * @returns Promise resolving to creation response
   */
  async execute(request: CreateTenantRequest): Promise<CreateTenantResponse> {
    try {
      // Step 1: Validate input data
      const validationResult = await this.validateRequest(request);
      if (!validationResult.isValid) {
        this.logger.warn('Tenant creation failed: validation errors', {
          name: request.name,
          slug: request.slug,
          ownerId: request.ownerId,
          errors: validationResult.errors
        });
        
        return {
          success: false,
          validationErrors: validationResult.errors
        };
      }

      // Step 2: Check if tenant slug is available
      const existingTenant = await this.tenantRepository.findBySlug(request.slug);
      if (existingTenant) {
        this.logger.warn('Tenant creation failed: slug already exists', {
          slug: request.slug,
          ownerId: request.ownerId
        });
        
        return {
          success: false,
          error: 'Tenant slug is already taken'
        };
      }

      // Step 3: Validate owner exists and can create tenants
      const ownerValidation = await this.validateOwner(request.ownerId);
      if (!ownerValidation.valid) {
        this.logger.warn('Tenant creation failed: invalid owner', {
          ownerId: request.ownerId,
          reason: ownerValidation.reason
        });
        
        return {
          success: false,
          error: ownerValidation.reason || 'Invalid owner'
        };
      }

      // Step 4: Create tenant domain entity
      const tenant = Tenant.create(
        request.name,
        request.slug,
        request.ownerId,
        request.plan || 'starter',
        request.billingInfo
      );

      // Step 5: Apply custom settings if provided
      if (request.settings) {
        try {
          tenant.updateSettings(request.settings);
        } catch (error) {
          this.logger.warn('Failed to apply custom settings', {
            tenantId: tenant.id,
            settings: request.settings,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          return {
            success: false,
            error: `Invalid settings: ${error instanceof Error ? error.message : 'Unknown error'}`
          };
        }
      }

      // Step 6: Setup billing if not in trial
      if (request.plan !== 'starter' || request.billingInfo?.paymentMethod) {
        try {
          const billingSetup = await this.billingService.setupBilling({
            tenantId: tenant.id,
            ownerId: request.ownerId,
            plan: request.plan || 'starter',
            billingInfo: request.billingInfo || {}
          });

          if (!billingSetup.success) {
            this.logger.error('Billing setup failed during tenant creation', {
              tenantId: tenant.id,
              error: billingSetup.error
            });
            
            return {
              success: false,
              error: `Billing setup failed: ${billingSetup.error}`
            };
          }

          // Update tenant with billing information
          tenant.updateBillingInfo(billingSetup.billingInfo);
        } catch (error) {
          this.logger.error('Billing service error during tenant creation', {
            tenantId: tenant.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          return {
            success: false,
            error: 'Failed to setup billing'
          };
        }
      }

      // Step 7: Provision resources
      try {
        const provisioning = await this.resourceProvisioningService.provisionTenant({
          tenantId: tenant.id,
          plan: request.plan || 'starter',
          resourceLimits: tenant.resourceLimits,
          settings: tenant.settings
        });

        if (!provisioning.success) {
          this.logger.error('Resource provisioning failed during tenant creation', {
            tenantId: tenant.id,
            error: provisioning.error
          });
          
          return {
            success: false,
            error: `Resource provisioning failed: ${provisioning.error}`
          };
        }
      } catch (error) {
        this.logger.error('Resource provisioning service error', {
          tenantId: tenant.id,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        return {
          success: false,
          error: 'Failed to provision resources'
        };
      }

      // Step 8: Persist tenant to database
      const savedTenant = await this.tenantRepository.save(tenant);

      // Step 9: Publish domain event
      const tenantCreatedEvent = TenantEventFactory.createTenantCreatedEvent(
        savedTenant,
        request.metadata
      );
      await this.eventPublisher.publish(tenantCreatedEvent);

      // Step 10: Log successful creation
      this.logger.info('Tenant created successfully', {
        tenantId: savedTenant.id,
        name: savedTenant.name,
        slug: savedTenant.slug,
        ownerId: savedTenant.ownerId,
        plan: savedTenant.billingInfo.plan,
        status: savedTenant.status
      });

      // Step 11: Return success response
      return {
        success: true,
        tenant: {
          id: savedTenant.id,
          name: savedTenant.name,
          slug: savedTenant.slug,
          ownerId: savedTenant.ownerId,
          status: savedTenant.status,
          plan: savedTenant.billingInfo.plan,
          trialEndsAt: savedTenant.trialEndsAt,
          createdAt: savedTenant.createdAt,
          settings: savedTenant.settings,
          resourceLimits: savedTenant.resourceLimits
        }
      };

    } catch (error) {
      // Log error for monitoring and debugging
      this.logger.error('Tenant creation failed with unexpected error', {
        name: request.name,
        slug: request.slug,
        ownerId: request.ownerId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      return {
        success: false,
        error: 'Internal server error occurred during tenant creation'
      };
    }
  }

  /**
   * Validate tenant creation request
   * 
   * @param request - Tenant creation request
   * @returns Validation result with errors if any
   */
  private async validateRequest(request: CreateTenantRequest): Promise<{
    isValid: boolean;
    errors?: Record<string, string>;
  }> {
    const errors: Record<string, string> = {};

    // Validate tenant name
    if (!request.name || request.name.trim().length === 0) {
      errors.name = 'Tenant name is required';
    } else if (request.name.length > 100) {
      errors.name = 'Tenant name must be less than 100 characters';
    } else if (request.name.trim().length < 2) {
      errors.name = 'Tenant name must be at least 2 characters';
    }

    // Validate tenant slug
    if (!request.slug || request.slug.trim().length === 0) {
      errors.slug = 'Tenant slug is required';
    } else if (!this.isValidSlug(request.slug)) {
      errors.slug = 'Invalid slug format. Must be lowercase, alphanumeric with hyphens only';
    } else if (request.slug.length < 3 || request.slug.length > 50) {
      errors.slug = 'Slug must be between 3 and 50 characters';
    }

    // Validate owner ID
    if (!request.ownerId || request.ownerId.trim().length === 0) {
      errors.ownerId = 'Owner ID is required';
    } else if (!this.isValidUUID(request.ownerId)) {
      errors.ownerId = 'Invalid owner ID format';
    }

    // Validate plan
    if (request.plan && !['starter', 'professional', 'enterprise', 'custom'].includes(request.plan)) {
      errors.plan = 'Invalid plan. Must be starter, professional, enterprise, or custom';
    }

    // Validate billing info if provided
    if (request.billingInfo) {
      const billingErrors = this.validateBillingInfo(request.billingInfo);
      Object.assign(errors, billingErrors);
    }

    // Validate settings if provided
    if (request.settings) {
      const settingsErrors = this.validateSettings(request.settings);
      Object.assign(errors, settingsErrors);
    }

    return {
      isValid: Object.keys(errors).length === 0,
      errors: Object.keys(errors).length > 0 ? errors : undefined
    };
  }

  /**
   * Validate billing information
   */
  private validateBillingInfo(billingInfo: Partial<BillingInfo>): Record<string, string> {
    const errors: Record<string, string> = {};

    if (billingInfo.billingAddress) {
      const addr = billingInfo.billingAddress;
      if (addr.street && addr.street.length > 200) {
        errors['billingAddress.street'] = 'Street address must be less than 200 characters';
      }
      if (addr.city && addr.city.length > 100) {
        errors['billingAddress.city'] = 'City must be less than 100 characters';
      }
      if (addr.country && addr.country.length !== 2) {
        errors['billingAddress.country'] = 'Country must be a 2-letter ISO code';
      }
    }

    if (billingInfo.paymentMethod) {
      const pm = billingInfo.paymentMethod;
      if (pm.type && !['card', 'bank', 'invoice'].includes(pm.type)) {
        errors['paymentMethod.type'] = 'Invalid payment method type';
      }
      if (pm.type === 'card') {
        if (pm.last4 && (pm.last4.length !== 4 || !/^\d{4}$/.test(pm.last4))) {
          errors['paymentMethod.last4'] = 'Last 4 digits must be exactly 4 numbers';
        }
        if (pm.expiryMonth && (pm.expiryMonth < 1 || pm.expiryMonth > 12)) {
          errors['paymentMethod.expiryMonth'] = 'Expiry month must be between 1 and 12';
        }
        if (pm.expiryYear && pm.expiryYear < new Date().getFullYear()) {
          errors['paymentMethod.expiryYear'] = 'Expiry year cannot be in the past';
        }
      }
    }

    return errors;
  }

  /**
   * Validate tenant settings
   */
  private validateSettings(settings: any): Record<string, string> {
    const errors: Record<string, string> = {};

    if (settings.branding) {
      const branding = settings.branding;
      
      if (branding.companyName !== undefined && 
          (!branding.companyName || branding.companyName.trim().length === 0)) {
        errors['branding.companyName'] = 'Company name cannot be empty';
      }

      if (branding.primaryColor && !this.isValidHexColor(branding.primaryColor)) {
        errors['branding.primaryColor'] = 'Invalid hex color format';
      }

      if (branding.secondaryColor && !this.isValidHexColor(branding.secondaryColor)) {
        errors['branding.secondaryColor'] = 'Invalid hex color format';
      }

      if (branding.customDomain && !this.isValidDomain(branding.customDomain)) {
        errors['branding.customDomain'] = 'Invalid domain format';
      }
    }

    return errors;
  }

  /**
   * Validate that the owner exists and can create tenants
   */
  private async validateOwner(ownerId: string): Promise<{
    valid: boolean;
    reason?: string;
  }> {
    try {
      // This would typically call the User Service to validate the owner
      // For now, we'll simulate the validation
      
      // Check if owner ID is valid UUID
      if (!this.isValidUUID(ownerId)) {
        return {
          valid: false,
          reason: 'Invalid owner ID format'
        };
      }

      // In a real implementation, you would:
      // 1. Call User Service to verify user exists
      // 2. Check if user has permission to create tenants
      // 3. Check if user hasn't exceeded tenant creation limits
      
      return {
        valid: true
      };
    } catch (error) {
      this.logger.error('Error validating owner', {
        ownerId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return {
        valid: false,
        reason: 'Unable to validate owner'
      };
    }
  }

  // Helper validation methods

  private isValidSlug(slug: string): boolean {
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    return slugRegex.test(slug);
  }

  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  private isValidHexColor(color: string): boolean {
    const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
    return hexColorRegex.test(color);
  }

  private isValidDomain(domain: string): boolean {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
  }
}
