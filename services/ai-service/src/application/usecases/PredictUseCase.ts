/**
 * Predict Use Case
 * 
 * Handles prediction requests for deployed ML models with support for
 * batch processing, real-time inference, and comprehensive monitoring.
 */

import { v4 as uuidv4 } from 'uuid';
import { MLModel } from '../../domain/entities/MLModel';
import { MLModelRepository } from '../../domain/repositories/MLModelRepository';
import { EventPublisher } from '../ports/EventPublisher';
import { Logger } from '../ports/Logger';
import { InferenceService } from '../ports/InferenceService';
import { ModelEventFactory } from '../../domain/events/ModelEvents';

export interface PredictRequest {
  modelId: string;
  tenantId: string;
  userId: string;
  input: any; // Input data for prediction
  options?: {
    batchSize?: number;
    timeout?: number; // milliseconds
    returnProbabilities?: boolean;
    returnFeatureImportance?: boolean;
    preprocessingOptions?: Record<string, any>;
    postprocessingOptions?: Record<string, any>;
  };
  metadata?: {
    requestId?: string;
    source?: string;
    tags?: string[];
  };
}

export interface PredictResponse {
  success: boolean;
  predictionId: string;
  predictions?: any;
  probabilities?: number[];
  featureImportance?: Array<{
    feature: string;
    importance: number;
  }>;
  confidence?: number;
  metadata?: {
    modelVersion: string;
    inferenceTime: number; // milliseconds
    preprocessingTime?: number;
    postprocessingTime?: number;
    modelLatency: number;
  };
  error?: string;
}

export interface BatchPredictRequest {
  modelId: string;
  tenantId: string;
  userId: string;
  inputs: any[]; // Array of input data
  options?: {
    batchSize?: number;
    timeout?: number;
    returnProbabilities?: boolean;
    returnFeatureImportance?: boolean;
    parallelProcessing?: boolean;
    maxConcurrency?: number;
  };
  metadata?: {
    requestId?: string;
    source?: string;
    tags?: string[];
  };
}

export interface BatchPredictResponse {
  success: boolean;
  batchId: string;
  predictions?: any[];
  results?: Array<{
    input: any;
    prediction: any;
    probabilities?: number[];
    confidence?: number;
    error?: string;
  }>;
  summary?: {
    totalInputs: number;
    successfulPredictions: number;
    failedPredictions: number;
    averageLatency: number;
    totalProcessingTime: number;
  };
  error?: string;
}

export class PredictUseCase {
  constructor(
    private modelRepository: MLModelRepository,
    private inferenceService: InferenceService,
    private eventPublisher: EventPublisher,
    private logger: Logger
  ) {}

  async predict(request: PredictRequest): Promise<PredictResponse> {
    const predictionId = uuidv4();
    const startTime = Date.now();

    try {
      this.logger.info('Starting prediction', {
        modelId: request.modelId,
        tenantId: request.tenantId,
        userId: request.userId,
        predictionId
      });

      // Validate input
      const inputValidation = this.validatePredictInput(request);
      if (!inputValidation.isValid) {
        return {
          success: false,
          predictionId,
          error: inputValidation.errors.join(', ')
        };
      }

      // Get model
      const model = await this.modelRepository.findById(request.modelId);
      if (!model) {
        return {
          success: false,
          predictionId,
          error: 'Model not found'
        };
      }

      // Verify tenant access
      if (model.tenantId !== request.tenantId) {
        this.logger.warn('Unauthorized prediction attempt', {
          modelId: request.modelId,
          modelTenantId: model.tenantId,
          requestTenantId: request.tenantId,
          userId: request.userId
        });

        return {
          success: false,
          predictionId,
          error: 'Unauthorized access to model'
        };
      }

      // Check if model can serve predictions
      if (!model.canPredict()) {
        return {
          success: false,
          predictionId,
          error: `Model cannot serve predictions (status: ${model.status}, deployment: ${model.deployment.status})`
        };
      }

      // Validate input against model schema
      const schemaValidation = this.validateInputSchema(request.input, model.configuration.inputSchema);
      if (!schemaValidation.isValid) {
        return {
          success: false,
          predictionId,
          error: `Input validation failed: ${schemaValidation.errors.join(', ')}`
        };
      }

      // Publish prediction started event
      const predictionStartedEvent = ModelEventFactory.createModelPredictionStartedEvent(
        model,
        request.userId,
        predictionId,
        request.metadata || {}
      );
      await this.eventPublisher.publish(predictionStartedEvent);

      // Perform prediction
      const inferenceResult = await this.inferenceService.predict({
        model,
        input: request.input,
        options: request.options || {},
        predictionId
      });

      const endTime = Date.now();
      const totalLatency = endTime - startTime;

      if (!inferenceResult.success) {
        // Record failed prediction
        const updatedModel = model.recordUsage(totalLatency, false);
        await this.modelRepository.update(updatedModel);

        // Publish prediction failed event
        const predictionFailedEvent = ModelEventFactory.createModelPredictionFailedEvent(
          model,
          request.userId,
          predictionId,
          inferenceResult.error || 'Unknown error',
          totalLatency
        );
        await this.eventPublisher.publish(predictionFailedEvent);

        return {
          success: false,
          predictionId,
          error: inferenceResult.error
        };
      }

      // Record successful prediction
      const updatedModel = model.recordUsage(totalLatency, true);
      await this.modelRepository.update(updatedModel);

      // Publish prediction completed event
      const predictionCompletedEvent = ModelEventFactory.createModelPredictionCompletedEvent(
        model,
        request.userId,
        predictionId,
        {
          inferenceTime: totalLatency,
          inputSize: this.calculateInputSize(request.input),
          outputSize: this.calculateInputSize(inferenceResult.predictions)
        }
      );
      await this.eventPublisher.publish(predictionCompletedEvent);

      this.logger.info('Prediction completed successfully', {
        modelId: request.modelId,
        predictionId,
        latency: totalLatency
      });

      return {
        success: true,
        predictionId,
        predictions: inferenceResult.predictions,
        probabilities: inferenceResult.probabilities,
        featureImportance: inferenceResult.featureImportance,
        confidence: inferenceResult.confidence,
        metadata: {
          modelVersion: model.metadata.version,
          inferenceTime: totalLatency,
          preprocessingTime: inferenceResult.preprocessingTime,
          postprocessingTime: inferenceResult.postprocessingTime,
          modelLatency: inferenceResult.modelLatency
        }
      };

    } catch (error) {
      const endTime = Date.now();
      const totalLatency = endTime - startTime;

      this.logger.error('Error during prediction', error as Error, {
        modelId: request.modelId,
        tenantId: request.tenantId,
        userId: request.userId,
        predictionId
      });

      // Try to record failed prediction
      try {
        const model = await this.modelRepository.findById(request.modelId);
        if (model) {
          const updatedModel = model.recordUsage(totalLatency, false);
          await this.modelRepository.update(updatedModel);

          // Publish prediction failed event
          const predictionFailedEvent = ModelEventFactory.createModelPredictionFailedEvent(
            model,
            request.userId,
            predictionId,
            (error as Error).message,
            totalLatency
          );
          await this.eventPublisher.publish(predictionFailedEvent);
        }
      } catch (recordError) {
        this.logger.error('Error recording failed prediction', recordError as Error);
      }

      return {
        success: false,
        predictionId,
        error: 'Prediction failed'
      };
    }
  }

