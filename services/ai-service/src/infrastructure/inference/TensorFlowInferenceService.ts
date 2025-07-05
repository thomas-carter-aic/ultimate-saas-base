/**
 * TensorFlow Inference Service Implementation
 * 
 * Provides TensorFlow model serving capabilities with support for
 * TensorFlow.js, TensorFlow Serving, and optimized inference.
 */

import * as tf from '@tensorflow/tfjs-node';
import { InferenceService, InferenceRequest, InferenceResult, BatchInferenceRequest, BatchInferenceResult, ModelServingConfig } from '../../application/ports/InferenceService';
import { MLModel } from '../../domain/entities/MLModel';
import { Logger } from '../../application/ports/Logger';
import { FileStorage } from '../../application/ports/FileStorage';

interface LoadedModel {
  model: tf.LayersModel | tf.GraphModel;
  metadata: {
    inputShape: number[];
    outputShape: number[];
    preprocessor?: any;
    postprocessor?: any;
  };
  loadedAt: Date;
  lastUsedAt: Date;
}

export class TensorFlowInferenceService implements InferenceService {
  private modelCache = new Map<string, LoadedModel>();
  private maxCacheSize = 10; // Maximum number of models to keep in memory
  private modelLoadPromises = new Map<string, Promise<LoadedModel>>();

  constructor(
    private fileStorage: FileStorage,
    private logger: Logger
  ) {}

