/**
 * ML Model Domain Entity
 * 
 * Represents a machine learning model in the system with its metadata,
 * versioning, deployment status, and performance metrics.
 * Implements business rules for model lifecycle management and validation.
 */

import { v4 as uuidv4 } from 'uuid';
import * as semver from 'semver';

export interface ModelMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  tags: string[];
  category: 'classification' | 'regression' | 'clustering' | 'nlp' | 'computer-vision' | 'recommendation' | 'anomaly-detection' | 'time-series';
  framework: 'tensorflow' | 'pytorch' | 'scikit-learn' | 'xgboost' | 'onnx' | 'custom';
  modelType: 'supervised' | 'unsupervised' | 'reinforcement' | 'deep-learning' | 'ensemble';
}

export interface ModelConfiguration {
  inputSchema: {
    type: 'object' | 'array' | 'string' | 'number';
    properties?: Record<string, any>;
    shape?: number[];
    dtype?: string;
    required?: string[];
  };
  outputSchema: {
    type: 'object' | 'array' | 'string' | 'number';
    properties?: Record<string, any>;
    shape?: number[];
    dtype?: string;
    classes?: string[];
  };
  preprocessing?: {
    steps: Array<{
      type: 'normalize' | 'standardize' | 'encode' | 'transform' | 'custom';
      parameters: Record<string, any>;
    }>;
  };
  postprocessing?: {
    steps: Array<{
      type: 'decode' | 'threshold' | 'softmax' | 'custom';
      parameters: Record<string, any>;
    }>;
  };
  hyperparameters: Record<string, any>;
  trainingConfig?: {
    epochs?: number;
    batchSize?: number;
    learningRate?: number;
    optimizer?: string;
    lossFunction?: string;
    metrics?: string[];
  };
}

export interface ModelPerformance {
  accuracy?: number;
  precision?: number;
  recall?: number;
  f1Score?: number;
  auc?: number;
  mse?: number;
  mae?: number;
  r2Score?: number;
  customMetrics?: Record<string, number>;
  validationResults?: {
    testAccuracy?: number;
    crossValidationScore?: number;
    confusionMatrix?: number[][];
  };
  benchmarks?: {
    inferenceTime: number; // milliseconds
    throughput: number; // predictions per second
    memoryUsage: number; // MB
    cpuUsage: number; // percentage
  };
}