  async batchPredict(request: BatchPredictRequest): Promise<BatchPredictResponse> {
    const batchId = uuidv4();
    const startTime = Date.now();

    try {
      this.logger.info('Starting batch prediction', {
        modelId: request.modelId,
        tenantId: request.tenantId,
        userId: request.userId,
        batchId,
        inputCount: request.inputs.length
      });

      // Validate input
      const inputValidation = this.validateBatchPredictInput(request);
      if (!inputValidation.isValid) {
        return {
          success: false,
          batchId,
          error: inputValidation.errors.join(', ')
        };
      }

      // Get model
      const model = await this.modelRepository.findById(request.modelId);
      if (!model) {
        return {
          success: false,
          batchId,
          error: 'Model not found'
        };
      }

      // Verify tenant access
      if (model.tenantId !== request.tenantId) {
        this.logger.warn('Unauthorized batch prediction attempt', {
          modelId: request.modelId,
          modelTenantId: model.tenantId,
          requestTenantId: request.tenantId,
          userId: request.userId
        });

        return {
          success: false,
          batchId,
          error: 'Unauthorized access to model'
        };
      }

      // Check if model can serve predictions
      if (!model.canPredict()) {
        return {
          success: false,
          batchId,
          error: `Model cannot serve predictions (status: ${model.status}, deployment: ${model.deployment.status})`
        };
      }

      // Validate all inputs against model schema
      const schemaValidationResults = request.inputs.map((input, index) => ({
        index,
        validation: this.validateInputSchema(input, model.configuration.inputSchema)
      }));

      const invalidInputs = schemaValidationResults.filter(result => !result.validation.isValid);
      if (invalidInputs.length > 0) {
        return {
          success: false,
          batchId,
          error: `Input validation failed for inputs at indices: ${invalidInputs.map(i => i.index).join(', ')}`
        };
      }

      // Publish batch prediction started event
      const batchPredictionStartedEvent = ModelEventFactory.createModelBatchPredictionStartedEvent(
        model,
        request.userId,
        batchId,
        request.inputs.length,
        request.metadata || {}
      );
      await this.eventPublisher.publish(batchPredictionStartedEvent);

      // Perform batch prediction
      const batchInferenceResult = await this.inferenceService.batchPredict({
        model,
        inputs: request.inputs,
        options: request.options || {},
        batchId
      });

      const endTime = Date.now();
      const totalProcessingTime = endTime - startTime;

      if (!batchInferenceResult.success) {
        // Publish batch prediction failed event
        const batchPredictionFailedEvent = ModelEventFactory.createModelBatchPredictionFailedEvent(
          model,
          request.userId,
          batchId,
          batchInferenceResult.error || 'Unknown error',
          totalProcessingTime
        );
        await this.eventPublisher.publish(batchPredictionFailedEvent);

        return {
          success: false,
          batchId,
          error: batchInferenceResult.error
        };
      }

      // Calculate summary statistics
      const summary = {
        totalInputs: request.inputs.length,
        successfulPredictions: batchInferenceResult.results?.filter(r => !r.error).length || 0,
        failedPredictions: batchInferenceResult.results?.filter(r => r.error).length || 0,
        averageLatency: batchInferenceResult.averageLatency || 0,
        totalProcessingTime
      };

      // Record batch usage
      const avgLatencyPerPrediction = totalProcessingTime / request.inputs.length;
      const successRate = summary.successfulPredictions / summary.totalInputs;
      
      // Update model usage stats (approximate individual predictions)
      let updatedModel = model;
      for (let i = 0; i < summary.successfulPredictions; i++) {
        updatedModel = updatedModel.recordUsage(avgLatencyPerPrediction, true);
      }
      for (let i = 0; i < summary.failedPredictions; i++) {
        updatedModel = updatedModel.recordUsage(avgLatencyPerPrediction, false);
      }
      await this.modelRepository.update(updatedModel);

      // Publish batch prediction completed event
      const batchPredictionCompletedEvent = ModelEventFactory.createModelBatchPredictionCompletedEvent(
        model,
        request.userId,
        batchId,
        summary
      );
      await this.eventPublisher.publish(batchPredictionCompletedEvent);

      this.logger.info('Batch prediction completed successfully', {
        modelId: request.modelId,
        batchId,
        totalProcessingTime,
        summary
      });

      return {
        success: true,
        batchId,
        predictions: batchInferenceResult.predictions,
        results: batchInferenceResult.results,
        summary
      };

    } catch (error) {
      const endTime = Date.now();
      const totalProcessingTime = endTime - startTime;

      this.logger.error('Error during batch prediction', error as Error, {
        modelId: request.modelId,
        tenantId: request.tenantId,
        userId: request.userId,
        batchId
      });

      // Publish batch prediction failed event
      try {
        const model = await this.modelRepository.findById(request.modelId);
        if (model) {
          const batchPredictionFailedEvent = ModelEventFactory.createModelBatchPredictionFailedEvent(
            model,
            request.userId,
            batchId,
            (error as Error).message,
            totalProcessingTime
          );
          await this.eventPublisher.publish(batchPredictionFailedEvent);
        }
      } catch (eventError) {
        this.logger.error('Error publishing batch prediction failed event', eventError as Error);
      }

      return {
        success: false,
        batchId,
        error: 'Batch prediction failed'
      };
    }
  }