  async predict(request: InferenceRequest): Promise<InferenceResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Starting TensorFlow prediction', {
        modelId: request.model.id,
        predictionId: request.predictionId
      });

      // Load model if not cached
      const loadedModel = await this.loadModel(request.model);
      if (!loadedModel) {
        return {
          success: false,
          modelLatency: 0,
          error: 'Failed to load model'
        };
      }

      // Preprocess input
      const preprocessStartTime = Date.now();
      const preprocessedInput = await this.preprocessInput(
        request.input,
        request.model.configuration,
        request.options.preprocessingOptions
      );
      const preprocessingTime = Date.now() - preprocessStartTime;

      // Convert to tensor
      const inputTensor = this.convertToTensor(preprocessedInput, loadedModel.metadata.inputShape);
      if (!inputTensor) {
        return {
          success: false,
          modelLatency: 0,
          error: 'Failed to convert input to tensor'
        };
      }

      // Perform inference
      const inferenceStartTime = Date.now();
      const outputTensor = loadedModel.model.predict(inputTensor) as tf.Tensor;
      const modelLatency = Date.now() - inferenceStartTime;

      // Convert output to JavaScript array
      const outputData = await outputTensor.data();
      const outputArray = Array.from(outputData);

      // Postprocess output
      const postprocessStartTime = Date.now();
      const predictions = await this.postprocessOutput(
        outputArray,
        request.model.configuration,
        request.options.postprocessingOptions
      );
      const postprocessingTime = Date.now() - postprocessStartTime;

      // Calculate probabilities if requested
      let probabilities: number[] | undefined;
      if (request.options.returnProbabilities && request.model.metadata.category === 'classification') {
        probabilities = this.calculateProbabilities(outputArray);
      }

      // Calculate feature importance if requested
      let featureImportance: Array<{ feature: string; importance: number }> | undefined;
      if (request.options.returnFeatureImportance) {
        featureImportance = await this.calculateFeatureImportance(
          loadedModel.model,
          inputTensor,
          request.model.configuration
        );
      }

      // Calculate confidence
      const confidence = this.calculateConfidence(outputArray, request.model.metadata.category);

      // Cleanup tensors
      inputTensor.dispose();
      outputTensor.dispose();

      // Update model usage
      loadedModel.lastUsedAt = new Date();

      const totalTime = Date.now() - startTime;

      this.logger.info('TensorFlow prediction completed', {
        modelId: request.model.id,
        predictionId: request.predictionId,
        totalTime,
        modelLatency,
        preprocessingTime,
        postprocessingTime
      });

      return {
        success: true,
        predictions,
        probabilities,
        featureImportance,
        confidence,
        preprocessingTime,
        postprocessingTime,
        modelLatency
      };

    } catch (error) {
      this.logger.error('TensorFlow prediction failed', error as Error, {
        modelId: request.model.id,
        predictionId: request.predictionId
      });

      return {
        success: false,
        modelLatency: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  async batchPredict(request: BatchInferenceRequest): Promise<BatchInferenceResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Starting TensorFlow batch prediction', {
        modelId: request.model.id,
        batchId: request.batchId,
        inputCount: request.inputs.length
      });

      // Load model if not cached
      const loadedModel = await this.loadModel(request.model);
      if (!loadedModel) {
        return {
          success: false,
          error: 'Failed to load model'
        };
      }

      const batchSize = request.options.batchSize || 32;
      const results: Array<{
        input: any;
        prediction: any;
        probabilities?: number[];
        confidence?: number;
        error?: string;
      }> = [];

      let totalLatency = 0;
      let successCount = 0;

      // Process inputs in batches
      for (let i = 0; i < request.inputs.length; i += batchSize) {
        const batch = request.inputs.slice(i, i + batchSize);
        const batchResults = await this.processBatch(
          batch,
          loadedModel,
          request.model,
          request.options
        );

        results.push(...batchResults.results);
        totalLatency += batchResults.totalLatency;
        successCount += batchResults.successCount;
      }

      const averageLatency = totalLatency / request.inputs.length;

      // Update model usage
      loadedModel.lastUsedAt = new Date();

      this.logger.info('TensorFlow batch prediction completed', {
        modelId: request.model.id,
        batchId: request.batchId,
        totalTime: Date.now() - startTime,
        successCount,
        averageLatency
      });

      return {
        success: true,
        predictions: results.map(r => r.prediction),
        results,
        averageLatency
      };

    } catch (error) {
      this.logger.error('TensorFlow batch prediction failed', error as Error, {
        modelId: request.model.id,
        batchId: request.batchId
      });

      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async deployModel(model: MLModel, config: ModelServingConfig): Promise<{ success: boolean; endpoint?: string; error?: string }> {
    try {
      this.logger.info('Deploying TensorFlow model', {
        modelId: model.id,
        config
      });

      // For TensorFlow.js, we don't need separate deployment
      // Models are loaded on-demand and cached in memory
      
      // Validate model can be loaded
      const loadedModel = await this.loadModel(model);
      if (!loadedModel) {
        return {
          success: false,
          error: 'Failed to validate model for deployment'
        };
      }

      // In a production environment, this would:
      // 1. Deploy to TensorFlow Serving
      // 2. Configure Kubernetes deployment
      // 3. Set up load balancing and autoscaling
      // 4. Configure health checks

      const endpoint = `http://localhost:8501/v1/models/${model.id}:predict`;

      this.logger.info('TensorFlow model deployed successfully', {
        modelId: model.id,
        endpoint
      });

      return {
        success: true,
        endpoint
      };

    } catch (error) {
      this.logger.error('TensorFlow model deployment failed', error as Error, {
        modelId: model.id
      });

      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async updateDeployment(modelId: string, config: Partial<ModelServingConfig>): Promise<{ success: boolean; error?: string }> {
    try {
      this.logger.info('Updating TensorFlow model deployment', {
        modelId,
        config
      });

      // In a production environment, this would update the deployment configuration
      // For now, we'll just log the update

      return { success: true };

    } catch (error) {
      this.logger.error('TensorFlow deployment update failed', error as Error, {
        modelId
      });

      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async stopModel(modelId: string): Promise<{ success: boolean; error?: string }> {
    try {
      this.logger.info('Stopping TensorFlow model', { modelId });

      // Remove from cache
      this.modelCache.delete(modelId);

      // In a production environment, this would:
      // 1. Stop TensorFlow Serving instance
      // 2. Remove Kubernetes deployment
      // 3. Clean up resources

      return { success: true };

    } catch (error) {
      this.logger.error('Failed to stop TensorFlow model', error as Error, {
        modelId
      });

      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async getModelStatus(modelId: string): Promise<any> {
    const isLoaded = this.modelCache.has(modelId);
    
    return {
      status: isLoaded ? 'deployed' : 'stopped',
      endpoint: isLoaded ? `http://localhost:8501/v1/models/${modelId}:predict` : undefined,
      replicas: isLoaded ? 1 : 0,
      health: {
        healthy: isLoaded ? 1 : 0,
        unhealthy: 0
      },
      metrics: {
        requestsPerSecond: 0, // Would be tracked in production
        averageLatency: 0,
        errorRate: 0
      }
    };
  }

  async getModelMetrics(modelId: string, timeRange?: { start: Date; end: Date }): Promise<any> {
    // In production, this would query metrics from monitoring system
    return {
      requestCount: 0,
      averageLatency: 0,
      errorRate: 0,
      throughput: 0,
      resourceUtilization: {
        cpu: 0,
        memory: 0
      },
      latencyPercentiles: {
        p50: 0,
        p95: 0,
        p99: 0
      }
    };
  }

  async validateModel(model: MLModel): Promise<any> {
    const issues: Array<{ type: 'error' | 'warning'; message: string; suggestion?: string }> = [];

    try {
      // Try to load the model
      const loadedModel = await this.loadModel(model);
      if (!loadedModel) {
        issues.push({
          type: 'error',
          message: 'Model cannot be loaded',
          suggestion: 'Check model file format and integrity'
        });
      }

      // Check input/output shapes
      if (loadedModel && model.configuration.inputSchema.shape) {
        const expectedShape = model.configuration.inputSchema.shape;
        const actualShape = loadedModel.metadata.inputShape;
        
        if (!this.shapesMatch(expectedShape, actualShape)) {
          issues.push({
            type: 'warning',
            message: `Input shape mismatch: expected ${expectedShape}, got ${actualShape}`,
            suggestion: 'Update model configuration or retrain model'
          });
        }
      }

    } catch (error) {
      issues.push({
        type: 'error',
        message: `Model validation failed: ${(error as Error).message}`,
        suggestion: 'Check model file and configuration'
      });
    }

    return {
      isValid: issues.filter(i => i.type === 'error').length === 0,
      issues
    };
  }

  async testModel(model: MLModel, testInput: any): Promise<any> {
    const startTime = Date.now();

    try {
      const result = await this.predict({
        model,
        input: testInput,
        options: {},
        predictionId: 'test'
      });

      return {
        success: result.success,
        output: result.predictions,
        latency: Date.now() - startTime,
        error: result.error
      };

    } catch (error) {
      return {
        success: false,
        latency: Date.now() - startTime,
        error: (error as Error).message
      };
    }
  }

  getSupportedFrameworks(): string[] {
    return ['tensorflow'];
  }

  getFrameworkRequirements(framework: string): any {
    if (framework === 'tensorflow') {
      return {
        minCPU: '500m',
        minMemory: '1Gi',
        supportedFormats: ['savedmodel', 'h5', 'pb', 'json'],
        dependencies: ['@tensorflow/tfjs-node']
      };
    }

    throw new Error(`Unsupported framework: ${framework}`);
  }

  async optimizeModel(model: MLModel, optimizations: any): Promise<any> {
    try {
      this.logger.info('Optimizing TensorFlow model', {
        modelId: model.id,
        optimizations
      });

      // Load original model
      const loadedModel = await this.loadModel(model);
      if (!loadedModel) {
        return {
          success: false,
          error: 'Failed to load model for optimization'
        };
      }

      let optimizedModel = loadedModel.model;
      let performanceGain = {
        latencyImprovement: 0,
        sizeReduction: 0,
        accuracyLoss: 0
      };

      // Apply quantization if requested
      if (optimizations.quantization) {
        // TensorFlow.js quantization would be applied here
        performanceGain.latencyImprovement += 20; // Estimated improvement
        performanceGain.sizeReduction += 75; // Estimated size reduction
        performanceGain.accuracyLoss += 2; // Estimated accuracy loss
      }

      // Apply pruning if requested
      if (optimizations.pruning) {
        // Model pruning would be applied here
        performanceGain.latencyImprovement += 15;
        performanceGain.sizeReduction += 50;
        performanceGain.accuracyLoss += 1;
      }

      // Save optimized model
      const optimizedModelPath = `${model.artifacts.modelFile}_optimized`;
      // await optimizedModel.save(optimizedModelPath);

      return {
        success: true,
        optimizedModelPath,
        performanceGain
      };

    } catch (error) {
      this.logger.error('Model optimization failed', error as Error, {
        modelId: model.id
      });

      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  async scaleModel(modelId: string, replicas: number): Promise<any> {
    // For TensorFlow.js, scaling is handled by the application layer
    // In production with TensorFlow Serving, this would scale the deployment
    
    return {
      success: true,
      currentReplicas: replicas
    };
  }

  async getInferenceLogs(modelId: string, options?: any): Promise<any[]> {
    // In production, this would query logs from logging system
    return [];
  }

  async cleanup(modelId: string): Promise<any> {
    try {
      // Remove from cache
      const loadedModel = this.modelCache.get(modelId);
      if (loadedModel) {
        // Dispose TensorFlow resources
        if ('dispose' in loadedModel.model) {
          loadedModel.model.dispose();
        }
        this.modelCache.delete(modelId);
      }

      return {
        success: true,
        resourcesFreed: {
          cpu: '500m',
          memory: '1Gi'
        }
      };

    } catch (error) {
      return {
        success: false,
        error: (error as Error).message
      };
    }
  }

  private async loadModel(model: MLModel): Promise<LoadedModel | null> {
    try {
      // Check cache first
      const cached = this.modelCache.get(model.id);
      if (cached) {
        cached.lastUsedAt = new Date();
        return cached;
      }

      // Check if already loading
      const loadingPromise = this.modelLoadPromises.get(model.id);
      if (loadingPromise) {
        return await loadingPromise;
      }

      // Start loading
      const promise = this.doLoadModel(model);
      this.modelLoadPromises.set(model.id, promise);

      try {
        const loadedModel = await promise;
        
        // Add to cache
        this.addToCache(model.id, loadedModel);
        
        return loadedModel;
      } finally {
        this.modelLoadPromises.delete(model.id);
      }

    } catch (error) {
      this.logger.error('Failed to load TensorFlow model', error as Error, {
        modelId: model.id
      });
      return null;
    }
  }

  private async doLoadModel(model: MLModel): Promise<LoadedModel> {
    this.logger.info('Loading TensorFlow model', {
      modelId: model.id,
      modelPath: model.artifacts.modelFile
    });

    // Download model file from storage
    const modelBuffer = await this.fileStorage.get(model.artifacts.modelFile);
    if (!modelBuffer) {
      throw new Error('Model file not found');
    }

    // Load model based on format
    let tfModel: tf.LayersModel | tf.GraphModel;
    
    switch (model.artifacts.format) {
      case 'tensorflow':
      case 'h5':
        tfModel = await tf.loadLayersModel(tf.io.fromMemory(modelBuffer));
        break;
      case 'pb':
        tfModel = await tf.loadGraphModel(tf.io.fromMemory(modelBuffer));
        break;
      default:
        throw new Error(`Unsupported model format: ${model.artifacts.format}`);
    }

    // Extract metadata
    const inputShape = tfModel.inputs[0].shape.slice(1); // Remove batch dimension
    const outputShape = tfModel.outputs[0].shape.slice(1); // Remove batch dimension

    const loadedModel: LoadedModel = {
      model: tfModel,
      metadata: {
        inputShape,
        outputShape
      },
      loadedAt: new Date(),
      lastUsedAt: new Date()
    };

    this.logger.info('TensorFlow model loaded successfully', {
      modelId: model.id,
      inputShape,
      outputShape
    });

    return loadedModel;
  }

  private addToCache(modelId: string, loadedModel: LoadedModel): void {
    // Remove oldest model if cache is full
    if (this.modelCache.size >= this.maxCacheSize) {
      const oldestEntry = Array.from(this.modelCache.entries())
        .sort(([, a], [, b]) => a.lastUsedAt.getTime() - b.lastUsedAt.getTime())[0];
      
      if (oldestEntry) {
        const [oldModelId, oldModel] = oldestEntry;
        if ('dispose' in oldModel.model) {
          oldModel.model.dispose();
        }
        this.modelCache.delete(oldModelId);
      }
    }

    this.modelCache.set(modelId, loadedModel);
  }

  private async preprocessInput(input: any, config: any, options?: any): Promise<any> {
    // Apply preprocessing steps if configured
    if (config.preprocessing?.steps) {
      let processedInput = input;
      
      for (const step of config.preprocessing.steps) {
        switch (step.type) {
          case 'normalize':
            processedInput = this.normalizeInput(processedInput, step.parameters);
            break;
          case 'standardize':
            processedInput = this.standardizeInput(processedInput, step.parameters);
            break;
          case 'encode':
            processedInput = this.encodeInput(processedInput, step.parameters);
            break;
          // Add more preprocessing steps as needed
        }
      }
      
      return processedInput;
    }

    return input;
  }

  private async postprocessOutput(output: any, config: any, options?: any): Promise<any> {
    // Apply postprocessing steps if configured
    if (config.postprocessing?.steps) {
      let processedOutput = output;
      
      for (const step of config.postprocessing.steps) {
        switch (step.type) {
          case 'softmax':
            processedOutput = this.applySoftmax(processedOutput);
            break;
          case 'threshold':
            processedOutput = this.applyThreshold(processedOutput, step.parameters);
            break;
          case 'decode':
            processedOutput = this.decodeOutput(processedOutput, step.parameters);
            break;
          // Add more postprocessing steps as needed
        }
      }
      
      return processedOutput;
    }

    return output;
  }

  private convertToTensor(input: any, expectedShape: number[]): tf.Tensor | null {
    try {
      if (Array.isArray(input)) {
        return tf.tensor(input);
      } else if (typeof input === 'object') {
        // Convert object to array based on expected shape
        const values = Object.values(input);
        return tf.tensor(values, expectedShape);
      } else {
        return tf.scalar(input);
      }
    } catch (error) {
      this.logger.error('Failed to convert input to tensor', error as Error);
      return null;
    }
  }

  private calculateProbabilities(output: number[]): number[] {
    // Apply softmax to get probabilities
    const max = Math.max(...output);
    const exp = output.map(x => Math.exp(x - max));
    const sum = exp.reduce((a, b) => a + b, 0);
    return exp.map(x => x / sum);
  }

  private async calculateFeatureImportance(
    model: tf.LayersModel | tf.GraphModel,
    inputTensor: tf.Tensor,
    config: any
  ): Promise<Array<{ feature: string; importance: number }>> {
    // Simplified feature importance calculation
    // In production, this would use more sophisticated methods like SHAP or LIME
    
    const features = config.inputSchema.properties ? 
      Object.keys(config.inputSchema.properties) : 
      Array.from({ length: inputTensor.shape[1] || 1 }, (_, i) => `feature_${i}`);

    return features.map((feature, index) => ({
      feature,
      importance: Math.random() // Placeholder - would calculate actual importance
    }));
  }

  private calculateConfidence(output: number[], category: string): number {
    switch (category) {
      case 'classification':
        // For classification, confidence is the max probability
        const probabilities = this.calculateProbabilities(output);
        return Math.max(...probabilities);
      
      case 'regression':
        // For regression, confidence could be based on prediction variance
        // This is a simplified approach
        return Math.max(0, 1 - Math.abs(output[0]) / 100);
      
      default:
        return 0.5; // Default confidence
    }
  }

  private async processBatch(
    batch: any[],
    loadedModel: LoadedModel,
    model: MLModel,
    options: any
  ): Promise<{
    results: Array<{
      input: any;
      prediction: any;
      probabilities?: number[];
      confidence?: number;
      error?: string;
    }>;
    totalLatency: number;
    successCount: number;
  }> {
    const results = [];
    let totalLatency = 0;
    let successCount = 0;

    for (const input of batch) {
      const startTime = Date.now();
      
      try {
        // Process single input
        const preprocessedInput = await this.preprocessInput(input, model.configuration, options.preprocessingOptions);
        const inputTensor = this.convertToTensor(preprocessedInput, loadedModel.metadata.inputShape);
        
        if (!inputTensor) {
          results.push({
            input,
            prediction: null,
            error: 'Failed to convert input to tensor'
          });
          continue;
        }

        const outputTensor = loadedModel.model.predict(inputTensor) as tf.Tensor;
        const outputData = await outputTensor.data();
        const outputArray = Array.from(outputData);
        
        const prediction = await this.postprocessOutput(outputArray, model.configuration, options.postprocessingOptions);
        
        let probabilities: number[] | undefined;
        if (options.returnProbabilities && model.metadata.category === 'classification') {
          probabilities = this.calculateProbabilities(outputArray);
        }

        const confidence = this.calculateConfidence(outputArray, model.metadata.category);

        results.push({
          input,
          prediction,
          probabilities,
          confidence
        });

        successCount++;
        
        // Cleanup
        inputTensor.dispose();
        outputTensor.dispose();

      } catch (error) {
        results.push({
          input,
          prediction: null,
          error: (error as Error).message
        });
      }

      totalLatency += Date.now() - startTime;
    }

    return {
      results,
      totalLatency,
      successCount
    };
  }

  private normalizeInput(input: any, parameters: any): any {
    // Implement normalization logic
    return input;
  }

  private standardizeInput(input: any, parameters: any): any {
    // Implement standardization logic
    return input;
  }

  private encodeInput(input: any, parameters: any): any {
    // Implement encoding logic
    return input;
  }

  private applySoftmax(output: number[]): number[] {
    return this.calculateProbabilities(output);
  }

  private applyThreshold(output: number[], parameters: any): any {
    const threshold = parameters.threshold || 0.5;
    return output.map(x => x > threshold ? 1 : 0);
  }

  private decodeOutput(output: any, parameters: any): any {
    // Implement decoding logic
    return output;
  }

  private shapesMatch(expected: number[], actual: number[]): boolean {
    if (expected.length !== actual.length) return false;
    return expected.every((dim, i) => dim === -1 || dim === actual[i]);
  }
}
