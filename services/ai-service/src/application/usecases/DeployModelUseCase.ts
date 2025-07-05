import { MLModel } from '../../domain/entities/MLModel';
import { MLModelRepository } from '../../infrastructure/repositories/MLModelRepository';
import { InferenceService } from '../ports/InferenceService';
import { TensorFlowInferenceService } from '../../infrastructure/inference/TensorFlowInferenceService';
import { PyTorchInferenceService } from '../../infrastructure/inference/PyTorchInferenceService';
import { Logger } from '../../../shared/infrastructure/logging/Logger';
import { EventPublisher } from '../../../shared/infrastructure/events/EventPublisher';
import { MLModelEvents } from '../../domain/events/MLModelEvents';
import { KubernetesService } from '../../infrastructure/deployment/KubernetesService';
import { MetricsCollector } from '../../../shared/infrastructure/monitoring/MetricsCollector';

export interface DeploymentConfig {
  environment: 'development' | 'staging' | 'production';
  deploymentName: string;
  minReplicas: number;
  maxReplicas: number;
  resourceLimits: {
    cpu: string;
    memory: string;
    gpu?: string;
  };
  healthCheck: {
    path: string;
    intervalSeconds: number;
    timeoutSeconds: number;
    failureThreshold: number;
  };
  autoscaling: {
    enabled: boolean;
    targetCPUUtilization: number;
    targetMemoryUtilization: number;
    scaleUpCooldown: number;
    scaleDownCooldown: number;
  };
  monitoring: {
    enabled: boolean;
    metricsPath: string;
    alerting: boolean;
  };
}

export interface DeploymentResult {
  deploymentId: string;
  endpointUrl: string;
  status: 'pending' | 'deploying' | 'healthy' | 'unhealthy' | 'failed';
  replicas: {
    desired: number;
    ready: number;
    available: number;
  };
  healthScore: number;
  deployedAt: Date;
  estimatedReadyTime?: Date;
}

export class DeployModelUseCase {
  private readonly modelRepository: MLModelRepository;
  private readonly inferenceServices: Map<string, InferenceService>;
  private readonly kubernetesService: KubernetesService;
  private readonly logger: Logger;
  private readonly eventPublisher: EventPublisher;
  private readonly metrics: MetricsCollector;

  constructor(
    modelRepository: MLModelRepository,
    tensorflowService: TensorFlowInferenceService,
    pytorchService: PyTorchInferenceService,
    kubernetesService: KubernetesService,
    logger: Logger,
    eventPublisher: EventPublisher,
    metrics: MetricsCollector
  ) {
    this.modelRepository = modelRepository;
    this.kubernetesService = kubernetesService;
    this.logger = logger;
    this.eventPublisher = eventPublisher;
    this.metrics = metrics;

    // Initialize inference services map
    this.inferenceServices = new Map([
      ['tensorflow', tensorflowService],
      ['pytorch', pytorchService]
    ]);
  }

  async execute(
    modelId: string,
    tenantId: string,
    config: DeploymentConfig
  ): Promise<DeploymentResult> {
    const startTime = Date.now();

    try {
      this.logger.info('Starting model deployment', {
        modelId,
        tenantId,
        deploymentName: config.deploymentName,
        environment: config.environment
      });

      // Validate model exists and is ready for deployment
      const model = await this.validateModelForDeployment(modelId, tenantId);

      // Validate deployment configuration
      await this.validateDeploymentConfig(config, model);

      // Check if deployment name is unique for tenant
      await this.validateDeploymentName(config.deploymentName, tenantId);

      // Prepare deployment artifacts
      const deploymentManifest = await this.prepareDeploymentManifest(model, config);

      // Deploy to Kubernetes
      const deploymentResult = await this.deployToKubernetes(
        model,
        config,
        deploymentManifest
      );

      // Update model status
      await this.updateModelDeploymentStatus(model, 'deployed');

      // Record deployment in database
      await this.recordDeployment(model, config, deploymentResult);

      // Setup monitoring and health checks
      await this.setupMonitoring(model, config, deploymentResult);

      // Publish deployment event
      await this.publishDeploymentEvent(model, config, deploymentResult);

      // Record metrics
      this.recordDeploymentMetrics(model, config, Date.now() - startTime, true);

      this.logger.info('Model deployment completed successfully', {
        modelId,
        tenantId,
        deploymentId: deploymentResult.deploymentId,
        endpointUrl: deploymentResult.endpointUrl,
        deploymentTime: Date.now() - startTime
      });

      return deploymentResult;

    } catch (error) {
      const deploymentTime = Date.now() - startTime;

      this.logger.error('Model deployment failed', {
        modelId,
        tenantId,
        deploymentName: config.deploymentName,
        error: error.message,
        deploymentTime
      });

      // Record failure metrics
      this.recordDeploymentMetrics(model, config, deploymentTime, false);

      // Publish deployment failed event
      await this.publishDeploymentFailedEvent(modelId, tenantId, config, error);

      throw new Error(`Model deployment failed: ${error.message}`);
    }
  }

