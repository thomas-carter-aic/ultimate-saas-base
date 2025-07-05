import { Request, Response } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import { TrainModelUseCase } from '../../../application/usecases/TrainModelUseCase';
import { PredictUseCase } from '../../../application/usecases/PredictUseCase';
import { DeployModelUseCase } from '../../../application/usecases/DeployModelUseCase';
import { MLModelRepository } from '../../../infrastructure/repositories/MLModelRepository';
import { Logger } from '../../../../shared/infrastructure/logging/Logger';
import { MetricsCollector } from '../../../../shared/infrastructure/monitoring/MetricsCollector';
import { MLModel } from '../../../domain/entities/MLModel';

export class MLModelController {
  constructor(
    private readonly trainModelUseCase: TrainModelUseCase,
    private readonly predictUseCase: PredictUseCase,
    private readonly deployModelUseCase: DeployModelUseCase,
    private readonly modelRepository: MLModelRepository,
    private readonly logger: Logger,
    private readonly metrics: MetricsCollector
  ) {}

  // Validation middleware
  static validateCreateModel = [
    body('name').isString().isLength({ min: 3, max: 255 }).withMessage('Name must be 3-255 characters'),
    body('description').optional().isString().isLength({ max: 1000 }),
    body('framework').isIn(['tensorflow', 'pytorch', 'scikit-learn', 'xgboost', 'onnx']),
    body('category').isIn(['classification', 'regression', 'nlp', 'computer_vision', 'time_series', 'recommendation']),
    body('version').optional().isString().matches(/^\d+\.\d+\.\d+$/),
    body('configuration').isObject(),
    body('inputSchema').isObject(),
    body('outputSchema').isObject(),
    body('tags').optional().isArray()
  ];

  static validateTrainModel = [
    param('modelId').isUUID(),
    body('trainingConfig').isObject(),
    body('datasetConfig').isObject(),
    body('hyperparameters').optional().isObject(),
    body('resourceConfig').optional().isObject()
  ];

  static validatePredict = [
    param('modelId').isUUID(),
    body('input').exists().withMessage('Input data is required'),
    body('options').optional().isObject()
  ];

  static validateBatchPredict = [
    param('modelId').isUUID(),
    body('inputs').isArray().isLength({ min: 1, max: 1000 }).withMessage('Inputs must be array of 1-1000 items'),
    body('options').optional().isObject()
  ];

  static validateDeploy = [
    param('modelId').isUUID(),
    body('deploymentName').isString().isLength({ min: 3, max: 63 }).matches(/^[a-z0-9-]+$/),
    body('environment').isIn(['development', 'staging', 'production']),
    body('minReplicas').isInt({ min: 1, max: 100 }),
    body('maxReplicas').isInt({ min: 1, max: 100 }),
    body('resourceLimits').isObject(),
    body('healthCheck').isObject(),
    body('autoscaling').optional().isObject(),
    body('monitoring').optional().isObject()
  ];

  static validateModelId = [
    param('modelId').isUUID()
  ];

  static validateSearch = [
    query('framework').optional().isIn(['tensorflow', 'pytorch', 'scikit-learn', 'xgboost', 'onnx']),
    query('category').optional().isIn(['classification', 'regression', 'nlp', 'computer_vision', 'time_series', 'recommendation']),
    query('status').optional().isIn(['draft', 'training', 'trained', 'validated', 'deployed', 'retired']),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('offset').optional().isInt({ min: 0 })
  ];

  // Create a new ML model
  async createModel(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      // Validate request
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
        return;
      }

      const tenantId = req.headers['x-tenant-id'] as string;
      if (!tenantId) {
        res.status(400).json({
          success: false,
          error: 'Tenant ID is required'
        });
        return;
      }

      const {
        name,
        description,
        framework,
        category,
        version = '1.0.0',
        configuration,
        inputSchema,
        outputSchema,
        tags = []
      } = req.body;

      // Create ML model entity
      const model = new MLModel(
        undefined, // ID will be generated
        tenantId,
        name,
        description,
        framework,
        category,
        version,
        '', // Artifact path will be set during training
        configuration,
        inputSchema,
        outputSchema,
        {}, // Performance metrics will be updated during training
        {}, // Deployment config will be set during deployment
        tags,
        'draft'
      );

      // Save model
      const savedModel = await this.modelRepository.save(model);

      // Record metrics
      this.recordOperationMetrics('create_model', Date.now() - startTime, true);

      this.logger.info('ML model created successfully', {
        modelId: savedModel.id,
        tenantId,
        name,
        framework
      });

