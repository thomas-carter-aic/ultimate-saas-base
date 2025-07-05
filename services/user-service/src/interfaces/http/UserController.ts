/**
 * User HTTP Controller
 * 
 * REST API controller for user management operations.
 * Handles HTTP requests, validation, authentication, and response formatting.
 * Follows clean architecture principles by delegating business logic to use cases.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { trace, context } from '@opentelemetry/api';

import { CreateUserUseCase } from '../../application/usecases/CreateUserUseCase';
import { GetUserUseCase } from '../../application/usecases/GetUserUseCase';
import { UpdateUserUseCase } from '../../application/usecases/UpdateUserUseCase';
import { ListUsersUseCase } from '../../application/usecases/ListUsersUseCase';
import { Logger } from '../../application/ports/Logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
  tenantId?: string;
}

export class UserController {
  private router: Router;
  private createUserRateLimit: any;
  private generalRateLimit: any;

  constructor(
    private readonly createUserUseCase: CreateUserUseCase,
    private readonly getUserUseCase: GetUserUseCase,
    private readonly updateUserUseCase: UpdateUserUseCase,
    private readonly listUsersUseCase: ListUsersUseCase,
    private readonly logger: Logger
  ) {
    this.router = Router();
    this.setupRateLimiting();
    this.setupRoutes();
  }

  /**
   * Get Express router with all user routes
   */
  public getRouter(): Router {
    return this.router;
  }

  /**
   * Setup rate limiting for different endpoints
   */
  private setupRateLimiting(): void {
    // Stricter rate limiting for user creation
    this.createUserRateLimit = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 user creations per window
      message: {
        error: 'Too many user creation attempts',
        message: 'Please try again later',
        retryAfter: '15 minutes'
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: Request) => {
        // Rate limit by IP and tenant
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const tenantId = req.headers['x-tenant-id'] || 'unknown';
        return `${ip}:${tenantId}`;
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
   * Setup all user routes
   */
  private setupRoutes(): void {
    // Apply general rate limiting to all routes
    this.router.use(this.generalRateLimit);

    // User creation endpoint
    this.router.post(
      '/',
      this.createUserRateLimit,
      this.validateCreateUser(),
      this.handleValidationErrors,
      this.createUser.bind(this)
    );

    // Get user by ID
    this.router.get(
      '/:id',
      this.validateGetUser(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.getUser.bind(this)
    );

    // Update user
    this.router.put(
      '/:id',
      this.validateUpdateUser(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireOwnershipOrAdmin,
      this.updateUser.bind(this)
    );

    // List users (admin only)
    this.router.get(
      '/',
      this.validateListUsers(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireAdminRole,
      this.listUsers.bind(this)
    );

    // Get current user profile
    this.router.get(
      '/me/profile',
      this.requireAuthentication,
      this.getCurrentUser.bind(this)
    );

    // Update current user profile
    this.router.patch(
      '/me/profile',
      this.validateUpdateProfile(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.updateCurrentUserProfile.bind(this)
    );

    // Update current user preferences
    this.router.patch(
      '/me/preferences',
      this.validateUpdatePreferences(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.updateCurrentUserPreferences.bind(this)
    );

    // Get user metrics (admin or self)
    this.router.get(
      '/:id/metrics',
      this.validateGetUser(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.requireOwnershipOrAdmin,
      this.getUserMetrics.bind(this)
    );

    // Record user activity
    this.router.post(
      '/me/activity',
      this.validateRecordActivity(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.recordUserActivity.bind(this)
    );
  }

  /**
   * Create new user
   */
  private async createUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const tracer = trace.getTracer('user-service');
    const span = tracer.startSpan('UserController.createUser');

    try {
      context.with(trace.setSpan(context.active(), span), async () => {
        const { email, password, profile, roles, metadata } = req.body;
        const tenantId = req.headers['x-tenant-id'] as string;

        span.setAttributes({
          'user.email': email,
          'user.tenant_id': tenantId,
          'user.roles': roles?.join(',') || 'user'
        });

        this.logger.info('Creating new user', {
          email,
          tenantId,
          roles: roles || ['user'],
          requestId: req.headers['x-request-id']
        });

        const result = await this.createUserUseCase.execute({
          email,
          password,
          tenantId,
          profile,
          roles,
          metadata: {
            ...metadata,
            createdBy: 'api',
            ipAddress: req.ip,
            userAgent: req.headers['user-agent']
          }
        });

        if (result.success) {
          span.setAttributes({
            'user.id': result.user!.id,
            'operation.success': true
          });

          this.logger.info('User created successfully', {
            userId: result.user!.id,
            email: result.user!.email,
            tenantId: result.user!.tenantId
          });

          res.status(201).json({
            success: true,
            data: {
              user: {
                id: result.user!.id,
                email: result.user!.email,
                profile: result.user!.profile,
                roles: result.user!.roles,
                isActive: result.user!.isActive,
                isVerified: result.user!.isVerified,
                createdAt: result.user!.createdAt
              }
            },
            message: 'User created successfully'
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
              error: result.error || 'Failed to create user'
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

      this.logger.error('Unexpected error in createUser', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });

      next(error);
    } finally {
      span.end();
    }
  }

  /**
   * Get user by ID
   */
  private async getUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const tracer = trace.getTracer('user-service');
    const span = tracer.startSpan('UserController.getUser');

    try {
      context.with(trace.setSpan(context.active(), span), async () => {
        const { id } = req.params;
        const tenantId = req.user!.tenantId;

        span.setAttributes({
          'user.id': id,
          'user.tenant_id': tenantId
        });

        const result = await this.getUserUseCase.execute({
          userId: id,
          tenantId,
          requestedBy: req.user!.id
        });

        if (result.success && result.user) {
          res.json({
            success: true,
            data: {
              user: {
                id: result.user.id,
                email: result.user.email,
                profile: result.user.profile,
                preferences: result.user.preferences,
                roles: result.user.roles,
                isActive: result.user.isActive,
                isVerified: result.user.isVerified,
                createdAt: result.user.createdAt,
                updatedAt: result.user.updatedAt
              }
            }
          });
        } else {
          res.status(404).json({
            success: false,
            error: result.error || 'User not found'
          });
        }
      });
    } catch (error) {
      span.recordException(error as Error);
      next(error);
    } finally {
      span.end();
    }
  }

  /**
   * Update user
   */
  private async updateUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const tracer = trace.getTracer('user-service');
    const span = tracer.startSpan('UserController.updateUser');

    try {
      context.with(trace.setSpan(context.active(), span), async () => {
        const { id } = req.params;
        const updates = req.body;
        const tenantId = req.user!.tenantId;

        span.setAttributes({
          'user.id': id,
          'user.tenant_id': tenantId,
          'update.fields': Object.keys(updates).join(',')
        });

        const result = await this.updateUserUseCase.execute({
          userId: id,
          tenantId,
          updates,
          updatedBy: req.user!.id
        });

        if (result.success && result.user) {
          res.json({
            success: true,
            data: {
              user: {
                id: result.user.id,
                email: result.user.email,
                profile: result.user.profile,
                preferences: result.user.preferences,
                roles: result.user.roles,
                isActive: result.user.isActive,
                isVerified: result.user.isVerified,
                updatedAt: result.user.updatedAt
              }
            },
            message: 'User updated successfully'
          });
        } else {
          const statusCode = result.error?.includes('not found') ? 404 : 400;
          res.status(statusCode).json({
            success: false,
            error: result.error || 'Failed to update user'
          });
        }
      });
    } catch (error) {
      span.recordException(error as Error);
      next(error);
    } finally {
      span.end();
    }
  }

  /**
   * List users with pagination and filtering
   */
  private async listUsers(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const tracer = trace.getTracer('user-service');
    const span = tracer.startSpan('UserController.listUsers');

    try {
      context.with(trace.setSpan(context.active(), span), async () => {
        const {
          page = 1,
          limit = 20,
          search,
          role,
          isActive,
          isVerified,
          sortBy = 'createdAt',
          sortOrder = 'desc'
        } = req.query;

        const tenantId = req.user!.tenantId;

        span.setAttributes({
          'query.page': Number(page),
          'query.limit': Number(limit),
          'query.tenant_id': tenantId
        });

        const result = await this.listUsersUseCase.execute({
          tenantId,
          pagination: {
            page: Number(page),
            limit: Math.min(Number(limit), 100) // Cap at 100
          },
          filters: {
            search: search as string,
            role: role as string,
            isActive: isActive === 'true' ? true : isActive === 'false' ? false : undefined,
            isVerified: isVerified === 'true' ? true : isVerified === 'false' ? false : undefined
          },
          sorting: {
            field: sortBy as string,
            order: sortOrder as 'asc' | 'desc'
          },
          requestedBy: req.user!.id
        });

        if (result.success) {
          res.json({
            success: true,
            data: {
              users: result.users?.map(user => ({
                id: user.id,
                email: user.email,
                profile: user.profile,
                roles: user.roles,
                isActive: user.isActive,
                isVerified: user.isVerified,
                createdAt: user.createdAt,
                updatedAt: user.updatedAt
              })),
              pagination: result.pagination
            }
          });
        } else {
          res.status(400).json({
            success: false,
            error: result.error || 'Failed to list users'
          });
        }
      });
    } catch (error) {
      span.recordException(error as Error);
      next(error);
    } finally {
      span.end();
    }
  }

  /**
   * Get current user profile
   */
  private async getCurrentUser(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const tenantId = req.user!.tenantId;

      const result = await this.getUserUseCase.execute({
        userId,
        tenantId,
        requestedBy: userId
      });

      if (result.success && result.user) {
        res.json({
          success: true,
          data: {
            user: {
              id: result.user.id,
              email: result.user.email,
              profile: result.user.profile,
              preferences: result.user.preferences,
              roles: result.user.roles,
              metrics: result.user.metrics,
              isActive: result.user.isActive,
              isVerified: result.user.isVerified,
              createdAt: result.user.createdAt,
              updatedAt: result.user.updatedAt
            }
          }
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'User profile not found'
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update current user profile
   */
  private async updateCurrentUserProfile(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const tenantId = req.user!.tenantId;
      const profileUpdates = req.body;

      const result = await this.updateUserUseCase.execute({
        userId,
        tenantId,
        updates: { profile: profileUpdates },
        updatedBy: userId
      });

      if (result.success && result.user) {
        res.json({
          success: true,
          data: {
            profile: result.user.profile
          },
          message: 'Profile updated successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error || 'Failed to update profile'
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update current user preferences
   */
  private async updateCurrentUserPreferences(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const userId = req.user!.id;
      const tenantId = req.user!.tenantId;
      const preferencesUpdates = req.body;

      const result = await this.updateUserUseCase.execute({
        userId,
        tenantId,
        updates: { preferences: preferencesUpdates },
        updatedBy: userId
      });

      if (result.success && result.user) {
        res.json({
          success: true,
          data: {
            preferences: result.user.preferences
          },
          message: 'Preferences updated successfully'
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error || 'Failed to update preferences'
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user metrics
   */
  private async getUserMetrics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const tenantId = req.user!.tenantId;

      const result = await this.getUserUseCase.execute({
        userId: id,
        tenantId,
        requestedBy: req.user!.id
      });

      if (result.success && result.user) {
        res.json({
          success: true,
          data: {
            metrics: result.user.metrics,
            userId: result.user.id
          }
        });
      } else {
        res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Record user activity
   */
  private async recordUserActivity(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { action, feature, context } = req.body;
      const userId = req.user!.id;
      const tenantId = req.user!.tenantId;

      // This would typically call a RecordActivityUseCase
      // For now, we'll just acknowledge the activity
      this.logger.info('User activity recorded', {
        userId,
        tenantId,
        action,
        feature,
        context
      });

      res.json({
        success: true,
        message: 'Activity recorded successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  // Validation middleware methods

  private validateCreateUser() {
    return [
      body('email')
        .isEmail()
        .normalizeEmail()
        .withMessage('Valid email is required'),
      body('password')
        .isLength({ min: 8 })
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
        .withMessage('Password must be at least 8 characters with uppercase, lowercase, number, and special character'),
      body('profile.firstName')
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('First name is required and must be less than 50 characters'),
      body('profile.lastName')
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Last name is required and must be less than 50 characters'),
      body('profile.company')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Company name must be less than 100 characters'),
      body('profile.jobTitle')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Job title must be less than 100 characters'),
      body('roles')
        .optional()
        .isArray()
        .withMessage('Roles must be an array'),
      body('roles.*')
        .optional()
        .isIn(['user', 'admin', 'manager', 'developer', 'analyst'])
        .withMessage('Invalid role specified')
    ];
  }

  private validateGetUser() {
    return [
      param('id')
        .isUUID()
        .withMessage('Valid user ID is required')
    ];
  }

  private validateUpdateUser() {
    return [
      param('id')
        .isUUID()
        .withMessage('Valid user ID is required'),
      body('profile.firstName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('First name must be between 1 and 50 characters'),
      body('profile.lastName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Last name must be between 1 and 50 characters')
    ];
  }

  private validateListUsers() {
    return [
      query('page')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Page must be a positive integer'),
      query('limit')
        .optional()
        .isInt({ min: 1, max: 100 })
        .withMessage('Limit must be between 1 and 100'),
      query('sortBy')
        .optional()
        .isIn(['createdAt', 'updatedAt', 'email', 'firstName', 'lastName'])
        .withMessage('Invalid sort field'),
      query('sortOrder')
        .optional()
        .isIn(['asc', 'desc'])
        .withMessage('Sort order must be asc or desc')
    ];
  }

  private validateUpdateProfile() {
    return [
      body('firstName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('First name must be between 1 and 50 characters'),
      body('lastName')
        .optional()
        .trim()
        .isLength({ min: 1, max: 50 })
        .withMessage('Last name must be between 1 and 50 characters'),
      body('company')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Company name must be less than 100 characters'),
      body('jobTitle')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Job title must be less than 100 characters')
    ];
  }

  private validateUpdatePreferences() {
    return [
      body('theme')
        .optional()
        .isIn(['light', 'dark', 'auto'])
        .withMessage('Theme must be light, dark, or auto'),
      body('language')
        .optional()
        .isIn(['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'])
        .withMessage('Unsupported language'),
      body('timezone')
        .optional()
        .custom((value) => {
          try {
            Intl.DateTimeFormat(undefined, { timeZone: value });
            return true;
          } catch {
            throw new Error('Invalid timezone');
          }
        })
    ];
  }

  private validateRecordActivity() {
    return [
      body('action')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Action is required and must be less than 100 characters'),
      body('feature')
        .trim()
        .isLength({ min: 1, max: 100 })
        .withMessage('Feature is required and must be less than 100 characters'),
      body('context')
        .optional()
        .isObject()
        .withMessage('Context must be an object')
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
    // This would typically validate JWT token and populate req.user
    // For now, we'll simulate authentication
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
      tenantId: req.headers['x-tenant-id'] as string || 'mock-tenant-id',
      roles: ['user']
    };

    next();
  }

  private requireOwnershipOrAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    const { id } = req.params;
    const user = req.user!;

    if (user.id === id || user.roles.includes('admin')) {
      next();
    } else {
      res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }
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