  private validatePredictInput(request: PredictRequest): { isValid: boolean; errors: string[] } {
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

    if (request.input === undefined || request.input === null) {
      errors.push('Input data is required');
    }

    if (request.options?.timeout && request.options.timeout <= 0) {
      errors.push('Timeout must be greater than 0');
    }

    if (request.options?.batchSize && request.options.batchSize <= 0) {
      errors.push('Batch size must be greater than 0');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private validateBatchPredictInput(request: BatchPredictRequest): { isValid: boolean; errors: string[] } {
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

    if (!request.inputs || !Array.isArray(request.inputs)) {
      errors.push('Inputs must be an array');
    } else if (request.inputs.length === 0) {
      errors.push('At least one input is required');
    } else if (request.inputs.length > 10000) {
      errors.push('Maximum 10,000 inputs allowed per batch');
    }

    if (request.options?.timeout && request.options.timeout <= 0) {
      errors.push('Timeout must be greater than 0');
    }

    if (request.options?.batchSize && request.options.batchSize <= 0) {
      errors.push('Batch size must be greater than 0');
    }

    if (request.options?.maxConcurrency && request.options.maxConcurrency <= 0) {
      errors.push('Max concurrency must be greater than 0');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private validateInputSchema(input: any, schema: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Basic type validation
    if (schema.type === 'object' && typeof input !== 'object') {
      errors.push(`Expected object input, got ${typeof input}`);
    } else if (schema.type === 'array' && !Array.isArray(input)) {
      errors.push(`Expected array input, got ${typeof input}`);
    } else if (schema.type === 'string' && typeof input !== 'string') {
      errors.push(`Expected string input, got ${typeof input}`);
    } else if (schema.type === 'number' && typeof input !== 'number') {
      errors.push(`Expected number input, got ${typeof input}`);
    }

    // Required properties validation for objects
    if (schema.type === 'object' && schema.required && Array.isArray(schema.required)) {
      for (const requiredField of schema.required) {
        if (!(requiredField in input)) {
          errors.push(`Required field missing: ${requiredField}`);
        }
      }
    }

    // Array shape validation
    if (schema.type === 'array' && schema.shape && Array.isArray(input)) {
      if (schema.shape.length > 0 && input.length !== schema.shape[0]) {
        errors.push(`Expected array length ${schema.shape[0]}, got ${input.length}`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private calculateInputSize(data: any): number {
    // Simple size calculation - in production, this could be more sophisticated
    return JSON.stringify(data).length;
  }
}
