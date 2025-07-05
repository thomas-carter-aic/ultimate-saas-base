/**
 * Train Model Use Case
 * 
 * Handles the training of machine learning models with support for
 * various frameworks, distributed training, and comprehensive monitoring.
 */

import { v4 as uuidv4 } from 'uuid';
import { MLModel, ModelStatus } from '../../domain/entities/MLModel';
import { MLModelRepository } from '../../domain/repositories/MLModelRepository';
import { EventPublisher } from '../ports/EventPublisher';
import { Logger } from '../ports/Logger';
import { TrainingService } from '../ports/TrainingService';
import { DatasetService } from '../ports/DatasetService';
import { ModelEventFactory } from '../../domain/events/ModelEvents';

export interface TrainModelRequest {
  modelId: string;
  tenantId: string;
  userId: string;
  trainingConfig: {
    datasetId: string;
    validationSplit?: number;
    epochs?: number;
    batchSize?: number;
    learningRate?: number;
    optimizer?: string;
    lossFunction?: string;
    metrics?: string[];
    earlyStopping?: {
      enabled: boolean;
      patience: number;
      monitor: string;
      minDelta: number;
    };
    checkpointing?: {
      enabled: boolean;
      frequency: number;
      saveWeights: boolean;
    };
    distributedTraining?: {
      enabled: boolean;
      strategy: 'mirrored' | 'parameter-server' | 'multi-worker';
      workers: number;
    };
  };
  computeResources?: {
    cpu: string;
    memory: string;
    gpu?: string;
    accelerator?: 'nvidia-tesla-k80' | 'nvidia-tesla-p4' | 'nvidia-tesla-v100' | 'nvidia-tesla-t4';
  };
  priority?: 'low' | 'normal' | 'high';
  timeout?: number; // minutes
}

export interface TrainModelResponse {
  success: boolean;
  trainingJobId?: string;
  model?: MLModel;
  error?: string;
  estimatedDuration?: number; // minutes
}

export interface TrainingProgress {
  epoch: number;
  totalEpochs: number;
  loss: number;
  accuracy?: number;
  validationLoss?: number;
  validationAccuracy?: number;
  elapsedTime: number; // seconds
  estimatedTimeRemaining?: number; // seconds
  metrics: Record<string, number>;
}

export class TrainModelUseCase {
  constructor(
    private modelRepository: MLModelRepository,
    private trainingService: TrainingService,
    private datasetService: DatasetService,
    private eventPublisher: EventPublisher,
    private logger: Logger
  ) {}

  async execute(request: TrainModelRequest): Promise<TrainModelResponse> {
    const trainingJobId = uuidv4();
    
    try {
      this.logger.info('Starting model training', {
        modelId: request.modelId,
        tenantId: request.tenantId,
        userId: request.userId,
        trainingJobId
      });

      // Validate input
      const inputValidation = this.validateInput(request);
      if (!inputValidation.isValid) {
        return {
          success: false,
          error: inputValidation.errors.join(', ')
        };
      }

      // Get model
      const model = await this.modelRepository.findById(request.modelId);
      if (!model) {
        return {
          success: false,
          error: 'Model not found'
        };
      }

      // Verify tenant access
      if (model.tenantId !== request.tenantId) {
        this.logger.warn('Unauthorized model training attempt', {
          modelId: request.modelId,
          modelTenantId: model.tenantId,
          requestTenantId: request.tenantId,
          userId: request.userId
        });

        return {
          success: false,
          error: 'Unauthorized access to model'
        };
      }

      // Check if model can be trained
      if (!this.canTrain(model)) {
        return {
          success: false,
          error: `Model cannot be trained in current status: ${model.status}`
        };
      }

      // Validate dataset
      const dataset = await this.datasetService.getDataset(request.trainingConfig.datasetId);
      if (!dataset) {
        return {
          success: false,
          error: 'Training dataset not found'
        };
      }

      // Validate dataset compatibility
      const compatibilityCheck = this.validateDatasetCompatibility(model, dataset);
      if (!compatibilityCheck.isCompatible) {
        return {
          success: false,
          error: `Dataset incompatible: ${compatibilityCheck.reason}`
        };
      }

      // Update model status to training
      const trainingModel = model.updateStatus('training');
      await this.modelRepository.update(trainingModel);

      // Publish training started event
      const trainingStartedEvent = ModelEventFactory.createModelTrainingStartedEvent(
        model,
        request.userId,
        trainingJobId,
        request.trainingConfig
      );
      await this.eventPublisher.publish(trainingStartedEvent);

      // Prepare training configuration
      const trainingConfig = this.prepareTrainingConfig(model, request);

      // Estimate training duration
      const estimatedDuration = this.estimateTrainingDuration(model, dataset, request.trainingConfig);

      // Start training job
      const trainingJob = await this.trainingService.startTraining({
        jobId: trainingJobId,
        model: trainingModel,
        dataset,
        config: trainingConfig,
        resources: request.computeResources,
        priority: request.priority || 'normal',
        timeout: request.timeout,
        callbacks: {
          onProgress: (progress: TrainingProgress) => this.handleTrainingProgress(trainingJobId, progress),
          onComplete: (result: any) => this.handleTrainingComplete(trainingJobId, result),
          onError: (error: Error) => this.handleTrainingError(trainingJobId, error)
        }
      });

      if (!trainingJob.success) {
        // Revert model status
        await this.modelRepository.update(model.updateStatus('draft'));
        
        return {
          success: false,
          error: trainingJob.error
        };
      }

      this.logger.info('Model training started successfully', {
        modelId: request.modelId,
        trainingJobId,
        estimatedDuration
      });

      return {
        success: true,
        trainingJobId,
        model: trainingModel,
        estimatedDuration
      };

    } catch (error) {
      this.logger.error('Error starting model training', error as Error, {
        modelId: request.modelId,
        tenantId: request.tenantId,
        userId: request.userId,
        trainingJobId
      });

      // Publish training failed event
      try {
        const model = await this.modelRepository.findById(request.modelId);
        if (model) {
          const trainingFailedEvent = ModelEventFactory.createModelTrainingFailedEvent(
            model,
            request.userId,
            trainingJobId,
            (error as Error).message
          );
          await this.eventPublisher.publish(trainingFailedEvent);
        }
      } catch (eventError) {
        this.logger.error('Error publishing training failed event', eventError as Error);
      }

      return {
        success: false,
        error: 'Failed to start model training'
      };
    }
  }