  private async validateModelForDeployment(
    modelId: string,
    tenantId: string
  ): Promise<MLModel> {
    const model = await this.modelRepository.findById(modelId, tenantId);
    
    if (!model) {
      throw new Error(`Model not found: ${modelId}`);
    }

    // Check model status
    if (!['trained', 'validated'].includes(model.status)) {
      throw new Error(`Model must be trained or validated for deployment. Current status: ${model.status}`);
    }

    // Validate model artifacts exist
    if (!model.artifactPath) {
      throw new Error('Model artifact path is required for deployment');
    }

    // Check if inference service is available for the framework
    if (!this.inferenceServices.has(model.framework)) {
      throw new Error(`Inference service not available for framework: ${model.framework}`);
    }

    // Validate model configuration
    if (!model.configuration.inputSchema || !model.configuration.outputSchema) {
      throw new Error('Model input and output schemas are required for deployment');
    }

    this.logger.debug('Model validation passed', {
      modelId: model.id,
      framework: model.framework,
      status: model.status
    });

    return model;
  }

  private async validateDeploymentConfig(
    config: DeploymentConfig,
    model: MLModel
  ): Promise<void> {
    // Validate deployment name
    if (!config.deploymentName || config.deploymentName.length < 3) {
      throw new Error('Deployment name must be at least 3 characters long');
    }

    if (!/^[a-z0-9-]+$/.test(config.deploymentName)) {
      throw new Error('Deployment name must contain only lowercase letters, numbers, and hyphens');
    }

    // Validate resource limits
    if (!config.resourceLimits.cpu || !config.resourceLimits.memory) {
      throw new Error('CPU and memory resource limits are required');
    }

    // Validate replica configuration
    if (config.minReplicas < 1 || config.maxReplicas < config.minReplicas) {
      throw new Error('Invalid replica configuration');
    }

    // Validate environment-specific constraints
    if (config.environment === 'production') {
      if (config.minReplicas < 2) {
        throw new Error('Production deployments must have at least 2 replicas');
      }
      
      if (!config.monitoring.enabled) {
        throw new Error('Monitoring is required for production deployments');
      }
    }

    // Validate framework-specific requirements
    if (model.framework === 'tensorflow' && model.configuration.requiresGPU && !config.resourceLimits.gpu) {
      this.logger.warn('TensorFlow model may require GPU but none specified', {
        modelId: model.id
      });
    }

    this.logger.debug('Deployment configuration validated', {
      deploymentName: config.deploymentName,
      environment: config.environment,
      replicas: `${config.minReplicas}-${config.maxReplicas}`
    });
  }

  private async validateDeploymentName(
    deploymentName: string,
    tenantId: string
  ): Promise<void> {
    // Check if deployment name is already in use
    const existingDeployment = await this.kubernetesService.getDeployment(
      deploymentName,
      tenantId
    );

    if (existingDeployment) {
      throw new Error(`Deployment name '${deploymentName}' is already in use`);
    }
  }

