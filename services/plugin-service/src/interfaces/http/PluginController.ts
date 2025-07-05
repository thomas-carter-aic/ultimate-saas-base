/**
 * Plugin HTTP Controller
 * 
 * REST API controller for plugin management operations.
 * Handles HTTP requests, validation, authentication, and response formatting.
 * Follows clean architecture principles by delegating business logic to use cases.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { trace, context } from '@opentelemetry/api';

import { UploadPluginUseCase } from '../../application/usecases/UploadPluginUseCase';
import { ExecutePluginUseCase } from '../../application/usecases/ExecutePluginUseCase';
import { PluginRepository } from '../../domain/repositories/PluginRepository';
import { Logger } from '../../application/ports/Logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
}

export class PluginController {
  private router: Router;
  private upload: multer.Multer;
  private uploadRateLimit: any;
  private executeRateLimit: any;
  private generalRateLimit: any;

  constructor(
    private readonly uploadPluginUseCase: UploadPluginUseCase,
    private readonly executePluginUseCase: ExecutePluginUseCase,
    private readonly pluginRepository: PluginRepository,
    private readonly logger: Logger
  ) {
    this.router = Router();
    this.setupMulter();
    this.setupRateLimiting();
    this.setupRoutes();
  }

  /**
   * Get Express router with all plugin routes
   */
  public getRouter(): Router {
    return this.router;
  }

  /**
   * Setup multer for file uploads
   */
  private setupMulter(): void {
    this.upload = multer({
      storage: multer.memoryStorage(),
      limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        files: 1
      },
      fileFilter: (req, file, cb) => {
        const allowedMimeTypes = [
          'application/zip',
          'application/x-zip-compressed',
          'application/gzip',
          'application/x-gzip',
          'application/x-tar',
          'application/x-compressed-tar'
        ];

        if (allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error('Invalid file type. Only ZIP and TAR.GZ files are supported'));
        }
      }
    });
  }

  /**
   * Setup rate limiting for different endpoints
   */
  private setupRateLimiting(): void {
    // Stricter rate limiting for plugin uploads
    this.uploadRateLimit = rateLimit({
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 10, // 10 uploads per hour per user
      message: {
        error: 'Too many plugin uploads',
        message: 'Please try again later',
        retryAfter: '1 hour'
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: AuthenticatedRequest) => {
        return req.user?.id || req.ip || 'anonymous';
      }
    });

    // Rate limiting for plugin execution
    this.executeRateLimit = rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 100, // 100 executions per minute per user
      message: {
        error: 'Too many plugin executions',
        message: 'Please try again later'
      },
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req: AuthenticatedRequest) => {
        return req.user?.id || req.ip || 'anonymous';
      }
    });

    // General rate limiting for other endpoints
    this.generalRateLimit = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 1000, // 1000 requests per window
      message: {
        error: 'Too many requests',
        message: 'Please try again later'
      },
      standardHeaders: true,
      legacyHeaders: false
    });
  }

  /**
   * Setup all plugin routes
   */
  private setupRoutes(): void {
    // Apply general rate limiting to all routes
    this.router.use(this.generalRateLimit);

    // Plugin upload endpoint
    this.router.post(
      '/upload',
      this.uploadRateLimit,
      this.requireAuthentication,
      this.upload.single('plugin'),
      this.validateUpload(),
      this.handleValidationErrors,
      this.uploadPlugin.bind(this)
    );

    // Plugin execution endpoint
    this.router.post(
      '/:id/execute',
      this.executeRateLimit,
      this.validateExecution(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.executePlugin.bind(this)
    );

    // Get plugin by ID
    this.router.get(
      '/:id',
      this.validateGetPlugin(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.getPlugin.bind(this)
    );

    // List plugins
    this.router.get(
      '/',
      this.validateListPlugins(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.listPlugins.bind(this)
    );

    // Update plugin configuration
    this.router.patch(
      '/:id/config',
      this.validateUpdateConfig(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.updatePluginConfig.bind(this)
    );

    // Activate plugin
    this.router.post(
      '/:id/activate',
      this.validateGetPlugin(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.activatePlugin.bind(this)
    );

    // Deactivate plugin
    this.router.post(
      '/:id/deactivate',
      this.validateGetPlugin(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.deactivatePlugin.bind(this)
    );

    // Uninstall plugin
    this.router.delete(
      '/:id',
      this.validateGetPlugin(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.uninstallPlugin.bind(this)
    );

    // Get plugin logs
    this.router.get(
      '/:id/logs',
      this.validateGetLogs(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.getPluginLogs.bind(this)
    );

    // Get plugin metrics
    this.router.get(
      '/:id/metrics',
      this.validateGetPlugin(),
      this.handleValidationErrors,
      this.requireAuthentication,
      this.getPluginMetrics.bind(this)
    );

    // Plugin marketplace endpoints
    this.router.get(
      '/marketplace/featured',
      this.requireAuthentication,
      this.getFeaturedPlugins.bind(this)
    );

    this.router.get(
      '/marketplace/categories',
      this.requireAuthentication,
      this.getPluginCategories.bind(this)
    );
  }

  /**
   * Upload plugin
   */
  private async uploadPlugin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    const tracer = trace.getTracer('plugin-service');
    const span = tracer.startSpan('PluginController.uploadPlugin');

    try {
      context.with(trace.setSpan(context.active(), span), async () => {
        if (!req.file) {
          res.status(400).json({
            success: false,
            error: 'No plugin file provided'
          });
          return;
        }

        const user = req.user!;

        span.setAttributes({
          'plugin.filename': req.file.originalname,
          'plugin.size': req.file.size,
          'tenant.id': user.tenantId,
          'user.id': user.id
        });

        this.logger.info('Uploading plugin', {
          filename: req.file.originalname,
          size: req.file.size,
          tenantId: user.tenantId,
          userId: user.id
        });

        const result = await this.uploadPluginUseCase.execute({
          tenantId: user.tenantId,
          userId: user.id,
          fileName: req.file.originalname,
          fileBuffer: req.file.buffer,
          fileSize: req.file.size,
          mimeType: req.file.mimetype
        });

        if (result.success) {
          span.setAttributes({
            'plugin.id': result.plugin!.id,
            'operation.success': true
          });

          res.status(201).json({
            success: true,
            data: {
              plugin: result.plugin!.toSummary()
            },
            message: 'Plugin uploaded successfully'
          });
        } else {
          span.setAttributes({
            'operation.success': false,
            'error.type': 'validation_error'
          });

          res.status(400).json({
            success: false,
            error: result.error,
            validationErrors: result.validationErrors
          });
        }
      });
    } catch (error) {
      span.recordException(error as Error);
      span.setAttributes({
        'operation.success': false,
        'error.type': 'internal_error'
      });

      this.logger.error('Unexpected error in uploadPlugin', error as Error);
      next(error);
    } finally {
      span.end();
    }
  }

  /**
   * Execute plugin
   */
  private async executePlugin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { functionName, parameters, timeout } = req.body;
      const user = req.user!;

      this.logger.info('Executing plugin', {
        pluginId: id,
        functionName,
        tenantId: user.tenantId,
        userId: user.id
      });

      const result = await this.executePluginUseCase.execute({
        pluginId: id,
        tenantId: user.tenantId,
        userId: user.id,
        functionName,
        parameters,
        timeout,
        trigger: 'api'
      });

      if (result.success) {
        res.status(200).json({
          success: true,
          data: {
            executionId: result.executionId,
            result: result.result,
            metrics: result.metrics
          }
        });
      } else {
        res.status(400).json({
          success: false,
          error: result.error,
          executionId: result.executionId
        });
      }
    } catch (error) {
      this.logger.error('Unexpected error in executePlugin', error as Error);
      next(error);
    }
  }

  /**
   * Get plugin by ID
   */
  private async getPlugin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = req.user!;

      const plugin = await this.pluginRepository.findById(id);
      
      if (!plugin) {
        res.status(404).json({
          success: false,
          error: 'Plugin not found'
        });
        return;
      }

      // Check tenant access
      if (plugin.tenantId !== user.tenantId) {
        res.status(403).json({
          success: false,
          error: 'Unauthorized access to plugin'
        });
        return;
      }

      res.status(200).json({
        success: true,
        data: {
          plugin: plugin.toDetail()
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * List plugins
   */
  private async listPlugins(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const { 
        page = 1, 
        limit = 20, 
        status, 
        category, 
        search,
        sortField = 'createdAt',
        sortDirection = 'desc'
      } = req.query;

      const plugins = await this.pluginRepository.findWithFilters({
        filters: {
          tenantId: user.tenantId,
          status: status as any,
          category: category as string,
          search: search as string
        },
        pagination: {
          page: Number(page),
          limit: Math.min(Number(limit), 100)
        },
        sorting: {
          field: sortField as any,
          direction: sortDirection as any
        }
      });

      const totalCount = await this.pluginRepository.countWithFilters({
        tenantId: user.tenantId,
        status: status as any,
        category: category as string,
        search: search as string
      });

      res.status(200).json({
        success: true,
        data: {
          plugins: plugins.map(p => p.toSummary()),
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: totalCount,
            totalPages: Math.ceil(totalCount / Number(limit))
          }
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update plugin configuration
   */
  private async updatePluginConfig(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { configuration } = req.body;
      const user = req.user!;

      const plugin = await this.pluginRepository.findById(id);
      
      if (!plugin) {
        res.status(404).json({
          success: false,
          error: 'Plugin not found'
        });
        return;
      }

      if (plugin.tenantId !== user.tenantId) {
        res.status(403).json({
          success: false,
          error: 'Unauthorized access to plugin'
        });
        return;
      }

      // Validate configuration
      const validation = plugin.validateConfiguration(configuration);
      if (!validation.isValid) {
        res.status(400).json({
          success: false,
          error: 'Invalid configuration',
          validationErrors: validation.errors
        });
        return;
      }

      const updatedPlugin = plugin.updateConfiguration(configuration);
      await this.pluginRepository.update(updatedPlugin);

      res.status(200).json({
        success: true,
        data: {
          plugin: updatedPlugin.toSummary()
        },
        message: 'Plugin configuration updated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Activate plugin
   */
  private async activatePlugin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = req.user!;

      const plugin = await this.pluginRepository.findById(id);
      
      if (!plugin) {
        res.status(404).json({
          success: false,
          error: 'Plugin not found'
        });
        return;
      }

      if (plugin.tenantId !== user.tenantId) {
        res.status(403).json({
          success: false,
          error: 'Unauthorized access to plugin'
        });
        return;
      }

      if (plugin.status !== 'installed') {
        res.status(400).json({
          success: false,
          error: `Cannot activate plugin with status: ${plugin.status}`
        });
        return;
      }

      const activatedPlugin = plugin.updateStatus('active');
      await this.pluginRepository.update(activatedPlugin);

      res.status(200).json({
        success: true,
        data: {
          plugin: activatedPlugin.toSummary()
        },
        message: 'Plugin activated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Deactivate plugin
   */
  private async deactivatePlugin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = req.user!;

      const plugin = await this.pluginRepository.findById(id);
      
      if (!plugin) {
        res.status(404).json({
          success: false,
          error: 'Plugin not found'
        });
        return;
      }

      if (plugin.tenantId !== user.tenantId) {
        res.status(403).json({
          success: false,
          error: 'Unauthorized access to plugin'
        });
        return;
      }

      const deactivatedPlugin = plugin.updateStatus('inactive');
      await this.pluginRepository.update(deactivatedPlugin);

      res.status(200).json({
        success: true,
        data: {
          plugin: deactivatedPlugin.toSummary()
        },
        message: 'Plugin deactivated successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Uninstall plugin
   */
  private async uninstallPlugin(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = req.user!;

      const plugin = await this.pluginRepository.findById(id);
      
      if (!plugin) {
        res.status(404).json({
          success: false,
          error: 'Plugin not found'
        });
        return;
      }

      if (plugin.tenantId !== user.tenantId) {
        res.status(403).json({
          success: false,
          error: 'Unauthorized access to plugin'
        });
        return;
      }

      // Check for dependents
      const dependents = await this.pluginRepository.findDependents(plugin.manifest.metadata.name, user.tenantId);
      if (dependents.length > 0) {
        res.status(400).json({
          success: false,
          error: 'Cannot uninstall plugin with active dependents',
          dependents: dependents.map(p => p.manifest.metadata.name)
        });
        return;
      }

      await this.pluginRepository.delete(id);

      res.status(200).json({
        success: true,
        message: 'Plugin uninstalled successfully'
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get plugin logs
   */
  private async getPluginLogs(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const { level, limit = 100, offset = 0 } = req.query;
      const user = req.user!;

      const plugin = await this.pluginRepository.findById(id);
      
      if (!plugin) {
        res.status(404).json({
          success: false,
          error: 'Plugin not found'
        });
        return;
      }

      if (plugin.tenantId !== user.tenantId) {
        res.status(403).json({
          success: false,
          error: 'Unauthorized access to plugin'
        });
        return;
      }

      const logs = await this.pluginRepository.getPluginLogs(id, {
        level: level as any,
        limit: Number(limit),
        offset: Number(offset)
      });

      res.status(200).json({
        success: true,
        data: {
          logs
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get plugin metrics
   */
  private async getPluginMetrics(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const user = req.user!;

      const plugin = await this.pluginRepository.findById(id);
      
      if (!plugin) {
        res.status(404).json({
          success: false,
          error: 'Plugin not found'
        });
        return;
      }

      if (plugin.tenantId !== user.tenantId) {
        res.status(403).json({
          success: false,
          error: 'Unauthorized access to plugin'
        });
        return;
      }

      const stats = await this.pluginRepository.getExecutionStats(id);

      res.status(200).json({
        success: true,
        data: {
          health: plugin.getHealthMetrics(),
          execution: stats
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get featured plugins
   */
  private async getFeaturedPlugins(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const marketplaceData = await this.pluginRepository.getMarketplaceData(user.tenantId);

      res.status(200).json({
        success: true,
        data: {
          featured: marketplaceData.featured.map(p => p.toSummary())
        }
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get plugin categories
   */
  private async getPluginCategories(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = req.user!;
      const marketplaceData = await this.pluginRepository.getMarketplaceData(user.tenantId);

      res.status(200).json({
        success: true,
        data: {
          categories: marketplaceData.categories
        }
      });
    } catch (error) {
      next(error);
    }
  }

  // Validation middleware methods

  private validateUpload() {
    return [
      // File validation is handled by multer
    ];
  }

  private validateExecution() {
    return [
      param('id').isUUID().withMessage('Valid plugin ID is required'),
      body('functionName').optional().isString().withMessage('Function name must be a string'),
      body('parameters').optional().isObject().withMessage('Parameters must be an object'),
      body('timeout').optional().isInt({ min: 1000, max: 300000 }).withMessage('Timeout must be between 1 second and 5 minutes')
    ];
  }

  private validateGetPlugin() {
    return [
      param('id').isUUID().withMessage('Valid plugin ID is required')
    ];
  }

  private validateListPlugins() {
    return [
      query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
      query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
      query('status').optional().isIn(['pending', 'validating', 'validated', 'installing', 'installed', 'active', 'inactive', 'error', 'deprecated', 'removed']).withMessage('Invalid status'),
      query('category').optional().isIn(['ai', 'integration', 'analytics', 'workflow', 'ui', 'utility']).withMessage('Invalid category'),
      query('sortField').optional().isIn(['name', 'version', 'createdAt', 'updatedAt', 'executionCount', 'errorRate']).withMessage('Invalid sort field'),
      query('sortDirection').optional().isIn(['asc', 'desc']).withMessage('Invalid sort direction')
    ];
  }

  private validateUpdateConfig() {
    return [
      param('id').isUUID().withMessage('Valid plugin ID is required'),
      body('configuration').isObject().withMessage('Configuration must be an object')
    ];
  }

  private validateGetLogs() {
    return [
      param('id').isUUID().withMessage('Valid plugin ID is required'),
      query('level').optional().isIn(['error', 'warn', 'info', 'debug']).withMessage('Invalid log level'),
      query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('Limit must be between 1 and 1000'),
      query('offset').optional().isInt({ min: 0 }).withMessage('Offset must be non-negative')
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
      id: req.headers['x-user-id'] as string || 'mock-user-id',
      email: 'mock@example.com',
      tenantId: req.headers['x-tenant-id'] as string || 'mock-tenant-id',
      roles: ['user']
    };

    next();
  }
}
