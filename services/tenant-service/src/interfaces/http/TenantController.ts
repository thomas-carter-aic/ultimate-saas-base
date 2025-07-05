/**
 * Tenant HTTP Controller
 * 
 * REST API controller for tenant management operations.
 * Handles HTTP requests, validation, authentication, and response formatting.
 * Follows clean architecture principles by delegating business logic to use cases.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { trace, context } from '@opentelemetry/api';

import { CreateTenantUseCase } from '../../application/usecases/CreateTenantUseCase';
import { GetTenantUseCase } from '../../application/usecases/GetTenantUseCase';
import { UpdateTenantUseCase } from '../../application/usecases/UpdateTenantUseCase';
import { ListTenantsUseCase } from '../../application/usecases/ListTenantsUseCase';
import { TenantUsageAnalyticsUseCase } from '../../application/usecases/TenantUsageAnalyticsUseCase';
import { Logger } from '../../application/ports/Logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    tenantId?: string;
    roles: string[];
  };
}

export class TenantController {
  private router: Router;
  private createTenantRateLimit: any;
  private generalRateLimit: any;

  constructor(
    private readonly createTenantUseCase: CreateTenantUseCase,
    private readonly getTenantUseCase: GetTenantUseCase,
    private readonly updateTenantUseCase: UpdateTenantUseCase,
    private readonly listTenantsUseCase: ListTenantsUseCase,
    private readonly tenantUsageAnalyticsUseCase: TenantUsageAnalyticsUseCase,
    private readonly logger: Logger
  ) {
    this.router = Router();
    this.setupRateLimiting();
    this.setupRoutes();
  }

  /**
   * Get Express router with all tenant routes
   */
  public getRouter(): Router {
    return this.router;
  }

  /**
   * Setup rate limiting for different endpoints
   */
  private setupRateLimiting(): void {
    // Stricter rate limiting for tenant creation
    this.createTenantRateLimit = rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // 3 tenant creations per hour per user
      message: {
        error: 'Too many tenant creation attempts',
        message: 'Please try again later',
        retryAfter: '1 hour'
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: AuthenticatedRequest) => {
        // Rate limit by user ID
        return req.user?.id || req.ip || 'anonymous';
      }
    });

    // General rate limiting for other endpoints
    this.generalRateLimit = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // 100 requests per window
      message: {
        error: 'Too many requests',
        message: 'Please try again later'
      },
      standardHeaders: true,
      legacyHeaders: false
    });
  }

  /**
   * Setup all tenant routes
   */
  private setupRoutes(): void {
    // Apply general rate limiting to all routes
    this.router.use(this.generalRateLimit);

    // Tenant creation endpoint
    this.router.post(
      '/',
      this.createTenantRateLimit,
      this.validateCreateTenant(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.createTenant.bind(this)
    );

    // Get tenant by ID
    this.router.get(
      '/:id',
      this.validateGetTenant(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireTenantAccess,
      this.getTenant.bind(this)
    );

    // Get tenant by slug
    this.router.get(
      '/slug/:slug',
      this.validateGetTenantBySlug(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.getTenantBySlug.bind(this)
    );

    // Update tenant
    this.router.put(
      '/:id',
      this.validateUpdateTenant(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireTenantOwnership,
      this.updateTenant.bind(this)
    );

    // List user's tenants
    this.router.get(
      '/',
      this.validateListTenants(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.listUserTenants.bind(this)
    );

    // Get tenant usage statistics
    this.router.get(
      '/:id/usage',
      this.validateGetTenant(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireTenantAccess,
      this.getTenantUsage.bind(this)
    );

    // Update tenant settings
    this.router.patch(
      '/:id/settings',
      this.validateUpdateSettings(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireTenantOwnership,
      this.updateTenantSettings.bind(this)
    );

    // Update tenant billing
    this.router.patch(
      '/:id/billing',
      this.validateUpdateBilling(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireTenantOwnership,
      this.updateTenantBilling.bind(this)
    );

    // Suspend tenant (admin only)
    this.router.post(
      '/:id/suspend',
      this.validateSuspendTenant(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireAdminRole,
      this.suspendTenant.bind(this)
    );

    // Activate tenant (admin only)
    this.router.post(
      '/:id/activate',
      this.validateGetTenant(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireAdminRole,
      this.activateTenant.bind(this)
    );

    // Cancel tenant subscription
    this.router.post(
      '/:id/cancel',
      this.validateCancelTenant(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireTenantOwnership,
      this.cancelTenant.bind(this)
    );
  }

  /**
   * Create new tenant
   */
  private async createTenant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const tracer = trace.getTracer('tenant-service');
    const span = tracer.startSpan('TenantController.createTenant');

    try {
      context.with(trace.setSpan(context.active(), span), async () => {
        const { name, slug, plan, billingInfo, settings } = req.body;
        const ownerId = req.user!.id;

        span.setAttributes({
          'tenant.name': name,
          'tenant.slug': slug,
          'tenant.owner_id': ownerId,
          'tenant.plan': plan || 'starter'
        });

        this.logger.info('Creating new tenant', {
          name,
          slug,
          ownerId,
          plan: plan || 'starter',
          requestId: req.headers['x-request-id']
        });

        const result = await this.createTenantUseCase.execute({
          name,
          slug,
          ownerId,
          plan,
          billingInfo,
          settings,
          metadata: {
            createdBy: 'api',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
          }
        });

        if (result.success) {
          span.setAttributes({
            'tenant.id': result.tenant!.id,
            'operation.success': true
          });

          this.logger.info('Tenant created successfully', {
            tenantId: result.tenant!.id,
            name: result.tenant!.name,
            slug: result.tenant!.slug,
            ownerId: result.tenant!.ownerId
          });

          res.status(201).json({
            success: true,
            data: {
              tenant: result.tenant
            },
            message: 'Tenant created successfully'
          });
        } else {
          span.setAttributes({
            'operation.success': false,
            'error.type': 'validation_error'
          });

          if (result.validationErrors) {
            res.status(400).json({
              success: false,
              error: 'Validation failed',
              details: result.validationErrors
            });
          } else {
            res.status(400).json({
              success: false,
              error: result.error || 'Failed to create tenant'
            });
          }
        }
      });
    } catch (error) {
      span.recordException(error as Error);
      span.setAttributes({
        'operation.success': false,
        'error.type': 'internal_error'
      });

      this.logger.error('Unexpected error in createTenant', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      next(error);
    } finally {
      span.end();
    }
  }

  /**
   * Get tenant by ID
   */
  private async getTenant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const userRole = req.user!.roles.includes('admin') ? 'admin' : 'owner';

      const result = await this.getTenantUseCase.execute({
        tenantId: id,
        requesterId: userId,
        requesterRole: userRole
      });

      if (result.success) {
        res.json({
          success: true,
          data: {
            tenant: result.tenant
          }
        });
      } else {
        const statusCode = result.error === 'Tenant not found' ? 404 : 
                          result.error === 'Unauthorized access to tenant' ? 403 : 400;
        res.status(statusCode).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tenant by slug
   */
  private async getTenantBySlug(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { slug } = req.params;

      // This would call GetTenantBySlugUseCase
      // For now, return a placeholder response
      res.json({
        success: true,
        data: {
          tenant: {
            slug,
            message: 'Tenant retrieval by slug not yet implemented'
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update tenant
   */
  private async updateTenant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const updates = req.body;

      const result = await this.updateTenantUseCase.execute({
        tenantId: id,
        requesterId: userId,
        updates
      });

      if (result.success) {
        res.json({
          success: true,
          data: {
            tenant: result.tenant
          },
          message: 'Tenant updated successfully'
        });
      } else {
        const statusCode = result.error === 'Tenant not found' ? 404 : 
                          result.error?.includes('Unauthorized') ? 403 : 400;
        res.status(statusCode).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * List user's tenants
   */
  private async listUserTenants(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const userRole = req.user!.roles.includes('admin') ? 'admin' : 'owner';
      const { page = 1, limit = 20, status, plan, search } = req.query;

      const result = await this.listTenantsUseCase.execute({
        requesterId: userId,
        requesterRole: userRole,
        filters: {
          status: status as any,
          plan: plan as any,
          search: search as string
        },
        pagination: {
          page: Number(page),
          limit: Number(limit)
        },
        sorting: {
          field: 'createdAt',
          direction: 'desc'
        }
      });

      if (result.success) {
        res.json({
          success: true,
          data: {
            tenants: result.tenants,
            pagination: result.pagination
          }
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get tenant usage statistics
   */
  private async getTenantUsage(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const userRole = req.user!.roles.includes('admin') ? 'admin' : 'owner';
      const { startDate, endDate, metrics } = req.query;

      const timeRange = startDate && endDate ? {
        startDate: new Date(startDate as string),
        endDate: new Date(endDate as string)
      } : undefined;

      const requestedMetrics = metrics ? 
        (metrics as string).split(',') as any[] : 
        undefined;

      const result = await this.tenantUsageAnalyticsUseCase.execute({
        tenantId: id,
        requesterId: userId,
        requesterRole: userRole,
        timeRange,
        metrics: requestedMetrics
      });

      if (result.success) {
        res.json({
          success: true,
          data: {
            analytics: result.analytics
          }
        });
      } else {
        const statusCode = result.error === 'Tenant not found' ? 404 : 
                          result.error?.includes('Unauthorized') ? 403 : 400;
        res.status(statusCode).json({
          success: false,
          error: result.error
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update tenant settings
   */
  private async updateTenantSettings(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const settings = req.body;

      // This would call UpdateTenantSettingsUseCase
      // For now, return a placeholder response
      res.json({
        success: true,
        data: {
          settings
        },
        message: 'Tenant settings updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update tenant billing
   */
  private async updateTenantBilling(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const billingInfo = req.body;

      // This would call UpdateTenantBillingUseCase
      // For now, return a placeholder response
      res.json({
        success: true,
        data: {
          billingInfo
        },
        message: 'Tenant billing updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Suspend tenant
   */
  private async suspendTenant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      // This would call SuspendTenantUseCase
      // For now, return a placeholder response
      res.json({
        success: true,
        data: {
          tenantId: id,
          status: 'suspended',
          reason
        },
        message: 'Tenant suspended successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Activate tenant
   */
  private async activateTenant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      // This would call ActivateTenantUseCase
      // For now, return a placeholder response
      res.json({
        success: true,
        data: {
          tenantId: id,
          status: 'active'
        },
        message: 'Tenant activated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Cancel tenant subscription
   */
  private async cancelTenant(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { reason } = req.body;

      // This would call CancelTenantUseCase
      // For now, return a placeholder response
      res.json({
        success: true,
        data: {
          tenantId: id,
          status: 'cancelled',
          reason
        },
        message: 'Tenant cancelled successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // Validation middleware methods

  private validateCreateTenant() {
    return [
      body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Tenant name must be between 2 and 100 characters'),
      body('slug')
        .trim()
        .isLength({ min: 3, max: 50 })
        .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .withMessage('Slug must be lowercase, alphanumeric with hyphens only'),
      body('plan')
        .optional()
        .isIn(['starter', 'professional', 'enterprise', 'custom'])
        .withMessage('Invalid plan. Must be starter, professional, enterprise, or custom'),
      body('billingInfo.billingAddress.country')
        .optional()
        .isLength({ min: 2, max: 2 })
        .withMessage('Country must be a 2-letter ISO code'),
      body('settings.branding.companyName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Company name must be between 1 and 100 characters'),
      body('settings.branding.primaryColor')
        .optional()
        .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
        .withMessage('Primary color must be a valid hex color'),
      body('settings.branding.customDomain')
        .optional()
        .matches(/^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/)
        .withMessage('Invalid domain format')
    ];
  }

  private validateGetTenant() {
    return [
      param('id')
        .isUUID()
        .withMessage('Valid tenant ID is required')
    ];
  }

  private validateGetTenantBySlug() {
    return [
      param('slug')
        .trim()
        .isLength({ min: 3, max: 50 })
        .matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .withMessage('Valid tenant slug is required')
    ];
  }

  private validateUpdateTenant() {
    return [
      param('id')
        .isUUID()
        .withMessage('Valid tenant ID is required'),
      body('name')
        .optional()
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Tenant name must be between 2 and 100 characters')
    ];
  }

  private validateListTenants() {
    return [
      query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
      query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
      query('status')
        .optional()
        .isIn(['active', 'suspended', 'trial', 'cancelled', 'pending'])
        .withMessage('Invalid status filter')
    ];
  }

  private validateUpdateSettings() {
    return [
      param('id')
        .isUUID()
        .withMessage('Valid tenant ID is required'),
      body('branding.companyName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Company name must be between 1 and 100 characters'),
      body('branding.primaryColor')
        .optional()
        .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
        .withMessage('Primary color must be a valid hex color')
    ];
  }

  private validateUpdateBilling() {
    return [
      param('id')
        .isUUID()
        .withMessage('Valid tenant ID is required'),
      body('plan')
        .optional()
        .isIn(['starter', 'professional', 'enterprise', 'custom'])
        .withMessage('Invalid plan'),
      body('billingCycle')
        .optional()
        .isIn(['monthly', 'yearly'])
        .withMessage('Billing cycle must be monthly or yearly')
    ];
  }

  private validateSuspendTenant() {
    return [
      param('id')
        .isUUID()
        .withMessage('Valid tenant ID is required'),
      body('reason')
        .trim()
        .isLength({ min: 1, max: 500 })
        .withMessage('Suspension reason is required and must be less than 500 characters')
    ];
  }

  private validateCancelTenant() {
    return [
      param('id')
        .isUUID()
        .withMessage('Valid tenant ID is required'),
      body('reason')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Cancellation reason must be less than 500 characters')
    ];
  }

  // Middleware methods

  private handleValidationErrors(req: Request, res: Response, next: NextFunction): void {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array().reduce((acc, error) => {
          acc[error.param] = error.msg;
          return acc;
        }, {} as Record<string, string>)
      });
      return;
    }
    next();
  }

  private requireAuthentication(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
      return;
    }

    // TODO: Implement JWT token validation
    // For development, we'll use a mock user
    req.user = {
      id: 'mock-user-id',
      email: 'mock@example.com',
      roles: ['user']
    };

    next();
  }

  private requireTenantAccess(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    // This would check if user has access to the tenant
    // For now, allow all authenticated users
    next();
  }

  private requireTenantOwnership(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    // This would check if user owns the tenant
    // For now, allow all authenticated users
    next();
  }

  private requireAdminRole(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const user = req.user!;

    if (user.roles.includes('admin')) {
      next();
    } else {
      res.status(403).json({
        success: false,
        error: 'Admin access required'
      });
    }
  }
}