export interface ModelDeployment {
  status: 'pending' | 'deploying' | 'deployed' | 'failed' | 'stopped';
  endpoint?: string;
  replicas: number;
  resources: {
    cpu: string; // e.g., "500m"
    memory: string; // e.g., "1Gi"
    gpu?: string; // e.g., "1"
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

export interface ModelArtifacts {
  modelFile: string; // S3 path to model file
  weightsFile?: string; // S3 path to weights file
  configFile?: string; // S3 path to config file
  preprocessorFile?: string; // S3 path to preprocessor
  metadataFile?: string; // S3 path to metadata
  checksum: string; // SHA-256 checksum
  size: number; // bytes
  format: 'tensorflow' | 'pytorch' | 'onnx' | 'pickle' | 'joblib' | 'h5' | 'pb';
}

export type ModelStatus = 
  | 'draft'        // Model created but not trained
  | 'training'     // Model is being trained
  | 'trained'      // Model training completed
  | 'validating'   // Model is being validated
  | 'validated'    // Model passed validation
  | 'deploying'    // Model is being deployed
  | 'deployed'     // Model is deployed and serving
  | 'deprecated'   // Model is deprecated
  | 'archived'     // Model is archived
  | 'failed';      // Model training/deployment failed

export interface ModelUsageStats {
  totalPredictions: number;
  predictionsToday: number;
  predictionsThisMonth: number;
  averageLatency: number;
  errorRate: number;
  lastUsedAt?: Date;
  popularFeatures: Array<{
    feature: string;
    usage: number;
  }>;
}

export class MLModel {
  public readonly id: string;
  public readonly metadata: ModelMetadata;
  public readonly configuration: ModelConfiguration;
  public readonly performance: ModelPerformance;
  public readonly deployment: ModelDeployment;
  public readonly artifacts: ModelArtifacts;
  public readonly status: ModelStatus;
  public readonly tenantId: string;
  public readonly createdBy: string;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;
  public readonly trainedAt?: Date;
  public readonly deployedAt?: Date;
  public readonly usageStats: ModelUsageStats;

  constructor(
    id: string,
    metadata: ModelMetadata,
    configuration: ModelConfiguration,
    performance: ModelPerformance,
    deployment: ModelDeployment,
    artifacts: ModelArtifacts,
    status: ModelStatus,
    tenantId: string,
    createdBy: string,
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    trainedAt?: Date,
    deployedAt?: Date,
    usageStats: ModelUsageStats = {
      totalPredictions: 0,
      predictionsToday: 0,
      predictionsThisMonth: 0,
      averageLatency: 0,
      errorRate: 0,
      popularFeatures: []
    }
  ) {
    this.id = id;
    this.metadata = metadata;
    this.configuration = configuration;
    this.performance = performance;
    this.deployment = deployment;
    this.artifacts = artifacts;
    this.status = status;
    this.tenantId = tenantId;
    this.createdBy = createdBy;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.trainedAt = trainedAt;
    this.deployedAt = deployedAt;
    this.usageStats = usageStats;
  }

  /**
   * Create a new ML model instance
   */
  static create(
    metadata: ModelMetadata,
    configuration: ModelConfiguration,
    tenantId: string,
    createdBy: string
  ): MLModel {
    const id = uuidv4();
    
    const defaultPerformance: ModelPerformance = {};
    const defaultDeployment: ModelDeployment = {
      status: 'pending',
      replicas: 1,
      resources: {
        cpu: '500m',
        memory: '1Gi'
      }
    };
    const defaultArtifacts: ModelArtifacts = {
      modelFile: '',
      checksum: '',
      size: 0,
      format: 'tensorflow'
    };

    return new MLModel(
      id,
      metadata,
      configuration,
      defaultPerformance,
      defaultDeployment,
      defaultArtifacts,
      'draft',
      tenantId,
      createdBy
    );
  }

  /**
   * Validate model metadata and configuration
   */
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate metadata
    if (!this.metadata.name || this.metadata.name.length < 3) {
      errors.push('Model name must be at least 3 characters long');
    }

    if (!semver.valid(this.metadata.version)) {
      errors.push('Model version must be a valid semantic version');
    }

    if (!this.metadata.description || this.metadata.description.length < 10) {
      errors.push('Model description must be at least 10 characters long');
    }

    if (!this.metadata.author) {
      errors.push('Model author is required');
    }

    // Validate configuration
    if (!this.configuration.inputSchema) {
      errors.push('Input schema is required');
    }

    if (!this.configuration.outputSchema) {
      errors.push('Output schema is required');
    }

    // Validate framework compatibility
    const supportedFrameworks = ['tensorflow', 'pytorch', 'scikit-learn', 'xgboost', 'onnx', 'custom'];
    if (!supportedFrameworks.includes(this.metadata.framework)) {
      errors.push('Unsupported framework');
    }

    // Validate deployment resources
    if (this.deployment.resources.cpu && !this.isValidCPUResource(this.deployment.resources.cpu)) {
      errors.push('Invalid CPU resource specification');
    }

    if (this.deployment.resources.memory && !this.isValidMemoryResource(this.deployment.resources.memory)) {
      errors.push('Invalid memory resource specification');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if model is compatible with platform version
   */
  isCompatible(platformVersion: string): boolean {
    // For now, assume all models are compatible
    // In the future, this could check framework versions, etc.
    return true;
  }

  /**
   * Update model status
   */
  updateStatus(newStatus: ModelStatus, timestamp?: Date): MLModel {
    const now = timestamp || new Date();
    
    return new MLModel(
      this.id,
      this.metadata,
      this.configuration,
      this.performance,
      this.deployment,
      this.artifacts,
      newStatus,
      this.tenantId,
      this.createdBy,
      this.createdAt,
      now,
      newStatus === 'trained' ? now : this.trainedAt,
      newStatus === 'deployed' ? now : this.deployedAt,
      this.usageStats
    );
  }

  /**
   * Update model performance metrics
   */
  updatePerformance(newPerformance: Partial<ModelPerformance>): MLModel {
    return new MLModel(
      this.id,
      this.metadata,
      this.configuration,
      { ...this.performance, ...newPerformance },
      this.deployment,
      this.artifacts,
      this.status,
      this.tenantId,
      this.createdBy,
      this.createdAt,
      new Date(),
      this.trainedAt,
      this.deployedAt,
      this.usageStats
    );
  }

  /**
   * Update deployment configuration
   */
  updateDeployment(newDeployment: Partial<ModelDeployment>): MLModel {
    return new MLModel(
      this.id,
      this.metadata,
      this.configuration,
      this.performance,
      { ...this.deployment, ...newDeployment },
      this.artifacts,
      this.status,
      this.tenantId,
      this.createdBy,
      this.createdAt,
      new Date(),
      this.trainedAt,
      this.deployedAt,
      this.usageStats
    );
  }

  /**
   * Update model artifacts
   */
  updateArtifacts(newArtifacts: Partial<ModelArtifacts>): MLModel {
    return new MLModel(
      this.id,
      this.metadata,
      this.configuration,
      this.performance,
      this.deployment,
      { ...this.artifacts, ...newArtifacts },
      this.status,
      this.tenantId,
      this.createdBy,
      this.createdAt,
      new Date(),
      this.trainedAt,
      this.deployedAt,
      this.usageStats
    );
  }

  /**
   * Record model usage
   */
  recordUsage(latency: number, success: boolean): MLModel {
    const newUsageStats = {
      ...this.usageStats,
      totalPredictions: this.usageStats.totalPredictions + 1,
      predictionsToday: this.usageStats.predictionsToday + 1,
      predictionsThisMonth: this.usageStats.predictionsThisMonth + 1,
      averageLatency: ((this.usageStats.averageLatency * this.usageStats.totalPredictions) + latency) / (this.usageStats.totalPredictions + 1),
      errorRate: success ? this.usageStats.errorRate : ((this.usageStats.errorRate * this.usageStats.totalPredictions) + 1) / (this.usageStats.totalPredictions + 1),
      lastUsedAt: new Date()
    };

    return new MLModel(
      this.id,
      this.metadata,
      this.configuration,
      this.performance,
      this.deployment,
      this.artifacts,
      this.status,
      this.tenantId,
      this.createdBy,
      this.createdAt,
      new Date(),
      this.trainedAt,
      this.deployedAt,
      newUsageStats
    );
  }

  /**
   * Get model health score
   */
  getHealthScore(): number {
    let score = 100;

    // Deduct points for high error rate
    if (this.usageStats.errorRate > 0.1) {
      score -= 30;
    } else if (this.usageStats.errorRate > 0.05) {
      score -= 15;
    }

    // Deduct points for high latency
    if (this.usageStats.averageLatency > 5000) {
      score -= 20;
    } else if (this.usageStats.averageLatency > 1000) {
      score -= 10;
    }

    // Deduct points for inactivity
    if (!this.usageStats.lastUsedAt || 
        (Date.now() - this.usageStats.lastUsedAt.getTime()) > 30 * 24 * 60 * 60 * 1000) {
      score -= 25;
    }

    // Deduct points for deployment issues
    if (this.deployment.status === 'failed') {
      score -= 40;
    } else if (this.deployment.status === 'stopped') {
      score -= 20;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Check if model can be deployed
   */
  canDeploy(): boolean {
    return this.status === 'validated' || this.status === 'trained';
  }

  /**
   * Check if model can serve predictions
   */
  canPredict(): boolean {
    return this.status === 'deployed' && this.deployment.status === 'deployed';
  }

  /**
   * Get model summary for API responses
   */
  toSummary() {
    return {
      id: this.id,
      name: this.metadata.name,
      version: this.metadata.version,
      description: this.metadata.description,
      category: this.metadata.category,
      framework: this.metadata.framework,
      status: this.status,
      deploymentStatus: this.deployment.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      healthScore: this.getHealthScore(),
      usageStats: {
        totalPredictions: this.usageStats.totalPredictions,
        averageLatency: this.usageStats.averageLatency,
        errorRate: this.usageStats.errorRate,
        lastUsedAt: this.usageStats.lastUsedAt
      }
    };
  }

  /**
   * Get full model details
   */
  toDetail() {
    return {
      id: this.id,
      metadata: this.metadata,
      configuration: this.configuration,
      performance: this.performance,
      deployment: this.deployment,
      artifacts: this.artifacts,
      status: this.status,
      tenantId: this.tenantId,
      createdBy: this.createdBy,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      trainedAt: this.trainedAt,
      deployedAt: this.deployedAt,
      usageStats: this.usageStats,
      healthScore: this.getHealthScore()
    };
  }

  private isValidCPUResource(cpu: string): boolean {
    // Validate CPU resource format (e.g., "500m", "1", "2.5")
    return /^(\d+(\.\d+)?|\d+m)$/.test(cpu);
  }

  private isValidMemoryResource(memory: string): boolean {
    // Validate memory resource format (e.g., "1Gi", "512Mi", "1G", "512M")
    return /^(\d+(\.\d+)?)(Mi|Gi|M|G)$/.test(memory);
  }
}
