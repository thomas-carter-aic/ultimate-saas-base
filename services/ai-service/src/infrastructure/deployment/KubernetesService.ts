import * as k8s from '@kubernetes/client-node';
import { Logger } from '../../../shared/infrastructure/logging/Logger';
import { MetricsCollector } from '../../../shared/infrastructure/monitoring/MetricsCollector';

export interface KubernetesConfig {
  kubeconfig?: string;
  namespace?: string;
  timeout: number;
  retryAttempts: number;
  retryDelay: number;
}

export interface DeploymentStatus {
  name: string;
  namespace: string;
  replicas: {
    desired: number;
    ready: number;
    available: number;
    unavailable: number;
  };
  status: 'pending' | 'progressing' | 'available' | 'failed';
  conditions: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
    lastTransitionTime: Date;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export class KubernetesService {
  private readonly kc: k8s.KubeConfig;
  private readonly k8sApi: k8s.AppsV1Api;
  private readonly coreApi: k8s.CoreV1Api;
  private readonly autoscalingApi: k8s.AutoscalingV2Api;
  private readonly customObjectsApi: k8s.CustomObjectsApi;
  private readonly config: KubernetesConfig;
  private readonly logger: Logger;
  private readonly metrics: MetricsCollector;

  constructor(
    config: Partial<KubernetesConfig> = {},
    logger: Logger,
    metrics: MetricsCollector
  ) {
    this.config = {
      timeout: config.timeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
      ...config
    };
    
    this.logger = logger;
    this.metrics = metrics;

    // Initialize Kubernetes client
    this.kc = new k8s.KubeConfig();
    
    if (config.kubeconfig) {
      this.kc.loadFromFile(config.kubeconfig);
    } else {
      // Load from cluster (when running inside Kubernetes)
      try {
        this.kc.loadFromCluster();
      } catch (error) {
        // Fallback to default config
        this.kc.loadFromDefault();
      }
    }

    // Initialize API clients
    this.k8sApi = this.kc.makeApiClient(k8s.AppsV1Api);
    this.coreApi = this.kc.makeApiClient(k8s.CoreV1Api);
    this.autoscalingApi = this.kc.makeApiClient(k8s.AutoscalingV2Api);
    this.customObjectsApi = this.kc.makeApiClient(k8s.CustomObjectsApi);

    this.logger.info('Kubernetes service initialized', {
      currentContext: this.kc.getCurrentContext(),
      timeout: this.config.timeout
    });
  }

  async ensureNamespace(namespace: string): Promise<void> {
    try {
      // Check if namespace exists
      await this.coreApi.readNamespace(namespace);
      this.logger.debug('Namespace already exists', { namespace });
      
    } catch (error) {
      if (error.response?.statusCode === 404) {
        // Create namespace
        const namespaceManifest: k8s.V1Namespace = {
          apiVersion: 'v1',
          kind: 'Namespace',
          metadata: {
            name: namespace,
            labels: {
              'managed-by': 'ai-service',
              'tenant': namespace.replace('tenant-', '')
            }
          }
        };

        await this.coreApi.createNamespace(namespaceManifest);
        this.logger.info('Namespace created', { namespace });
        
        // Record metrics
        this.metrics.incrementCounter('kubernetes_namespaces_created_total', {
          namespace
        });
      } else {
        throw error;
      }
    }
  }

  async createDeployment(manifest: k8s.V1Deployment): Promise<k8s.V1Deployment> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Creating Kubernetes deployment', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace
      });

      const response = await this.executeWithRetry(async () => {
        return await this.k8sApi.createNamespacedDeployment(
          manifest.metadata!.namespace!,
          manifest
        );
      });

      const deployment = response.body;
      
      this.logger.info('Deployment created successfully', {
        name: deployment.metadata?.name,
        namespace: deployment.metadata?.namespace,
        uid: deployment.metadata?.uid
      });

      // Record metrics
      this.recordOperationMetrics('create_deployment', Date.now() - startTime, true);

      return deployment;

    } catch (error) {
      this.logger.error('Failed to create deployment', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace,
        error: error.message
      });

      this.recordOperationMetrics('create_deployment', Date.now() - startTime, false);
      throw new Error(`Failed to create deployment: ${error.message}`);
    }
  }

  async updateDeployment(manifest: k8s.V1Deployment): Promise<k8s.V1Deployment> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Updating Kubernetes deployment', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace
      });

      const response = await this.executeWithRetry(async () => {
        return await this.k8sApi.patchNamespacedDeployment(
          manifest.metadata!.name!,
          manifest.metadata!.namespace!,
          manifest,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-Type': 'application/merge-patch+json' } }
        );
      });

      const deployment = response.body;
      
      this.logger.info('Deployment updated successfully', {
        name: deployment.metadata?.name,
        namespace: deployment.metadata?.namespace
      });

      this.recordOperationMetrics('update_deployment', Date.now() - startTime, true);
      return deployment;

    } catch (error) {
      this.logger.error('Failed to update deployment', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace,
        error: error.message
      });

      this.recordOperationMetrics('update_deployment', Date.now() - startTime, false);
      throw new Error(`Failed to update deployment: ${error.message}`);
    }
  }

  async getDeployment(name: string, namespace: string): Promise<k8s.V1Deployment | null> {
    try {
      const response = await this.k8sApi.readNamespacedDeployment(name, namespace);
      return response.body;
      
    } catch (error) {
      if (error.response?.statusCode === 404) {
        return null;
      }
      
      this.logger.error('Failed to get deployment', {
        name,
        namespace,
        error: error.message
      });
      
      throw new Error(`Failed to get deployment: ${error.message}`);
    }
  }

  async getDeploymentStatus(name: string, namespace: string): Promise<DeploymentStatus | null> {
    try {
      const deployment = await this.getDeployment(name, namespace);
      
      if (!deployment) {
        return null;
      }

      const status = deployment.status;
      const spec = deployment.spec;

      return {
        name: deployment.metadata!.name!,
        namespace: deployment.metadata!.namespace!,
        replicas: {
          desired: spec?.replicas || 0,
          ready: status?.readyReplicas || 0,
          available: status?.availableReplicas || 0,
          unavailable: status?.unavailableReplicas || 0
        },
        status: this.determineDeploymentStatus(status),
        conditions: (status?.conditions || []).map(condition => ({
          type: condition.type,
          status: condition.status,
          reason: condition.reason,
          message: condition.message,
          lastTransitionTime: new Date(condition.lastTransitionTime!)
        })),
        createdAt: new Date(deployment.metadata!.creationTimestamp!),
        updatedAt: new Date(status?.observedGeneration ? 
          deployment.metadata!.creationTimestamp! : 
          deployment.metadata!.creationTimestamp!)
      };

    } catch (error) {
      this.logger.error('Failed to get deployment status', {
        name,
        namespace,
        error: error.message
      });
      
      throw new Error(`Failed to get deployment status: ${error.message}`);
    }
  }

  async deleteDeployment(name: string, namespace: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      await this.executeWithRetry(async () => {
        return await this.k8sApi.deleteNamespacedDeployment(name, namespace);
      });

      this.logger.info('Deployment deleted successfully', { name, namespace });
      this.recordOperationMetrics('delete_deployment', Date.now() - startTime, true);
      
      return true;

    } catch (error) {
      if (error.response?.statusCode === 404) {
        this.logger.debug('Deployment not found for deletion', { name, namespace });
        return false;
      }

      this.logger.error('Failed to delete deployment', {
        name,
        namespace,
        error: error.message
      });

      this.recordOperationMetrics('delete_deployment', Date.now() - startTime, false);
      throw new Error(`Failed to delete deployment: ${error.message}`);
    }
  }

  async scaleDeployment(name: string, namespace: string, replicas: number): Promise<k8s.V1Deployment> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Scaling deployment', { name, namespace, replicas });

      const scaleManifest = {
        spec: {
          replicas
        }
      };

      const response = await this.executeWithRetry(async () => {
        return await this.k8sApi.patchNamespacedDeploymentScale(
          name,
          namespace,
          scaleManifest,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          { headers: { 'Content-Type': 'application/merge-patch+json' } }
        );
      });

      this.logger.info('Deployment scaled successfully', {
        name,
        namespace,
        replicas
      });

      this.recordOperationMetrics('scale_deployment', Date.now() - startTime, true);
      return response.body;

    } catch (error) {
      this.logger.error('Failed to scale deployment', {
        name,
        namespace,
        replicas,
        error: error.message
      });

      this.recordOperationMetrics('scale_deployment', Date.now() - startTime, false);
      throw new Error(`Failed to scale deployment: ${error.message}`);
    }
  }

  async createService(manifest: k8s.V1Service): Promise<k8s.V1Service> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Creating Kubernetes service', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace
      });

      const response = await this.executeWithRetry(async () => {
        return await this.coreApi.createNamespacedService(
          manifest.metadata!.namespace!,
          manifest
        );
      });

      const service = response.body;
      
      this.logger.info('Service created successfully', {
        name: service.metadata?.name,
        namespace: service.metadata?.namespace,
        type: service.spec?.type
      });

      this.recordOperationMetrics('create_service', Date.now() - startTime, true);
      return service;

    } catch (error) {
      this.logger.error('Failed to create service', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace,
        error: error.message
      });

      this.recordOperationMetrics('create_service', Date.now() - startTime, false);
      throw new Error(`Failed to create service: ${error.message}`);
    }
  }

  async deleteService(name: string, namespace: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      await this.executeWithRetry(async () => {
        return await this.coreApi.deleteNamespacedService(name, namespace);
      });

      this.logger.info('Service deleted successfully', { name, namespace });
      this.recordOperationMetrics('delete_service', Date.now() - startTime, true);
      
      return true;

    } catch (error) {
      if (error.response?.statusCode === 404) {
        this.logger.debug('Service not found for deletion', { name, namespace });
        return false;
      }

      this.logger.error('Failed to delete service', {
        name,
        namespace,
        error: error.message
      });

      this.recordOperationMetrics('delete_service', Date.now() - startTime, false);
      throw new Error(`Failed to delete service: ${error.message}`);
    }
  }

  async createHorizontalPodAutoscaler(manifest: k8s.V2HorizontalPodAutoscaler): Promise<k8s.V2HorizontalPodAutoscaler> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Creating HorizontalPodAutoscaler', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace
      });

      const response = await this.executeWithRetry(async () => {
        return await this.autoscalingApi.createNamespacedHorizontalPodAutoscaler(
          manifest.metadata!.namespace!,
          manifest
        );
      });

      const hpa = response.body;
      
      this.logger.info('HorizontalPodAutoscaler created successfully', {
        name: hpa.metadata?.name,
        namespace: hpa.metadata?.namespace,
        minReplicas: hpa.spec?.minReplicas,
        maxReplicas: hpa.spec?.maxReplicas
      });

      this.recordOperationMetrics('create_hpa', Date.now() - startTime, true);
      return hpa;

    } catch (error) {
      this.logger.error('Failed to create HorizontalPodAutoscaler', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace,
        error: error.message
      });

      this.recordOperationMetrics('create_hpa', Date.now() - startTime, false);
      throw new Error(`Failed to create HorizontalPodAutoscaler: ${error.message}`);
    }
  }

  async deleteHorizontalPodAutoscaler(name: string, namespace: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      await this.executeWithRetry(async () => {
        return await this.autoscalingApi.deleteNamespacedHorizontalPodAutoscaler(name, namespace);
      });

      this.logger.info('HorizontalPodAutoscaler deleted successfully', { name, namespace });
      this.recordOperationMetrics('delete_hpa', Date.now() - startTime, true);
      
      return true;

    } catch (error) {
      if (error.response?.statusCode === 404) {
        this.logger.debug('HorizontalPodAutoscaler not found for deletion', { name, namespace });
        return false;
      }

      this.logger.error('Failed to delete HorizontalPodAutoscaler', {
        name,
        namespace,
        error: error.message
      });

      this.recordOperationMetrics('delete_hpa', Date.now() - startTime, false);
      throw new Error(`Failed to delete HorizontalPodAutoscaler: ${error.message}`);
    }
  }

  async createServiceMonitor(manifest: any): Promise<any> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Creating ServiceMonitor', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace
      });

      const response = await this.executeWithRetry(async () => {
        return await this.customObjectsApi.createNamespacedCustomObject(
          'monitoring.coreos.com',
          'v1',
          manifest.metadata!.namespace!,
          'servicemonitors',
          manifest
        );
      });

      this.logger.info('ServiceMonitor created successfully', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace
      });

      this.recordOperationMetrics('create_servicemonitor', Date.now() - startTime, true);
      return response.body;

    } catch (error) {
      this.logger.error('Failed to create ServiceMonitor', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace,
        error: error.message
      });

      this.recordOperationMetrics('create_servicemonitor', Date.now() - startTime, false);
      throw new Error(`Failed to create ServiceMonitor: ${error.message}`);
    }
  }

  async deleteServiceMonitor(name: string, namespace: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      await this.executeWithRetry(async () => {
        return await this.customObjectsApi.deleteNamespacedCustomObject(
          'monitoring.coreos.com',
          'v1',
          namespace,
          'servicemonitors',
          name
        );
      });

      this.logger.info('ServiceMonitor deleted successfully', { name, namespace });
      this.recordOperationMetrics('delete_servicemonitor', Date.now() - startTime, true);
      
      return true;

    } catch (error) {
      if (error.response?.statusCode === 404) {
        this.logger.debug('ServiceMonitor not found for deletion', { name, namespace });
        return false;
      }

      this.logger.error('Failed to delete ServiceMonitor', {
        name,
        namespace,
        error: error.message
      });

      this.recordOperationMetrics('delete_servicemonitor', Date.now() - startTime, false);
      throw new Error(`Failed to delete ServiceMonitor: ${error.message}`);
    }
  }

  async createPrometheusRule(manifest: any): Promise<any> {
    const startTime = Date.now();
    
    try {
      this.logger.debug('Creating PrometheusRule', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace
      });

      const response = await this.executeWithRetry(async () => {
        return await this.customObjectsApi.createNamespacedCustomObject(
          'monitoring.coreos.com',
          'v1',
          manifest.metadata!.namespace!,
          'prometheusrules',
          manifest
        );
      });

      this.logger.info('PrometheusRule created successfully', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace
      });

      this.recordOperationMetrics('create_prometheusrule', Date.now() - startTime, true);
      return response.body;

    } catch (error) {
      this.logger.error('Failed to create PrometheusRule', {
        name: manifest.metadata?.name,
        namespace: manifest.metadata?.namespace,
        error: error.message
      });

      this.recordOperationMetrics('create_prometheusrule', Date.now() - startTime, false);
      throw new Error(`Failed to create PrometheusRule: ${error.message}`);
    }
  }

  async deletePrometheusRule(name: string, namespace: string): Promise<boolean> {
    const startTime = Date.now();
    
    try {
      await this.executeWithRetry(async () => {
        return await this.customObjectsApi.deleteNamespacedCustomObject(
          'monitoring.coreos.com',
          'v1',
          namespace,
          'prometheusrules',
          name
        );
      });

      this.logger.info('PrometheusRule deleted successfully', { name, namespace });
      this.recordOperationMetrics('delete_prometheusrule', Date.now() - startTime, true);
      
      return true;

    } catch (error) {
      if (error.response?.statusCode === 404) {
        this.logger.debug('PrometheusRule not found for deletion', { name, namespace });
        return false;
      }

      this.logger.error('Failed to delete PrometheusRule', {
        name,
        namespace,
        error: error.message
      });

      this.recordOperationMetrics('delete_prometheusrule', Date.now() - startTime, false);
      throw new Error(`Failed to delete PrometheusRule: ${error.message}`);
    }
  }

  async listDeployments(namespace: string, labelSelector?: string): Promise<k8s.V1Deployment[]> {
    try {
      const response = await this.k8sApi.listNamespacedDeployment(
        namespace,
        undefined,
        undefined,
        undefined,
        undefined,
        labelSelector
      );

      return response.body.items;

    } catch (error) {
      this.logger.error('Failed to list deployments', {
        namespace,
        labelSelector,
        error: error.message
      });
      
      throw new Error(`Failed to list deployments: ${error.message}`);
    }
  }

  async watchDeployment(
    name: string,
    namespace: string,
    callback: (event: string, deployment: k8s.V1Deployment) => void,
    timeoutMs: number = 300000
  ): Promise<void> {
    try {
      const watch = new k8s.Watch(this.kc);
      
      const request = await watch.watch(
        `/apis/apps/v1/namespaces/${namespace}/deployments`,
        { fieldSelector: `metadata.name=${name}` },
        callback,
        (error) => {
          if (error) {
            this.logger.error('Deployment watch error', {
              name,
              namespace,
              error: error.message
            });
          }
        }
      );

      // Set timeout
      setTimeout(() => {
        request.abort();
      }, timeoutMs);

    } catch (error) {
      this.logger.error('Failed to watch deployment', {
        name,
        namespace,
        error: error.message
      });
      
      throw new Error(`Failed to watch deployment: ${error.message}`);
    }
  }

  private async executeWithRetry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: Error;
    
    for (let attempt = 1; attempt <= this.config.retryAttempts; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        
        if (attempt === this.config.retryAttempts) {
          break;
        }

        // Don't retry on certain error codes
        if (error.response?.statusCode && [400, 401, 403, 404, 409].includes(error.response.statusCode)) {
          break;
        }

        this.logger.warn(`Operation failed, retrying (${attempt}/${this.config.retryAttempts})`, {
          error: error.message,
          attempt
        });

        await new Promise(resolve => setTimeout(resolve, this.config.retryDelay * attempt));
      }
    }

    throw lastError!;
  }

  private determineDeploymentStatus(status?: k8s.V1DeploymentStatus): 'pending' | 'progressing' | 'available' | 'failed' {
    if (!status) {
      return 'pending';
    }

    const conditions = status.conditions || [];
    
    // Check for failure conditions
    const failedCondition = conditions.find(c => 
      c.type === 'ReplicaFailure' && c.status === 'True'
    );
    if (failedCondition) {
      return 'failed';
    }

    // Check for available condition
    const availableCondition = conditions.find(c => 
      c.type === 'Available' && c.status === 'True'
    );
    if (availableCondition && status.readyReplicas === status.replicas) {
      return 'available';
    }

    // Check for progressing condition
    const progressingCondition = conditions.find(c => 
      c.type === 'Progressing' && c.status === 'True'
    );
    if (progressingCondition) {
      return 'progressing';
    }

    return 'pending';
  }

  private recordOperationMetrics(operation: string, duration: number, success: boolean): void {
    this.metrics.recordHistogram('kubernetes_operation_duration_ms', duration, {
      operation,
      success: success.toString()
    });

    this.metrics.incrementCounter('kubernetes_operations_total', {
      operation,
      success: success.toString()
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; message: string }> {
    try {
      // Try to list namespaces as a health check
      await this.coreApi.listNamespace();
      
      return {
        healthy: true,
        message: 'Kubernetes API is accessible'
      };

    } catch (error) {
      return {
        healthy: false,
        message: `Kubernetes API error: ${error.message}`
      };
    }
  }
}