  private async prepareDeploymentManifest(
    model: MLModel,
    config: DeploymentConfig
  ): Promise<any> {
    const inferenceService = this.inferenceServices.get(model.framework)!;
    
    // Generate deployment manifest
    const manifest = {
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: {
        name: config.deploymentName,
        namespace: `tenant-${model.tenantId}`,
        labels: {
          app: config.deploymentName,
          model: model.id,
          framework: model.framework,
          category: model.category,
          environment: config.environment,
          'managed-by': 'ai-service'
        },
        annotations: {
          'ai-service/model-id': model.id,
          'ai-service/model-version': model.version,
          'ai-service/deployment-config': JSON.stringify(config)
        }
      },
      spec: {
        replicas: config.minReplicas,
        selector: {
          matchLabels: {
            app: config.deploymentName
          }
        },
        template: {
          metadata: {
            labels: {
              app: config.deploymentName,
              model: model.id,
              framework: model.framework
            }
          },
          spec: {
            containers: [
              {
                name: 'model-server',
                image: this.getInferenceImage(model.framework),
                ports: [
                  {
                    containerPort: 8080,
                    name: 'http'
                  },
                  {
                    containerPort: 9090,
                    name: 'metrics'
                  }
                ],
                env: [
                  {
                    name: 'MODEL_ID',
                    value: model.id
                  },
                  {
                    name: 'MODEL_PATH',
                    value: model.artifactPath
                  },
                  {
                    name: 'FRAMEWORK',
                    value: model.framework
                  },
                  {
                    name: 'TENANT_ID',
                    value: model.tenantId
                  },
                  {
                    name: 'MODEL_CONFIG',
                    value: JSON.stringify(model.configuration)
                  }
                ],
                resources: {
                  limits: config.resourceLimits,
                  requests: {
                    cpu: this.calculateCPURequest(config.resourceLimits.cpu),
                    memory: this.calculateMemoryRequest(config.resourceLimits.memory)
                  }
                },
                livenessProbe: {
                  httpGet: {
                    path: config.healthCheck.path,
                    port: 8080
                  },
                  initialDelaySeconds: 30,
                  periodSeconds: config.healthCheck.intervalSeconds,
                  timeoutSeconds: config.healthCheck.timeoutSeconds,
                  failureThreshold: config.healthCheck.failureThreshold
                },
                readinessProbe: {
                  httpGet: {
                    path: '/ready',
                    port: 8080
                  },
                  initialDelaySeconds: 10,
                  periodSeconds: 5,
                  timeoutSeconds: 3,
                  failureThreshold: 3
                }
              }
            ],
            imagePullSecrets: [
              {
                name: 'ai-service-registry'
              }
            ]
          }
        }
      }
    };

    // Add GPU resources if specified
    if (config.resourceLimits.gpu) {
      manifest.spec.template.spec.containers[0].resources.limits['nvidia.com/gpu'] = config.resourceLimits.gpu;
    }

    return manifest;
  }

  private async deployToKubernetes(
    model: MLModel,
    config: DeploymentConfig,
    manifest: any
  ): Promise<DeploymentResult> {
    try {
      // Create namespace if it doesn't exist
      await this.kubernetesService.ensureNamespace(`tenant-${model.tenantId}`);

      // Deploy the model
      const deployment = await this.kubernetesService.createDeployment(manifest);

      // Create service for the deployment
      const service = await this.kubernetesService.createService({
        apiVersion: 'v1',
        kind: 'Service',
        metadata: {
          name: config.deploymentName,
          namespace: `tenant-${model.tenantId}`,
          labels: {
            app: config.deploymentName
          }
        },
        spec: {
          selector: {
            app: config.deploymentName
          },
          ports: [
            {
              port: 80,
              targetPort: 8080,
              name: 'http'
            },
            {
              port: 9090,
              targetPort: 9090,
              name: 'metrics'
            }
          ],
          type: 'ClusterIP'
        }
      });

      // Setup autoscaling if enabled
      if (config.autoscaling.enabled) {
        await this.kubernetesService.createHorizontalPodAutoscaler({
          apiVersion: 'autoscaling/v2',
          kind: 'HorizontalPodAutoscaler',
          metadata: {
            name: config.deploymentName,
            namespace: `tenant-${model.tenantId}`
          },
          spec: {
            scaleTargetRef: {
              apiVersion: 'apps/v1',
              kind: 'Deployment',
              name: config.deploymentName
            },
            minReplicas: config.minReplicas,
            maxReplicas: config.maxReplicas,
            metrics: [
              {
                type: 'Resource',
                resource: {
                  name: 'cpu',
                  target: {
                    type: 'Utilization',
                    averageUtilization: config.autoscaling.targetCPUUtilization
                  }
                }
              },
              {
                type: 'Resource',
                resource: {
                  name: 'memory',
                  target: {
                    type: 'Utilization',
                    averageUtilization: config.autoscaling.targetMemoryUtilization
                  }
                }
              }
            ],
            behavior: {
              scaleUp: {
                stabilizationWindowSeconds: config.autoscaling.scaleUpCooldown
              },
              scaleDown: {
                stabilizationWindowSeconds: config.autoscaling.scaleDownCooldown
              }
            }
          }
        });
      }

      // Generate endpoint URL
      const endpointUrl = this.generateEndpointUrl(config.deploymentName, model.tenantId, config.environment);

      // Wait for deployment to be ready (with timeout)
      const readyTime = await this.waitForDeploymentReady(
        config.deploymentName,
        `tenant-${model.tenantId}`,
        300000 // 5 minutes timeout
      );

      return {
        deploymentId: deployment.metadata.uid,
        endpointUrl,
        status: 'healthy',
        replicas: {
          desired: config.minReplicas,
          ready: deployment.status?.readyReplicas || 0,
          available: deployment.status?.availableReplicas || 0
        },
        healthScore: 1.0,
        deployedAt: new Date(),
        estimatedReadyTime: readyTime
      };

    } catch (error) {
      this.logger.error('Kubernetes deployment failed', {
        modelId: model.id,
        deploymentName: config.deploymentName,
        error: error.message
      });

      // Cleanup partial deployment
      await this.cleanupFailedDeployment(config.deploymentName, model.tenantId);

      throw error;
    }
  }

