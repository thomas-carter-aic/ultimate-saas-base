/**
 * Resource Provisioning Service Port
 * 
 * Interface for provisioning and managing tenant resources.
 * This port enables the application to provision infrastructure resources,
 * databases, storage, and other services for tenants.
 */

import { ResourceLimits, TenantSettings } from '../../domain/entities/Tenant';

export interface ResourceProvisioningService {
  /**
   * Provision resources for a new tenant
   * 
   * @param request - Resource provisioning request
   * @returns Promise resolving to provisioning result
   */
  provisionTenant(request: {
    tenantId: string;
    plan: string;
    resourceLimits: ResourceLimits;
    settings: TenantSettings;
  }): Promise<{
    success: boolean;
    resources?: {
      database?: {
        connectionString: string;
        maxConnections: number;
      };
      storage?: {
        bucketName: string;
        region: string;
        accessKey: string;
      };
      cache?: {
        endpoint: string;
        port: number;
      };
    };
    error?: string;
  }>;

  /**
   * Deprovision resources for a tenant
   * 
   * @param request - Deprovisioning request
   * @returns Promise resolving to deprovisioning result
   */
  deprovisionTenant(request: {
    tenantId: string;
    preserveData?: boolean;
    backupData?: boolean;
  }): Promise<{
    success: boolean;
    backupLocation?: string;
    error?: string;
  }>;

  /**
   * Scale tenant resources based on usage
   * 
   * @param request - Resource scaling request
   * @returns Promise resolving to scaling result
   */
  scaleResources(request: {
    tenantId: string;
    resourceType: 'database' | 'storage' | 'compute' | 'cache';
    scalingAction: 'up' | 'down';
    targetCapacity?: number;
  }): Promise<{
    success: boolean;
    newCapacity?: number;
    estimatedCost?: number;
    error?: string;
  }>;

  /**
   * Monitor tenant resource usage
   * 
   * @param request - Resource monitoring request
   * @returns Promise resolving to usage metrics
   */
  getResourceUsage(request: {
    tenantId: string;
    timeRange?: {
      start: Date;
      end: Date;
    };
    resourceTypes?: string[];
  }): Promise<{
    success: boolean;
    usage?: {
      database?: {
        connections: number;
        storageGB: number;
        queryCount: number;
        averageResponseTime: number;
      };
      storage?: {
        usedGB: number;
        requestCount: number;
        bandwidth: number;
      };
      compute?: {
        cpuUtilization: number;
        memoryUtilization: number;
        requestCount: number;
      };
      cache?: {
        hitRate: number;
        memoryUsage: number;
        connectionCount: number;
      };
    };
    error?: string;
  }>;

  /**
   * Setup custom domain for tenant
   * 
   * @param request - Custom domain setup request
   * @returns Promise resolving to domain setup result
   */
  setupCustomDomain(request: {
    tenantId: string;
    domain: string;
    sslEnabled?: boolean;
    cdnEnabled?: boolean;
  }): Promise<{
    success: boolean;
    dnsRecords?: Array<{
      type: string;
      name: string;
      value: string;
      ttl: number;
    }>;
    sslCertificate?: {
      status: string;
      expiresAt?: Date;
    };
    error?: string;
  }>;

  /**
   * Configure tenant isolation and security
   * 
   * @param request - Security configuration request
   * @returns Promise resolving to security setup result
   */
  configureSecurityIsolation(request: {
    tenantId: string;
    isolationLevel: 'shared' | 'dedicated' | 'hybrid';
    securitySettings: {
      networkIsolation?: boolean;
      dataEncryption?: boolean;
      accessLogging?: boolean;
      ipWhitelist?: string[];
    };
  }): Promise<{
    success: boolean;
    securityConfiguration?: {
      networkId?: string;
      encryptionKeys?: string[];
      logStreamId?: string;
    };
    error?: string;
  }>;

  /**
   * Backup tenant data
   * 
   * @param request - Backup request
   * @returns Promise resolving to backup result
   */
  backupTenantData(request: {
    tenantId: string;
    backupType: 'full' | 'incremental';
    retentionDays?: number;
    encryptBackup?: boolean;
  }): Promise<{
    success: boolean;
    backupId?: string;
    backupLocation?: string;
    backupSize?: number;
    error?: string;
  }>;

  /**
   * Restore tenant data from backup
   * 
   * @param request - Restore request
   * @returns Promise resolving to restore result
   */
  restoreTenantData(request: {
    tenantId: string;
    backupId: string;
    restorePoint?: Date;
    targetEnvironment?: 'production' | 'staging';
  }): Promise<{
    success: boolean;
    restoredAt?: Date;
    dataIntegrityCheck?: boolean;
    error?: string;
  }>;

  /**
   * Migrate tenant between regions or environments
   * 
   * @param request - Migration request
   * @returns Promise resolving to migration result
   */
  migrateTenant(request: {
    tenantId: string;
    sourceRegion: string;
    targetRegion: string;
    migrationStrategy: 'blue_green' | 'rolling' | 'maintenance_window';
    dataConsistencyCheck?: boolean;
  }): Promise<{
    success: boolean;
    migrationId?: string;
    estimatedDuration?: number;
    rollbackPlan?: string;
    error?: string;
  }>;

  /**
   * Get resource cost estimation
   * 
   * @param request - Cost estimation request
   * @returns Promise resolving to cost estimation
   */
  estimateResourceCosts(request: {
    plan: string;
    resourceLimits: ResourceLimits;
    usage?: {
      users: number;
      storageGB: number;
      apiCalls: number;
      aiInteractions: number;
    };
    region?: string;
  }): Promise<{
    success: boolean;
    costs?: {
      monthly: {
        base: number;
        compute: number;
        storage: number;
        network: number;
        total: number;
      };
      overage?: {
        perUser: number;
        perGB: number;
        perApiCall: number;
        perAIInteraction: number;
      };
    };
    error?: string;
  }>;

  /**
   * Configure auto-scaling policies
   * 
   * @param request - Auto-scaling configuration request
   * @returns Promise resolving to configuration result
   */
  configureAutoScaling(request: {
    tenantId: string;
    policies: Array<{
      resourceType: string;
      metric: string;
      threshold: number;
      scalingAction: 'scale_up' | 'scale_down';
      cooldownPeriod: number;
    }>;
  }): Promise<{
    success: boolean;
    policyIds?: string[];
    error?: string;
  }>;

  /**
   * Get resource health status
   * 
   * @param request - Health check request
   * @returns Promise resolving to health status
   */
  getResourceHealth(request: {
    tenantId: string;
    resourceTypes?: string[];
  }): Promise<{
    success: boolean;
    health?: Array<{
      resourceType: string;
      status: 'healthy' | 'degraded' | 'unhealthy';
      lastChecked: Date;
      metrics?: Record<string, number>;
      issues?: string[];
    }>;
    error?: string;
  }>;
}
