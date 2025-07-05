// ML Model Domain Events for Event-Driven Architecture

export const MLModelEvents = {
  // Model Lifecycle Events
  MODEL_CREATED: 'ml.model.created',
  MODEL_UPDATED: 'ml.model.updated',
  MODEL_DELETED: 'ml.model.deleted',
  MODEL_STATUS_CHANGED: 'ml.model.status_changed',
  
  // Training Events
  TRAINING_STARTED: 'ml.training.started',
  TRAINING_PROGRESS: 'ml.training.progress',
  TRAINING_COMPLETED: 'ml.training.completed',
  TRAINING_FAILED: 'ml.training.failed',
  TRAINING_CANCELLED: 'ml.training.cancelled',
  
  // Deployment Events
  MODEL_DEPLOYED: 'ml.model.deployed',
  MODEL_DEPLOYMENT_FAILED: 'ml.model.deployment_failed',
  MODEL_UNDEPLOYED: 'ml.model.undeployed',
  MODEL_SCALED: 'ml.model.scaled',
  
  // Inference Events
  PREDICTION_REQUESTED: 'ml.prediction.requested',
  PREDICTION_COMPLETED: 'ml.prediction.completed',
  PREDICTION_FAILED: 'ml.prediction.failed',
  BATCH_PREDICTION_COMPLETED: 'ml.batch_prediction.completed',
  
  // Performance Events
  MODEL_PERFORMANCE_DEGRADED: 'ml.model.performance_degraded',
  MODEL_HEALTH_CHECK: 'ml.model.health_check',
  MODEL_METRICS_UPDATED: 'ml.model.metrics_updated',
  
  // Resource Events
  RESOURCE_LIMIT_EXCEEDED: 'ml.resource.limit_exceeded',
  AUTOSCALING_TRIGGERED: 'ml.autoscaling.triggered',
  
  // Experiment Events
  EXPERIMENT_STARTED: 'ml.experiment.started',
  EXPERIMENT_COMPLETED: 'ml.experiment.completed',
  EXPERIMENT_WINNER_SELECTED: 'ml.experiment.winner_selected',
  
  // Artifact Events
  ARTIFACT_UPLOADED: 'ml.artifact.uploaded',
  ARTIFACT_DELETED: 'ml.artifact.deleted',
  ARTIFACT_CORRUPTED: 'ml.artifact.corrupted'
} as const;

// Event payload interfaces

export interface ModelCreatedEvent {
  modelId: string;
  tenantId: string;
  name: string;
  framework: string;
  category: string;
  version: string;
  createdBy?: string;
  timestamp: Date;
}

export interface ModelUpdatedEvent {
  modelId: string;
  tenantId: string;
  version: string;
  changes: string[];
  updatedBy?: string;
  timestamp: Date;
}

export interface ModelDeletedEvent {
  modelId: string;
  tenantId: string;
  name: string;
  deletedBy?: string;
  timestamp: Date;
}

export interface ModelStatusChangedEvent {
  modelId: string;
  tenantId: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
  timestamp: Date;
}

export interface TrainingStartedEvent {
  trainingJobId: string;
  modelId: string;
  tenantId: string;
  trainingConfig: any;
  resourceConfig: any;
  estimatedDuration?: number;
  timestamp: Date;
}

export interface TrainingProgressEvent {
  trainingJobId: string;
  modelId: string;
  tenantId: string;
  progress: number; // 0.0 to 1.0
  currentEpoch: number;
  totalEpochs: number;
  currentMetrics: any;
  estimatedCompletion?: Date;
  timestamp: Date;
}

export interface TrainingCompletedEvent {
  trainingJobId: string;
  modelId: string;
  tenantId: string;
  duration: number;
  finalMetrics: any;
  artifactPath: string;
  resourceUsage: any;
  timestamp: Date;
}

export interface TrainingFailedEvent {
  trainingJobId: string;
  modelId: string;
  tenantId: string;
  error: string;
  duration: number;
  retryCount: number;
  canRetry: boolean;
  timestamp: Date;
}

export interface TrainingCancelledEvent {
  trainingJobId: string;
  modelId: string;
  tenantId: string;
  reason: string;
  cancelledBy?: string;
  timestamp: Date;
}

export interface ModelDeployedEvent {
  modelId: string;
  tenantId: string;
  deploymentId: string;
  deploymentName: string;
  environment: string;
  endpointUrl: string;
  replicas: {
    desired: number;
    ready: number;
    available: number;
  };
  resourceConfig: any;
  timestamp: Date;
}

export interface ModelDeploymentFailedEvent {
  modelId: string;
  tenantId: string;
  deploymentName: string;
  environment: string;
  error: string;
  timestamp: Date;
}

