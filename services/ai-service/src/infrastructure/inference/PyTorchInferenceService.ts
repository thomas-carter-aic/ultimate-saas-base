import { InferenceService } from '../../application/ports/InferenceService';
import { MLModel } from '../../domain/entities/MLModel';
import { PredictionResult, BatchPredictionResult } from '../../domain/value-objects/PredictionResult';
import { Logger } from '../../../shared/infrastructure/logging/Logger';
import { MetricsCollector } from '../../../shared/infrastructure/monitoring/MetricsCollector';
import { CacheManager } from '../../../shared/infrastructure/cache/CacheManager';
import * as torch from 'torch-js'; // PyTorch.js binding
import * as fs from 'fs/promises';
import * as path from 'path';

interface PyTorchModelCache {
  model: any;
  metadata: MLModel;
  lastAccessed: Date;
  memoryUsage: number;
}

interface PyTorchConfig {
  maxCacheSize: number;
  maxMemoryUsage: number;
  deviceType: 'cpu' | 'cuda' | 'mps';
  numThreads: number;
  enableOptimization: boolean;
  quantization: boolean;
}

export class PyTorchInferenceService implements InferenceService {
  private modelCache = new Map<string, PyTorchModelCache>();
  private readonly config: PyTorchConfig;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;
  private readonly cache: CacheManager;

  constructor(
    config: Partial<PyTorchConfig> = {},
    logger: Logger,
    metrics: MetricsCollector,
    cache: CacheManager
  ) {
    this.config = {
      maxCacheSize: config.maxCacheSize || 10,
      maxMemoryUsage: config.maxMemoryUsage || 4 * 1024 * 1024 * 1024, // 4GB
      deviceType: config.deviceType || 'cpu',
      numThreads: config.numThreads || 4,
      enableOptimization: config.enableOptimization || true,
      quantization: config.quantization || false,
      ...config
    };
    
    this.logger = logger;
    this.metrics = metrics;
    this.cache = cache;

    // Configure PyTorch settings
    this.configurePyTorch();
  }

  private configurePyTorch(): void {
    try {
      // Set number of threads for CPU operations
      torch.setNumThreads(this.config.numThreads);
      
      // Configure device
      if (this.config.deviceType === 'cuda' && torch.cuda.isAvailable()) {
        torch.cuda.setDevice(0);
        this.logger.info('PyTorch configured for CUDA acceleration');
      } else if (this.config.deviceType === 'mps' && torch.backends.mps.isAvailable()) {
        this.logger.info('PyTorch configured for MPS acceleration');
      } else {
        this.logger.info('PyTorch configured for CPU inference');
      }

      this.logger.info('PyTorch inference service initialized', {
        config: this.config,
        cudaAvailable: torch.cuda.isAvailable(),
        mpsAvailable: torch.backends.mps.isAvailable()
      });
    } catch (error) {
      this.logger.error('Failed to configure PyTorch', { error });
      throw new Error(`PyTorch configuration failed: ${error.message}`);
    }
  }