  private async waitForDeploymentReady(
    deploymentName: string,
    namespace: string,
    timeoutMs: number
  ): Promise<Date> {
    const startTime = Date.now();
    const pollInterval = 5000; // 5 seconds

    while (Date.now() - startTime < timeoutMs) {
      try {
        const deployment = await this.kubernetesService.getDeployment(deploymentName, namespace);
        
        if (deployment?.status?.readyReplicas === deployment?.spec?.replicas) {
          return new Date();
        }

        await new Promise(resolve => setTimeout(resolve, pollInterval));
      } catch (error) {
        this.logger.warn('Error checking deployment status', {
          deploymentName,
          namespace,
          error: error.message
        });
      }
    }

    throw new Error(`Deployment did not become ready within ${timeoutMs}ms`);
  }

  private async updateModelDeploymentStatus(model: MLModel, status: string): Promise<void> {
    model.status = status;
    model.updatedAt = new Date();
    await this.modelRepository.save(model);
  }

  private async recordDeployment(
    model: MLModel,
    config: DeploymentConfig,
    result: DeploymentResult
  ): Promise<void> {
    // This would typically insert into ml_model_deployments table
    this.logger.info('Recording deployment in database', {
      modelId: model.id,
      deploymentId: result.deploymentId,
      endpointUrl: result.endpointUrl
    });
  }

  private async setupMonitoring(
    model: MLModel,
    config: DeploymentConfig,
    result: DeploymentResult
  ): Promise<void> {
    if (!config.monitoring.enabled) {
      return;
    }

    try {
      // Setup Prometheus monitoring
      await this.kubernetesService.createServiceMonitor({
        apiVersion: 'monitoring.coreos.com/v1',
        kind: 'ServiceMonitor',
        metadata: {
          name: config.deploymentName,
          namespace: `tenant-${model.tenantId}`,
          labels: {
            app: config.deploymentName,
            monitoring: 'enabled'
          }
        },
        spec: {
          selector: {
            matchLabels: {
              app: config.deploymentName
            }
          },
          endpoints: [
            {
              port: 'metrics',
              path: config.monitoring.metricsPath,
              interval: '30s'
            }
          ]
        }
      });

      // Setup alerting rules if enabled
      if (config.monitoring.alerting) {
        await this.setupAlertingRules(model, config);
      }

      this.logger.info('Monitoring setup completed', {
        modelId: model.id,
        deploymentName: config.deploymentName
      });

    } catch (error) {
      this.logger.warn('Failed to setup monitoring', {
        modelId: model.id,
        error: error.message
      });
      // Don't fail deployment for monitoring setup issues
    }
  }

  private async setupAlertingRules(model: MLModel, config: DeploymentConfig): Promise<void> {
    // Setup Prometheus alerting rules for the deployment
    const alertingRules = {
      apiVersion: 'monitoring.coreos.com/v1',
      kind: 'PrometheusRule',
      metadata: {
        name: `${config.deploymentName}-alerts`,
        namespace: `tenant-${model.tenantId}`,
        labels: {
          app: config.deploymentName,
          prometheus: 'kube-prometheus'
        }
      },
      spec: {
        groups: [
          {
            name: `${config.deploymentName}.rules`,
            rules: [
              {
                alert: 'ModelHighErrorRate',
                expr: `rate(model_predictions_errors_total{deployment="${config.deploymentName}"}[5m]) > 0.1`,
                for: '2m',
                labels: {
                  severity: 'warning',
                  model_id: model.id,
                  deployment: config.deploymentName
                },
                annotations: {
                  summary: 'High error rate detected for model deployment',
                  description: `Model ${model.name} has error rate > 10% for 2 minutes`
                }
              },
              {
                alert: 'ModelHighLatency',
                expr: `histogram_quantile(0.95, rate(model_prediction_duration_seconds_bucket{deployment="${config.deploymentName}"}[5m])) > 1.0`,
                for: '5m',
                labels: {
                  severity: 'warning',
                  model_id: model.id,
                  deployment: config.deploymentName
                },
                annotations: {
                  summary: 'High latency detected for model deployment',
                  description: `Model ${model.name} has 95th percentile latency > 1s for 5 minutes`
                }
              },
              {
                alert: 'ModelDeploymentDown',
                expr: `up{job="${config.deploymentName}"} == 0`,
                for: '1m',
                labels: {
                  severity: 'critical',
                  model_id: model.id,
                  deployment: config.deploymentName
                },
                annotations: {
                  summary: 'Model deployment is down',
                  description: `Model deployment ${config.deploymentName} is not responding`
                }
              }
            ]
          }
        ]
      }
    };

    await this.kubernetesService.createPrometheusRule(alertingRules);
  }