  private validateInput(request: TrainModelRequest): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request.modelId) {
      errors.push('Model ID is required');
    }

    if (!request.tenantId) {
      errors.push('Tenant ID is required');
    }

    if (!request.userId) {
      errors.push('User ID is required');
    }

    if (!request.trainingConfig.datasetId) {
      errors.push('Dataset ID is required');
    }

    if (request.trainingConfig.validationSplit && 
        (request.trainingConfig.validationSplit <= 0 || request.trainingConfig.validationSplit >= 1)) {
      errors.push('Validation split must be between 0 and 1');
    }

    if (request.trainingConfig.epochs && request.trainingConfig.epochs <= 0) {
      errors.push('Epochs must be greater than 0');
    }

    if (request.trainingConfig.batchSize && request.trainingConfig.batchSize <= 0) {
      errors.push('Batch size must be greater than 0');
    }

    if (request.trainingConfig.learningRate && request.trainingConfig.learningRate <= 0) {
      errors.push('Learning rate must be greater than 0');
    }

    if (request.timeout && request.timeout <= 0) {
      errors.push('Timeout must be greater than 0');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private canTrain(model: MLModel): boolean {
    const trainableStatuses: ModelStatus[] = ['draft', 'failed'];
    return trainableStatuses.includes(model.status);
  }

  private validateDatasetCompatibility(model: MLModel, dataset: any): { isCompatible: boolean; reason?: string } {
    // Check if dataset schema matches model input schema
    if (model.configuration.inputSchema.type !== dataset.schema.type) {
      return {
        isCompatible: false,
        reason: `Input schema type mismatch: expected ${model.configuration.inputSchema.type}, got ${dataset.schema.type}`
      };
    }

    // Check if dataset has required features
    if (model.configuration.inputSchema.required) {
      const missingFeatures = model.configuration.inputSchema.required.filter(
        (feature: string) => !dataset.features.includes(feature)
      );
      
      if (missingFeatures.length > 0) {
        return {
          isCompatible: false,
          reason: `Missing required features: ${missingFeatures.join(', ')}`
        };
      }
    }

    // Check dataset size
    if (dataset.size < 100) {
      return {
        isCompatible: false,
        reason: 'Dataset too small for training (minimum 100 samples required)'
      };
    }

    return { isCompatible: true };
  }

  private prepareTrainingConfig(model: MLModel, request: TrainModelRequest): any {
    const baseConfig = {
      modelId: model.id,
      framework: model.metadata.framework,
      modelType: model.metadata.modelType,
      inputSchema: model.configuration.inputSchema,
      outputSchema: model.configuration.outputSchema,
      hyperparameters: model.configuration.hyperparameters,
      ...request.trainingConfig
    };

    // Set framework-specific defaults
    switch (model.metadata.framework) {
      case 'tensorflow':
        return {
          ...baseConfig,
          epochs: request.trainingConfig.epochs || 100,
          batchSize: request.trainingConfig.batchSize || 32,
          learningRate: request.trainingConfig.learningRate || 0.001,
          optimizer: request.trainingConfig.optimizer || 'adam',
          lossFunction: request.trainingConfig.lossFunction || this.getDefaultLoss(model.metadata.category),
          metrics: request.trainingConfig.metrics || this.getDefaultMetrics(model.metadata.category)
        };

      case 'pytorch':
        return {
          ...baseConfig,
          epochs: request.trainingConfig.epochs || 100,
          batchSize: request.trainingConfig.batchSize || 32,
          learningRate: request.trainingConfig.learningRate || 0.001,
          optimizer: request.trainingConfig.optimizer || 'adam',
          lossFunction: request.trainingConfig.lossFunction || this.getDefaultLoss(model.metadata.category)
        };

      case 'scikit-learn':
        return {
          ...baseConfig,
          // Scikit-learn specific configuration
          crossValidation: request.trainingConfig.validationSplit || 0.2,
          randomState: 42
        };

      default:
        return baseConfig;
    }
  }

  private getDefaultLoss(category: string): string {
    const lossMap: Record<string, string> = {
      'classification': 'categorical_crossentropy',
      'regression': 'mean_squared_error',
      'nlp': 'sparse_categorical_crossentropy',
      'computer-vision': 'categorical_crossentropy',
      'recommendation': 'mean_squared_error',
      'anomaly-detection': 'binary_crossentropy',
      'time-series': 'mean_squared_error'
    };

    return lossMap[category] || 'mean_squared_error';
  }

  private getDefaultMetrics(category: string): string[] {
    const metricsMap: Record<string, string[]> = {
      'classification': ['accuracy', 'precision', 'recall'],
      'regression': ['mae', 'mse'],
      'nlp': ['accuracy', 'perplexity'],
      'computer-vision': ['accuracy', 'top_5_accuracy'],
      'recommendation': ['mae', 'rmse'],
      'anomaly-detection': ['precision', 'recall', 'f1'],
      'time-series': ['mae', 'mape']
    };

    return metricsMap[category] || ['accuracy'];
  }

  private estimateTrainingDuration(model: MLModel, dataset: any, config: any): number {
    // Simple estimation based on dataset size, epochs, and model complexity
    const baseTimePerEpoch = Math.max(1, Math.log10(dataset.size) * 2); // minutes
    const epochs = config.epochs || 100;
    const complexityMultiplier = this.getComplexityMultiplier(model.metadata.framework, model.metadata.modelType);
    
    return Math.ceil(baseTimePerEpoch * epochs * complexityMultiplier);
  }

  private getComplexityMultiplier(framework: string, modelType: string): number {
    const frameworkMultipliers: Record<string, number> = {
      'tensorflow': 1.2,
      'pytorch': 1.1,
      'scikit-learn': 0.5,
      'xgboost': 0.3,
      'onnx': 1.0,
      'custom': 1.5
    };

    const typeMultipliers: Record<string, number> = {
      'deep-learning': 2.0,
      'supervised': 1.0,
      'unsupervised': 0.8,
      'reinforcement': 3.0,
      'ensemble': 1.5
    };

    return (frameworkMultipliers[framework] || 1.0) * (typeMultipliers[modelType] || 1.0);
  }

  private async handleTrainingProgress(trainingJobId: string, progress: TrainingProgress): Promise<void> {
    try {
      this.logger.info('Training progress update', {
        trainingJobId,
        epoch: progress.epoch,
        totalEpochs: progress.totalEpochs,
        loss: progress.loss,
        accuracy: progress.accuracy
      });

      // Publish progress event
      const progressEvent = ModelEventFactory.createModelTrainingProgressEvent(
        trainingJobId,
        progress
      );
      await this.eventPublisher.publish(progressEvent);

    } catch (error) {
      this.logger.error('Error handling training progress', error as Error, { trainingJobId });
    }
  }

  private async handleTrainingComplete(trainingJobId: string, result: any): Promise<void> {
    try {
      this.logger.info('Training completed', {
        trainingJobId,
        finalLoss: result.finalLoss,
        finalAccuracy: result.finalAccuracy,
        duration: result.duration
      });

      // Update model with training results
      const model = await this.modelRepository.findByTrainingJobId(trainingJobId);
      if (model) {
        const trainedModel = model
          .updateStatus('trained')
          .updatePerformance({
            accuracy: result.finalAccuracy,
            ...result.metrics,
            benchmarks: {
              inferenceTime: result.inferenceTime || 0,
              throughput: result.throughput || 0,
              memoryUsage: result.memoryUsage || 0,
              cpuUsage: result.cpuUsage || 0
            }
          })
          .updateArtifacts({
            modelFile: result.modelPath,
            weightsFile: result.weightsPath,
            configFile: result.configPath,
            checksum: result.checksum,
            size: result.size,
            format: result.format
          });

        await this.modelRepository.update(trainedModel);

        // Publish training completed event
        const completedEvent = ModelEventFactory.createModelTrainingCompletedEvent(
          trainedModel,
          trainingJobId,
          result
        );
        await this.eventPublisher.publish(completedEvent);
      }

    } catch (error) {
      this.logger.error('Error handling training completion', error as Error, { trainingJobId });
    }
  }

  private async handleTrainingError(trainingJobId: string, error: Error): Promise<void> {
    try {
      this.logger.error('Training failed', error, { trainingJobId });

      // Update model status to failed
      const model = await this.modelRepository.findByTrainingJobId(trainingJobId);
      if (model) {
        const failedModel = model.updateStatus('failed');
        await this.modelRepository.update(failedModel);

        // Publish training failed event
        const failedEvent = ModelEventFactory.createModelTrainingFailedEvent(
          failedModel,
          model.createdBy,
          trainingJobId,
          error.message
        );
        await this.eventPublisher.publish(failedEvent);
      }

    } catch (handlingError) {
      this.logger.error('Error handling training error', handlingError as Error, { trainingJobId });
    }
  }
}