export interface ModelUndeployedEvent {
  modelId: string;
  tenantId: string;
  deploymentId: string;
  deploymentName: string;
  reason: string;
  undeployedBy?: string;
  timestamp: Date;
}

export interface ModelScaledEvent {
  modelId: string;
  tenantId: string;
  deploymentId: string;
  deploymentName: string;
  previousReplicas: number;
  newReplicas: number;
  reason: string;
  timestamp: Date;
}

export interface PredictionRequestedEvent {
  modelId: string;
  tenantId: string;
  requestId: string;
  inputSize: number;
  batchSize?: number;
  timestamp: Date;
}

export interface PredictionCompletedEvent {
  modelId: string;
  tenantId: string;
  requestId: string;
  duration: number;
  confidence?: number;
  inputSize: number;
  outputSize: number;
  timestamp: Date;
}

export interface PredictionFailedEvent {
  modelId: string;
  tenantId: string;
  requestId: string;
  error: string;
  duration: number;
  inputSize: number;
  timestamp: Date;
}

export interface BatchPredictionCompletedEvent {
  modelId: string;
  tenantId: string;
  requestId: string;
  batchSize: number;
  successfulPredictions: number;
  failedPredictions: number;
  totalDuration: number;
  averageDuration: number;
  timestamp: Date;
}

export interface ModelPerformanceDegradedEvent {
  modelId: string;
  tenantId: string;
  deploymentId?: string;
  metric: string;
  currentValue: number;
  threshold: number;
  severity: 'warning' | 'critical';
  timestamp: Date;
}

export interface ModelHealthCheckEvent {
  modelId: string;
  tenantId: string;
  deploymentId?: string;
  healthScore: number;
  checks: Array<{
    name: string;
    status: 'healthy' | 'unhealthy' | 'unknown';
    message?: string;
  }>;
  timestamp: Date;
}

export interface ModelMetricsUpdatedEvent {
  modelId: string;
  tenantId: string;
  metrics: {
    accuracy?: number;
    precision?: number;
    recall?: number;
    f1Score?: number;
    latency?: number;
    throughput?: number;
    errorRate?: number;
  };
  period: {
    start: Date;
    end: Date;
  };
  timestamp: Date;
}

export interface ResourceLimitExceededEvent {
  modelId: string;
  tenantId: string;
  deploymentId?: string;
  resource: 'cpu' | 'memory' | 'gpu' | 'storage';
  currentUsage: number;
  limit: number;
  severity: 'warning' | 'critical';
  timestamp: Date;
}

export interface AutoscalingTriggeredEvent {
  modelId: string;
  tenantId: string;
  deploymentId: string;
  trigger: 'scale_up' | 'scale_down';
  currentReplicas: number;
  targetReplicas: number;
  reason: string;
  metrics: any;
  timestamp: Date;
}

export interface ExperimentStartedEvent {
  experimentId: string;
  tenantId: string;
  experimentName: string;
  experimentType: string;
  controlModelId: string;
  treatmentModelIds: string[];
  trafficSplit: any;
  startDate: Date;
  endDate?: Date;
  timestamp: Date;
}

export interface ExperimentCompletedEvent {
  experimentId: string;
  tenantId: string;
  experimentName: string;
  duration: number;
  results: any;
  winnerModelId?: string;
  confidenceLevel?: number;
  timestamp: Date;
}

export interface ExperimentWinnerSelectedEvent {
  experimentId: string;
  tenantId: string;
  experimentName: string;
  winnerModelId: string;
  controlModelId: string;
  improvementMetrics: any;
  confidenceLevel: number;
  timestamp: Date;
}

export interface ArtifactUploadedEvent {
  artifactId: string;
  modelId: string;
  tenantId: string;
  artifactType: string;
  fileName: string;
  filePath: string;
  fileSize: number;
  fileHash: string;
  version: string;
  uploadedBy?: string;
  timestamp: Date;
}

export interface ArtifactDeletedEvent {
  artifactId: string;
  modelId: string;
  tenantId: string;
  artifactType: string;
  fileName: string;
  filePath: string;
  deletedBy?: string;
  timestamp: Date;
}

export interface ArtifactCorruptedEvent {
  artifactId: string;
  modelId: string;
  tenantId: string;
  artifactType: string;
  fileName: string;
  filePath: string;
  expectedHash: string;
  actualHash: string;
  timestamp: Date;
}

