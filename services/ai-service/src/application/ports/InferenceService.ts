/**
 * Inference Service Port
 * 
 * Defines the interface for ML model inference operations.
 * Implementations provide model serving capabilities with support
 * for various frameworks and deployment strategies.
 */

import { MLModel } from '../../domain/entities/MLModel';

export interface InferenceRequest {
  model: MLModel;
  input: any;
  options: {
    batchSize?: number;
    timeout?: number;
    returnProbabilities?: boolean;
    returnFeatureImportance?: boolean;
    preprocessingOptions?: Record<string, any>;
    postprocessingOptions?: Record<string, any>;
  };
  predictionId: string;
}

export interface InferenceResult {
  success: boolean;
  predictions?: any;
  probabilities?: number[];
  featureImportance?: Array<{
    feature: string;
    importance: number;
  }>;
  confidence?: number;
  preprocessingTime?: number;
  postprocessingTime?: number;
  modelLatency: number;
  error?: string;
}

export interface BatchInferenceRequest {
  model: MLModel;
  inputs: any[];
  options: {
    batchSize?: number;
    timeout?: number;
    returnProbabilities?: boolean;
    returnFeatureImportance?: boolean;
    parallelProcessing?: boolean;
    maxConcurrency?: number;
  };
  batchId: string;
}

export interface BatchInferenceResult {
  success: boolean;
  predictions?: any[];
  results?: Array<{
    input: any;
    prediction: any;
    probabilities?: number[];
    confidence?: number;
    error?: string;
  }>;
  averageLatency?: number;
  error?: string;
}

export interface ModelServingConfig {
  modelId: string;
  endpoint: string;
  replicas: number;
  resources: {
    cpu: string;
    memory: string;
    gpu?: string;
  };
  autoscaling?: {
    enabled: boolean;
    minReplicas: number;
    maxReplicas: number;
    targetCPU: number;
    targetMemory: number;
  };
  healthCheck?: {
    path: string;
    intervalSeconds: number;
    timeoutSeconds: number;
    failureThreshold: number;
  };
}

export interface InferenceService {
  /**
   * Perform single prediction
   */
  predict(request: InferenceRequest): Promise<InferenceResult>;

  /**
   * Perform batch predictions
   */
  batchPredict(request: BatchInferenceRequest): Promise<BatchInferenceResult>;

  /**
   * Deploy model for serving
   */
  deployModel(model: MLModel, config: ModelServingConfig): Promise<{
    success: boolean;
    endpoint?: string;
    error?: string;
  }>;

  /**
   * Update model deployment
   */
  updateDeployment(modelId: string, config: Partial<ModelServingConfig>): Promise<{
    success: boolean;
    error?: string;
  }>;

  /**
   * Stop model serving
   */
  stopModel(modelId: string): Promise<{
    success: boolean;
    error?: string;
  }>;

  /**
   * Get model serving status
   */
  getModelStatus(modelId: string): Promise<{
    status: 'pending' | 'deploying' | 'deployed' | 'failed' | 'stopped';
    endpoint?: string;
    replicas?: number;
    health?: {
      healthy: number;
      unhealthy: number;
    };
    metrics?: {
      requestsPerSecond: number;
      averageLatency: number;
      errorRate: number;
    };
  }>;

  /**
   * Get model serving metrics
   */
  getModelMetrics(modelId: string, timeRange?: {
    start: Date;
    end: Date;
  }): Promise<{
    requestCount: number;
    averageLatency: number;
    errorRate: number;
    throughput: number;
    resourceUtilization: {
      cpu: number;
      memory: number;
      gpu?: number;
    };
    latencyPercentiles: {
      p50: number;
      p95: number;
      p99: number;
    };
  }>;

  /**
   * Validate model for deployment
   */
  validateModel(model: MLModel): Promise<{
    isValid: boolean;
    issues: Array<{
      type: 'error' | 'warning';
      message: string;
      suggestion?: string;
    }>;
  }>;

  /**
   * Test model inference
   */
  testModel(model: MLModel, testInput: any): Promise<{
    success: boolean;
    output?: any;
    latency?: number;
    error?: string;
  }>;

  /**
   * Get supported frameworks
   */
  getSupportedFrameworks(): string[];

  /**
   * Get framework-specific requirements
   */
  getFrameworkRequirements(framework: string): {
    minCPU: string;
    minMemory: string;
    supportedFormats: string[];
    dependencies: string[];
  };

  /**
   * Optimize model for inference
   */
  optimizeModel(model: MLModel, optimizations: {
    quantization?: boolean;
    pruning?: boolean;
    tensorRT?: boolean;
    onnxConversion?: boolean;
  }): Promise<{
    success: boolean;
    optimizedModelPath?: string;
    performanceGain?: {
      latencyImprovement: number;
      sizeReduction: number;
      accuracyLoss?: number;
    };
    error?: string;
  }>;

  /**
   * Scale model deployment
   */
  scaleModel(modelId: string, replicas: number): Promise<{
    success: boolean;
    currentReplicas?: number;
    error?: string;
  }>;

  /**
   * Get inference logs
   */
  getInferenceLogs(modelId: string, options?: {
    level?: 'error' | 'warn' | 'info' | 'debug';
    limit?: number;
    startTime?: Date;
    endTime?: Date;
  }): Promise<Array<{
    timestamp: Date;
    level: string;
    message: string;
    predictionId?: string;
    latency?: number;
    error?: string;
  }>>;

  /**
   * Cleanup model resources
   */
  cleanup(modelId: string): Promise<{
    success: boolean;
    resourcesFreed?: {
      cpu: string;
      memory: string;
      gpu?: string;
    };
    error?: string;
  }>;
}