  private async publishDeploymentEvent(
    model: MLModel,
    config: DeploymentConfig,
    result: DeploymentResult
  ): Promise<void> {
    await this.eventPublisher.publish(
      MLModelEvents.MODEL_DEPLOYED,
      {
        modelId: model.id,
        tenantId: model.tenantId,
        deploymentId: result.deploymentId,
        deploymentName: config.deploymentName,
        environment: config.environment,
        endpointUrl: result.endpointUrl,
        replicas: result.replicas,
        timestamp: new Date()
      }
    );
  }

  private async publishDeploymentFailedEvent(
    modelId: string,
    tenantId: string,
    config: DeploymentConfig,
    error: Error
  ): Promise<void> {
    await this.eventPublisher.publish(
      MLModelEvents.MODEL_DEPLOYMENT_FAILED,
      {
        modelId,
        tenantId,
        deploymentName: config.deploymentName,
        environment: config.environment,
        error: error.message,
        timestamp: new Date()
      }
    );
  }

  private async cleanupFailedDeployment(deploymentName: string, tenantId: string): Promise<void> {
    try {
      const namespace = `tenant-${tenantId}`;
      
      // Delete deployment, service, and HPA if they exist
      await Promise.allSettled([
        this.kubernetesService.deleteDeployment(deploymentName, namespace),
        this.kubernetesService.deleteService(deploymentName, namespace),
        this.kubernetesService.deleteHorizontalPodAutoscaler(deploymentName, namespace),
        this.kubernetesService.deleteServiceMonitor(deploymentName, namespace),
        this.kubernetesService.deletePrometheusRule(`${deploymentName}-alerts`, namespace)
      ]);

      this.logger.info('Cleaned up failed deployment resources', {
        deploymentName,
        tenantId
      });

    } catch (error) {
      this.logger.warn('Failed to cleanup deployment resources', {
        deploymentName,
        tenantId,
        error: error.message
      });
    }
  }

  private getInferenceImage(framework: string): string {
    const images = {
      tensorflow: 'ai-service/tensorflow-serving:latest',
      pytorch: 'ai-service/pytorch-serving:latest',
      'scikit-learn': 'ai-service/sklearn-serving:latest',
      xgboost: 'ai-service/xgboost-serving:latest',
      onnx: 'ai-service/onnx-serving:latest'
    };

    return images[framework] || 'ai-service/generic-serving:latest';
  }

  private generateEndpointUrl(deploymentName: string, tenantId: string, environment: string): string {
    const baseUrl = process.env.AI_SERVICE_BASE_URL || 'https://api.ai-platform.com';
    return `${baseUrl}/v1/tenants/${tenantId}/deployments/${deploymentName}/predict`;
  }

  private calculateCPURequest(cpuLimit: string): string {
    // Request 50% of the limit
    const limitValue = parseFloat(cpuLimit.replace(/[^0-9.]/g, ''));
    return `${Math.max(0.1, limitValue * 0.5)}`;
  }

  private calculateMemoryRequest(memoryLimit: string): string {
    // Request 75% of the limit
    const limitValue = parseFloat(memoryLimit.replace(/[^0-9.]/g, ''));
    const unit = memoryLimit.replace(/[0-9.]/g, '');
    return `${Math.max(128, limitValue * 0.75)}${unit}`;
  }

  private recordDeploymentMetrics(
    model: MLModel,
    config: DeploymentConfig,
    deploymentTime: number,
    success: boolean
  ): void {
    this.metrics.recordHistogram('model_deployment_duration_ms', deploymentTime, {
      model_id: model.id,
      framework: model.framework,
      environment: config.environment,
      success: success.toString()
    });

    this.metrics.incrementCounter('model_deployments_total', {
      model_id: model.id,
      framework: model.framework,
      environment: config.environment,
      success: success.toString()
    });

    if (success) {
      this.metrics.recordGauge('model_deployment_replicas', config.minReplicas, {
        model_id: model.id,
        deployment_name: config.deploymentName
      });
    }
  }
}