// Event type union for type safety
export type MLModelEvent = 
  | ModelCreatedEvent
  | ModelUpdatedEvent
  | ModelDeletedEvent
  | ModelStatusChangedEvent
  | TrainingStartedEvent
  | TrainingProgressEvent
  | TrainingCompletedEvent
  | TrainingFailedEvent
  | TrainingCancelledEvent
  | ModelDeployedEvent
  | ModelDeploymentFailedEvent
  | ModelUndeployedEvent
  | ModelScaledEvent
  | PredictionRequestedEvent
  | PredictionCompletedEvent
  | PredictionFailedEvent
  | BatchPredictionCompletedEvent
  | ModelPerformanceDegradedEvent
  | ModelHealthCheckEvent
  | ModelMetricsUpdatedEvent
  | ResourceLimitExceededEvent
  | AutoscalingTriggeredEvent
  | ExperimentStartedEvent
  | ExperimentCompletedEvent
  | ExperimentWinnerSelectedEvent
  | ArtifactUploadedEvent
  | ArtifactDeletedEvent
  | ArtifactCorruptedEvent;

// Event metadata interface
export interface EventMetadata {
  eventId: string;
  eventType: string;
  version: string;
  source: string;
  timestamp: Date;
  correlationId?: string;
  causationId?: string;
}

// Complete event envelope
export interface MLModelEventEnvelope {
  metadata: EventMetadata;
  payload: MLModelEvent;
}

// Event handler interface
export interface MLModelEventHandler<T extends MLModelEvent = MLModelEvent> {
  eventType: string;
  handle(event: T, metadata: EventMetadata): Promise<void>;
}

// Event publisher interface
export interface MLModelEventPublisher {
  publish(eventType: string, payload: MLModelEvent, metadata?: Partial<EventMetadata>): Promise<void>;
  publishBatch(events: Array<{ eventType: string; payload: MLModelEvent; metadata?: Partial<EventMetadata> }>): Promise<void>;
}

// Event subscriber interface
export interface MLModelEventSubscriber {
  subscribe(eventType: string, handler: MLModelEventHandler): Promise<void>;
  unsubscribe(eventType: string, handler: MLModelEventHandler): Promise<void>;
}

// Event store interface for event sourcing
export interface MLModelEventStore {
  append(streamId: string, events: MLModelEventEnvelope[]): Promise<void>;
  getEvents(streamId: string, fromVersion?: number): Promise<MLModelEventEnvelope[]>;
  getSnapshot(streamId: string): Promise<any>;
  saveSnapshot(streamId: string, snapshot: any, version: number): Promise<void>;
}

// Saga coordination events
export const MLModelSagaEvents = {
  // Model deployment saga
  DEPLOY_MODEL_SAGA_STARTED: 'ml.saga.deploy_model.started',
  DEPLOY_MODEL_SAGA_COMPLETED: 'ml.saga.deploy_model.completed',
  DEPLOY_MODEL_SAGA_FAILED: 'ml.saga.deploy_model.failed',
  DEPLOY_MODEL_SAGA_COMPENSATED: 'ml.saga.deploy_model.compensated',
  
  // Model training saga
  TRAIN_MODEL_SAGA_STARTED: 'ml.saga.train_model.started',
  TRAIN_MODEL_SAGA_COMPLETED: 'ml.saga.train_model.completed',
  TRAIN_MODEL_SAGA_FAILED: 'ml.saga.train_model.failed',
  TRAIN_MODEL_SAGA_COMPENSATED: 'ml.saga.train_model.compensated',
  
  // Experiment saga
  RUN_EXPERIMENT_SAGA_STARTED: 'ml.saga.run_experiment.started',
  RUN_EXPERIMENT_SAGA_COMPLETED: 'ml.saga.run_experiment.completed',
  RUN_EXPERIMENT_SAGA_FAILED: 'ml.saga.run_experiment.failed',
  RUN_EXPERIMENT_SAGA_COMPENSATED: 'ml.saga.run_experiment.compensated'
} as const;

// Integration events with other services
export const MLModelIntegrationEvents = {
  // User service integration
  USER_MODEL_ACCESS_GRANTED: 'ml.integration.user.access_granted',
  USER_MODEL_ACCESS_REVOKED: 'ml.integration.user.access_revoked',
  
  // Tenant service integration
  TENANT_MODEL_QUOTA_EXCEEDED: 'ml.integration.tenant.quota_exceeded',
  TENANT_MODEL_BILLING_UPDATED: 'ml.integration.tenant.billing_updated',
  
  // Plugin service integration
  PLUGIN_MODEL_INTEGRATION_CREATED: 'ml.integration.plugin.created',
  PLUGIN_MODEL_INTEGRATION_UPDATED: 'ml.integration.plugin.updated',
  
  // Notification service integration
  MODEL_ALERT_TRIGGERED: 'ml.integration.notification.alert_triggered',
  MODEL_REPORT_GENERATED: 'ml.integration.notification.report_generated'
} as const;