      res.status(201).json({
        success: true,
        data: {
          id: savedModel.id,
          name: savedModel.name,
          framework: savedModel.framework,
          category: savedModel.category,
          version: savedModel.version,
          status: savedModel.status,
          createdAt: savedModel.createdAt
        }
      });

    } catch (error) {
      this.handleError(error, res, 'create_model', Date.now() - startTime);
    }
  }

  // Get model by ID
  async getModel(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
        return;
      }

      const { modelId } = req.params;
      const tenantId = req.headers['x-tenant-id'] as string;

      const model = await this.modelRepository.findById(modelId, tenantId);
      
      if (!model) {
        res.status(404).json({
          success: false,
          error: 'Model not found'
        });
        return;
      }

      this.recordOperationMetrics('get_model', Date.now() - startTime, true);

      res.json({
        success: true,
        data: this.formatModelResponse(model)
      });

    } catch (error) {
      this.handleError(error, res, 'get_model', Date.now() - startTime);
    }
  }

  // Search models
  async searchModels(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
        return;
      }

      const tenantId = req.headers['x-tenant-id'] as string;
      const {
        framework,
        category,
        status,
        tags,
        sortBy = 'created_at',
        sortOrder = 'desc',
        limit = 50,
        offset = 0
      } = req.query;

      const searchOptions = {
        filter: {
          framework: framework as string,
          category: category as string,
          status: status as string,
          tags: tags ? (Array.isArray(tags) ? tags : [tags]) as string[] : undefined
        },
        sortBy: sortBy as any,
        sortOrder: sortOrder as any,
        limit: parseInt(limit as string),
        offset: parseInt(offset as string)
      };

      const result = await this.modelRepository.search(tenantId, searchOptions);

      this.recordOperationMetrics('search_models', Date.now() - startTime, true);

      res.json({
        success: true,
        data: {
          models: result.models.map(model => this.formatModelResponse(model)),
          pagination: {
            total: result.total,
            limit: searchOptions.limit,
            offset: searchOptions.offset,
            hasMore: result.hasMore
          }
        }
      });

    } catch (error) {
      this.handleError(error, res, 'search_models', Date.now() - startTime);
    }
  }

  // Train a model
  async trainModel(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
        return;
      }

      const { modelId } = req.params;
      const tenantId = req.headers['x-tenant-id'] as string;
      const {
        trainingConfig,
        datasetConfig,
        hyperparameters = {},
        resourceConfig = {}
      } = req.body;

      // Start training (async operation)
      const trainingJob = await this.trainModelUseCase.execute(
        modelId,
        tenantId,
        {
          trainingConfig,
          datasetConfig,
          hyperparameters,
          resourceConfig
        }
      );

      this.recordOperationMetrics('train_model', Date.now() - startTime, true);

      this.logger.info('Model training started', {
        modelId,
        tenantId,
        trainingJobId: trainingJob.id
      });

      res.status(202).json({
        success: true,
        message: 'Training started',
        data: {
          trainingJobId: trainingJob.id,
          status: trainingJob.status,
          estimatedDuration: trainingJob.estimatedDuration,
          progress: trainingJob.progress
        }
      });

    } catch (error) {
      this.handleError(error, res, 'train_model', Date.now() - startTime);
    }
  }

  // Make prediction
  async predict(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
        return;
      }

      const { modelId } = req.params;
      const tenantId = req.headers['x-tenant-id'] as string;
      const { input, options = {} } = req.body;

      const result = await this.predictUseCase.execute(modelId, tenantId, input, options);

      this.recordOperationMetrics('predict', Date.now() - startTime, true);

      res.json({
        success: true,
        data: {
          prediction: result.prediction,
          confidence: result.confidence,
          featureImportance: result.featureImportance,
          metadata: result.metadata
        }
      });

    } catch (error) {
      this.handleError(error, res, 'predict', Date.now() - startTime);
    }
  }

  // Make batch predictions
  async batchPredict(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
        return;
      }

      const { modelId } = req.params;
      const tenantId = req.headers['x-tenant-id'] as string;
      const { inputs, options = {} } = req.body;

      const result = await this.predictUseCase.executeBatch(modelId, tenantId, inputs, options);

      this.recordOperationMetrics('batch_predict', Date.now() - startTime, true);

      res.json({
        success: true,
        data: {
          results: result.results,
          errors: result.errors,
          metadata: result.metadata
        }
      });

    } catch (error) {
      this.handleError(error, res, 'batch_predict', Date.now() - startTime);
    }
  }

  // Deploy model
  async deployModel(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
        return;
      }

      const { modelId } = req.params;
      const tenantId = req.headers['x-tenant-id'] as string;
      const deploymentConfig = req.body;

      const deployment = await this.deployModelUseCase.execute(
        modelId,
        tenantId,
        deploymentConfig
      );

      this.recordOperationMetrics('deploy_model', Date.now() - startTime, true);

      this.logger.info('Model deployment started', {
        modelId,
        tenantId,
        deploymentId: deployment.deploymentId
      });

      res.status(202).json({
        success: true,
        message: 'Deployment started',
        data: {
          deploymentId: deployment.deploymentId,
          endpointUrl: deployment.endpointUrl,
          status: deployment.status,
          replicas: deployment.replicas,
          estimatedReadyTime: deployment.estimatedReadyTime
        }
      });

    } catch (error) {
      this.handleError(error, res, 'deploy_model', Date.now() - startTime);
    }
  }

  // Update model
  async updateModel(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const { modelId } = req.params;
      const tenantId = req.headers['x-tenant-id'] as string;

      const model = await this.modelRepository.findById(modelId, tenantId);
      if (!model) {
        res.status(404).json({
          success: false,
          error: 'Model not found'
        });
        return;
      }

      // Update allowed fields
      const {
        name,
        description,
        configuration,
        tags,
        performanceMetrics,
        deploymentConfig
      } = req.body;

      if (name) model.name = name;
      if (description !== undefined) model.description = description;
      if (configuration) model.configuration = { ...model.configuration, ...configuration };
      if (tags) model.tags = tags;
      if (performanceMetrics) model.performanceMetrics = { ...model.performanceMetrics, ...performanceMetrics };
      if (deploymentConfig) model.deploymentConfig = { ...model.deploymentConfig, ...deploymentConfig };

      model.updatedAt = new Date();

      const updatedModel = await this.modelRepository.save(model);

      this.recordOperationMetrics('update_model', Date.now() - startTime, true);

      res.json({
        success: true,
        data: this.formatModelResponse(updatedModel)
      });

    } catch (error) {
      this.handleError(error, res, 'update_model', Date.now() - startTime);
    }
  }

  // Delete model
  async deleteModel(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
        return;
      }

      const { modelId } = req.params;
      const tenantId = req.headers['x-tenant-id'] as string;

      const deleted = await this.modelRepository.delete(modelId, tenantId);
      
      if (!deleted) {
        res.status(404).json({
          success: false,
          error: 'Model not found'
        });
        return;
      }

      this.recordOperationMetrics('delete_model', Date.now() - startTime, true);

      this.logger.info('ML model deleted', { modelId, tenantId });

      res.json({
        success: true,
        message: 'Model deleted successfully'
      });

    } catch (error) {
      this.handleError(error, res, 'delete_model', Date.now() - startTime);
    }
  }

  // Get model statistics
  async getModelStatistics(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    
    try {
      const tenantId = req.headers['x-tenant-id'] as string;

      const stats = await this.modelRepository.getModelStatistics(tenantId);

      this.recordOperationMetrics('get_model_statistics', Date.now() - startTime, true);

      res.json({
        success: true,
        data: stats
      });

    } catch (error) {
      this.handleError(error, res, 'get_model_statistics', Date.now() - startTime);
    }
  }

  // Health check endpoint
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      // Basic health check - could be expanded to check dependencies
      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'ai-service',
        version: process.env.SERVICE_VERSION || '1.0.0'
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        status: 'unhealthy',
        error: error.message
      });
    }
  }

  // Format model response for API
  private formatModelResponse(model: MLModel): any {
    return {
      id: model.id,
      name: model.name,
      description: model.description,
      framework: model.framework,
      category: model.category,
      version: model.version,
      status: model.status,
      configuration: model.configuration,
      inputSchema: model.inputSchema,
      outputSchema: model.outputSchema,
      performanceMetrics: model.performanceMetrics,
      deploymentConfig: model.deploymentConfig,
      tags: model.tags,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt
    };
  }

  // Record operation metrics
  private recordOperationMetrics(operation: string, duration: number, success: boolean): void {
    this.metrics.recordHistogram('ai_service_operation_duration_ms', duration, {
      operation,
      success: success.toString()
    });

    this.metrics.incrementCounter('ai_service_operations_total', {
      operation,
      success: success.toString()
    });
  }

  // Handle errors consistently
  private handleError(error: any, res: Response, operation: string, duration: number): void {
    this.logger.error(`AI Service operation failed: ${operation}`, {
      error: error.message,
      stack: error.stack,
      duration
    });

    this.recordOperationMetrics(operation, duration, false);

    const statusCode = error.statusCode || 500;
    const message = error.message || 'Internal server error';

    res.status(statusCode).json({
      success: false,
      error: message,
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
}