  async predict(model: MLModel, input: any): Promise<PredictionResult> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting PyTorch prediction', {
        modelId: model.id,
        modelName: model.name,
        framework: model.framework
      });

      // Validate framework compatibility
      if (model.framework !== 'pytorch') {
        throw new Error(`Model framework ${model.framework} not supported by PyTorchInferenceService`);
      }

      // Load or get cached model
      const torchModel = await this.loadModel(model);

      // Validate and preprocess input
      const processedInput = await this.preprocessInput(input, model);

      // Convert input to PyTorch tensor
      const inputTensor = this.convertToTensor(processedInput, model);

      // Perform inference
      const outputTensor = await this.runInference(torchModel, inputTensor, model);

      // Convert output tensor to JavaScript values
      const rawOutput = this.convertFromTensor(outputTensor, model);

      // Postprocess output
      const processedOutput = await this.postprocessOutput(rawOutput, model);

      // Calculate confidence score
      const confidence = this.calculateConfidence(outputTensor, model);

      // Calculate feature importance (if supported)
      const featureImportance = await this.calculateFeatureImportance(
        torchModel, inputTensor, model
      );

      const result: PredictionResult = {
        prediction: processedOutput,
        confidence,
        featureImportance,
        metadata: {
          modelId: model.id,
          modelVersion: model.version,
          framework: 'pytorch',
          inferenceTime: Date.now() - startTime,
          deviceType: this.config.deviceType,
          inputShape: this.getTensorShape(inputTensor),
          outputShape: this.getTensorShape(outputTensor)
        }
      };

      // Record metrics
      this.recordPredictionMetrics(model, Date.now() - startTime, true);

      // Update model usage statistics
      await this.updateModelUsage(model, true);

      this.logger.debug('PyTorch prediction completed', {
        modelId: model.id,
        inferenceTime: Date.now() - startTime,
        confidence
      });

      return result;

    } catch (error) {
      const inferenceTime = Date.now() - startTime;
      
      this.logger.error('PyTorch prediction failed', {
        modelId: model.id,
        error: error.message,
        inferenceTime
      });

      // Record error metrics
      this.recordPredictionMetrics(model, inferenceTime, false);
      await this.updateModelUsage(model, false);

      throw new Error(`PyTorch prediction failed: ${error.message}`);
    }
  }

  async batchPredict(model: MLModel, inputs: any[]): Promise<BatchPredictionResult> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Starting PyTorch batch prediction', {
        modelId: model.id,
        batchSize: inputs.length
      });

      if (inputs.length === 0) {
        throw new Error('Batch inputs cannot be empty');
      }

      // Load or get cached model
      const torchModel = await this.loadModel(model);

      // Process inputs in parallel batches
      const batchSize = Math.min(inputs.length, 32); // Configurable batch size
      const results: PredictionResult[] = [];
      const errors: Array<{ index: number; error: string }> = [];

      for (let i = 0; i < inputs.length; i += batchSize) {
        const batch = inputs.slice(i, i + batchSize);
        
        try {
          // Preprocess batch inputs
          const processedBatch = await Promise.all(
            batch.map(input => this.preprocessInput(input, model))
          );

          // Convert to batch tensor
          const batchTensor = this.convertBatchToTensor(processedBatch, model);

          // Perform batch inference
          const outputTensor = await this.runInference(torchModel, batchTensor, model);

          // Convert and postprocess outputs
          const rawOutputs = this.convertBatchFromTensor(outputTensor, model);
          const processedOutputs = await Promise.all(
            rawOutputs.map(output => this.postprocessOutput(output, model))
          );

          // Calculate confidence scores
          const confidences = this.calculateBatchConfidence(outputTensor, model);

          // Create batch results
          for (let j = 0; j < processedOutputs.length; j++) {
            results.push({
              prediction: processedOutputs[j],
              confidence: confidences[j],
              featureImportance: undefined, // Skip for batch processing
              metadata: {
                modelId: model.id,
                modelVersion: model.version,
                framework: 'pytorch',
                inferenceTime: Date.now() - startTime,
                deviceType: this.config.deviceType,
                batchIndex: i + j
              }
            });
          }

        } catch (error) {
          // Record individual errors
          for (let j = 0; j < batch.length; j++) {
            errors.push({
              index: i + j,
              error: error.message
            });
          }
        }
      }

      const totalTime = Date.now() - startTime;
      const successCount = results.length;
      const errorCount = errors.length;

      // Record batch metrics
      this.recordBatchPredictionMetrics(model, inputs.length, successCount, totalTime);

      // Update model usage
      await this.updateModelUsage(model, successCount > 0, successCount, errorCount);

      const batchResult: BatchPredictionResult = {
        results,
        errors,
        metadata: {
          totalInputs: inputs.length,
          successfulPredictions: successCount,
          failedPredictions: errorCount,
          totalInferenceTime: totalTime,
          averageInferenceTime: totalTime / inputs.length,
          framework: 'pytorch',
          deviceType: this.config.deviceType
        }
      };

      this.logger.debug('PyTorch batch prediction completed', {
        modelId: model.id,
        totalInputs: inputs.length,
        successCount,
        errorCount,
        totalTime
      });

      return batchResult;

    } catch (error) {
      this.logger.error('PyTorch batch prediction failed', {
        modelId: model.id,
        batchSize: inputs.length,
        error: error.message
      });

      throw new Error(`PyTorch batch prediction failed: ${error.message}`);
    }
  }

  private async loadModel(model: MLModel): Promise<any> {
    const cacheKey = `${model.id}_${model.version}`;
    
    // Check if model is already cached
    if (this.modelCache.has(cacheKey)) {
      const cached = this.modelCache.get(cacheKey)!;
      cached.lastAccessed = new Date();
      
      this.logger.debug('Using cached PyTorch model', {
        modelId: model.id,
        cacheKey
      });
      
      return cached.model;
    }

    try {
      this.logger.debug('Loading PyTorch model', {
        modelId: model.id,
        artifactPath: model.artifactPath
      });

      // Ensure cache size limit
      await this.evictLeastRecentlyUsed();

      // Load model from artifact path
      let torchModel: any;
      
      if (model.artifactPath.endsWith('.pt') || model.artifactPath.endsWith('.pth')) {
        // Load PyTorch model file
        torchModel = await torch.jit.load(model.artifactPath);
      } else if (model.artifactPath.endsWith('.torchscript')) {
        // Load TorchScript model
        torchModel = await torch.jit.load(model.artifactPath);
      } else {
        throw new Error(`Unsupported PyTorch model format: ${model.artifactPath}`);
      }

      // Set model to evaluation mode
      torchModel.eval();

      // Apply optimizations if enabled
      if (this.config.enableOptimization) {
        torchModel = await this.optimizeModel(torchModel, model);
      }

      // Move model to appropriate device
      if (this.config.deviceType === 'cuda' && torch.cuda.isAvailable()) {
        torchModel = torchModel.cuda();
      } else if (this.config.deviceType === 'mps' && torch.backends.mps.isAvailable()) {
        torchModel = torchModel.to('mps');
      }

      // Calculate memory usage
      const memoryUsage = this.calculateModelMemoryUsage(torchModel);

      // Cache the model
      this.modelCache.set(cacheKey, {
        model: torchModel,
        metadata: model,
        lastAccessed: new Date(),
        memoryUsage
      });

      this.logger.info('PyTorch model loaded and cached', {
        modelId: model.id,
        cacheKey,
        memoryUsage,
        deviceType: this.config.deviceType
      });

      return torchModel;

    } catch (error) {
      this.logger.error('Failed to load PyTorch model', {
        modelId: model.id,
        artifactPath: model.artifactPath,
        error: error.message
      });

      throw new Error(`Failed to load PyTorch model: ${error.message}`);
    }
  }

  private async preprocessInput(input: any, model: MLModel): Promise<any> {
    try {
      let processed = input;

      // Apply preprocessing pipeline if configured
      if (model.configuration.preprocessing) {
        for (const step of model.configuration.preprocessing) {
          switch (step.type) {
            case 'normalize':
              processed = this.normalizeInput(processed, step.params);
              break;
            case 'standardize':
              processed = this.standardizeInput(processed, step.params);
              break;
            case 'resize':
              processed = await this.resizeInput(processed, step.params);
              break;
            case 'tokenize':
              processed = this.tokenizeInput(processed, step.params);
              break;
            default:
              this.logger.warn('Unknown preprocessing step', { type: step.type });
          }
        }
      }

      return processed;

    } catch (error) {
      throw new Error(`Input preprocessing failed: ${error.message}`);
    }
  }

  private async postprocessOutput(output: any, model: MLModel): Promise<any> {
    try {
      let processed = output;

      // Apply postprocessing pipeline if configured
      if (model.configuration.postprocessing) {
        for (const step of model.configuration.postprocessing) {
          switch (step.type) {
            case 'softmax':
              processed = this.applySoftmax(processed);
              break;
            case 'argmax':
              processed = this.applyArgmax(processed);
              break;
            case 'threshold':
              processed = this.applyThreshold(processed, step.params.threshold);
              break;
            case 'decode':
              processed = this.decodeOutput(processed, step.params);
              break;
            default:
              this.logger.warn('Unknown postprocessing step', { type: step.type });
          }
        }
      }

      return processed;

    } catch (error) {
      throw new Error(`Output postprocessing failed: ${error.message}`);
    }
  }

  private convertToTensor(input: any, model: MLModel): any {
    try {
      // Convert input based on model input schema
      const inputSchema = model.configuration.inputSchema;
      
      if (Array.isArray(input)) {
        return torch.tensor(input);
      } else if (typeof input === 'object' && input.data) {
        return torch.tensor(input.data);
      } else {
        return torch.tensor([input]);
      }

    } catch (error) {
      throw new Error(`Failed to convert input to tensor: ${error.message}`);
    }
  }

  private convertBatchToTensor(inputs: any[], model: MLModel): any {
    try {
      // Stack individual tensors into batch tensor
      const tensors = inputs.map(input => this.convertToTensor(input, model));
      return torch.stack(tensors);

    } catch (error) {
      throw new Error(`Failed to convert batch to tensor: ${error.message}`);
    }
  }

  private convertFromTensor(tensor: any, model: MLModel): any {
    try {
      // Convert tensor back to JavaScript values
      return tensor.tolist();

    } catch (error) {
      throw new Error(`Failed to convert tensor to values: ${error.message}`);
    }
  }

  private convertBatchFromTensor(tensor: any, model: MLModel): any[] {
    try {
      // Convert batch tensor to array of values
      const batchData = tensor.tolist();
      return Array.isArray(batchData[0]) ? batchData : [batchData];

    } catch (error) {
      throw new Error(`Failed to convert batch tensor: ${error.message}`);
    }
  }

  private async runInference(model: any, inputTensor: any, modelMetadata: MLModel): Promise<any> {
    try {
      // Disable gradient computation for inference
      return torch.noGrad(() => {
        return model(inputTensor);
      });

    } catch (error) {
      throw new Error(`PyTorch inference failed: ${error.message}`);
    }
  }

  private calculateConfidence(outputTensor: any, model: MLModel): number {
    try {
      // Calculate confidence based on model type
      switch (model.category) {
        case 'classification':
          // Use max probability for classification
          const probabilities = torch.softmax(outputTensor, -1);
          return Math.max(...probabilities.tolist());
          
        case 'regression':
          // Use inverse of prediction variance for regression
          const variance = torch.var(outputTensor).item();
          return Math.max(0, 1 - variance);
          
        default:
          // Default confidence calculation
          const normalized = torch.sigmoid(outputTensor);
          return Math.max(...normalized.tolist());
      }

    } catch (error) {
      this.logger.warn('Failed to calculate confidence', { error: error.message });
      return 0.5; // Default confidence
    }
  }

  private calculateBatchConfidence(outputTensor: any, model: MLModel): number[] {
    try {
      const batchSize = outputTensor.shape[0];
      const confidences: number[] = [];

      for (let i = 0; i < batchSize; i++) {
        const singleOutput = outputTensor[i];
        confidences.push(this.calculateConfidence(singleOutput, model));
      }

      return confidences;

    } catch (error) {
      this.logger.warn('Failed to calculate batch confidence', { error: error.message });
      return new Array(outputTensor.shape[0]).fill(0.5);
    }
  }

  private async calculateFeatureImportance(
    model: any, 
    inputTensor: any, 
    modelMetadata: MLModel
  ): Promise<Record<string, number> | undefined> {
    try {
      // Implement gradient-based feature importance (similar to SHAP)
      inputTensor.requiresGrad_(true);
      
      const output = model(inputTensor);
      const gradients = torch.autograd.grad(output.sum(), inputTensor)[0];
      
      // Calculate importance scores
      const importance = torch.abs(gradients * inputTensor).mean(0);
      const importanceArray = importance.tolist();
      
      // Map to feature names if available
      const featureNames = modelMetadata.configuration.inputSchema?.features || 
                          importanceArray.map((_, i) => `feature_${i}`);
      
      const featureImportance: Record<string, number> = {};
      featureNames.forEach((name, i) => {
        featureImportance[name] = importanceArray[i] || 0;
      });

      return featureImportance;

    } catch (error) {
      this.logger.debug('Feature importance calculation failed', { error: error.message });
      return undefined;
    }
  }

  private async optimizeModel(model: any, modelMetadata: MLModel): Promise<any> {
    try {
      let optimizedModel = model;

      // Apply quantization if enabled
      if (this.config.quantization) {
        optimizedModel = torch.quantization.quantize_dynamic(
          optimizedModel,
          { torch.nn.Linear },
          dtype: torch.qint8
        );
      }

      // Apply TorchScript optimization
      optimizedModel = torch.jit.optimize_for_inference(optimizedModel);

      this.logger.debug('Model optimization completed', {
        modelId: modelMetadata.id,
        quantization: this.config.quantization
      });

      return optimizedModel;

    } catch (error) {
      this.logger.warn('Model optimization failed, using original model', {
        error: error.message
      });
      return model;
    }
  }

  private async evictLeastRecentlyUsed(): Promise<void> {
    if (this.modelCache.size < this.config.maxCacheSize) {
      return;
    }

    // Find least recently used model
    let oldestKey = '';
    let oldestTime = new Date();

    for (const [key, cached] of this.modelCache.entries()) {
      if (cached.lastAccessed < oldestTime) {
        oldestTime = cached.lastAccessed;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.modelCache.delete(oldestKey);
      this.logger.debug('Evicted LRU model from cache', { cacheKey: oldestKey });
    }
  }

  private calculateModelMemoryUsage(model: any): number {
    try {
      // Estimate memory usage based on model parameters
      let totalParams = 0;
      for (const param of model.parameters()) {
        totalParams += param.numel();
      }
      
      // Assume 4 bytes per parameter (float32)
      return totalParams * 4;

    } catch (error) {
      this.logger.warn('Failed to calculate model memory usage', { error: error.message });
      return 0;
    }
  }

  private getTensorShape(tensor: any): number[] {
    try {
      return tensor.shape || tensor.size();
    } catch (error) {
      return [];
    }
  }

  // Preprocessing helper methods
  private normalizeInput(input: any, params: any): any {
    const min = params.min || 0;
    const max = params.max || 1;
    return input.map((val: number) => (val - min) / (max - min));
  }

  private standardizeInput(input: any, params: any): any {
    const mean = params.mean || 0;
    const std = params.std || 1;
    return input.map((val: number) => (val - mean) / std);
  }

  private async resizeInput(input: any, params: any): Promise<any> {
    // Implement image resizing logic
    return input; // Placeholder
  }

  private tokenizeInput(input: any, params: any): any {
    // Implement text tokenization logic
    return input; // Placeholder
  }

  // Postprocessing helper methods
  private applySoftmax(output: any): any {
    const exp = output.map((val: number) => Math.exp(val));
    const sum = exp.reduce((a: number, b: number) => a + b, 0);
    return exp.map((val: number) => val / sum);
  }

  private applyArgmax(output: any): number {
    return output.indexOf(Math.max(...output));
  }

  private applyThreshold(output: any, threshold: number): any {
    return output.map((val: number) => val > threshold ? 1 : 0);
  }

  private decodeOutput(output: any, params: any): any {
    // Implement output decoding logic
    return output; // Placeholder
  }

  private recordPredictionMetrics(model: MLModel, inferenceTime: number, success: boolean): void {
    this.metrics.recordHistogram('pytorch_inference_duration_ms', inferenceTime, {
      model_id: model.id,
      model_name: model.name,
      framework: 'pytorch',
      success: success.toString()
    });

    this.metrics.incrementCounter('pytorch_predictions_total', {
      model_id: model.id,
      framework: 'pytorch',
      success: success.toString()
    });
  }

  private recordBatchPredictionMetrics(
    model: MLModel, 
    batchSize: number, 
    successCount: number, 
    totalTime: number
  ): void {
    this.metrics.recordHistogram('pytorch_batch_inference_duration_ms', totalTime, {
      model_id: model.id,
      framework: 'pytorch',
      batch_size: batchSize.toString()
    });

    this.metrics.recordGauge('pytorch_batch_success_rate', successCount / batchSize, {
      model_id: model.id,
      framework: 'pytorch'
    });
  }

  private async updateModelUsage(
    model: MLModel, 
    success: boolean, 
    successCount: number = 1, 
    errorCount: number = 0
  ): Promise<void> {
    try {
      // Update model usage statistics
      // This would typically update the database
      this.logger.debug('Updated model usage statistics', {
        modelId: model.id,
        success,
        successCount,
        errorCount
      });
    } catch (error) {
      this.logger.warn('Failed to update model usage', { error: error.message });
    }
  }

  async cleanup(): Promise<void> {
    try {
      // Clear model cache
      this.modelCache.clear();
      
      // Cleanup PyTorch resources
      if (torch.cuda.isAvailable()) {
        torch.cuda.emptyCache();
      }

      this.logger.info('PyTorch inference service cleanup completed');
    } catch (error) {
      this.logger.error('PyTorch cleanup failed', { error: error.message });
    }
  }
}
