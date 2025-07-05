/**
 * Plugin Domain Events
 * 
 * Defines all domain events related to plugin lifecycle and operations.
 * These events enable event-driven architecture and integration with
 * other services in the platform.
 */

import { Plugin, PluginStatus, PluginExecutionResult } from '../entities/Plugin';

export interface DomainEvent {
  id: string;
  type: string;
  aggregateId: string;
  aggregateType: string;
  version: number;
  timestamp: Date;
  data: any;
  metadata?: {
    tenantId?: string;
    userId?: string;
    correlationId?: string;
    causationId?: string;
  };
}

// Plugin Lifecycle Events

export interface PluginUploadedEvent extends DomainEvent {
  type: 'PluginUploaded';
  data: {
    pluginId: string;
    pluginName: string;
    version: string;
    tenantId: string;
    uploadedBy: string;
    fileSize: number;
    checksum: string;
  };
}

export interface PluginValidatedEvent extends DomainEvent {
  type: 'PluginValidated';
  data: {
    pluginId: string;
    pluginName: string;
    version: string;
    tenantId: string;
    validationResult: {
      isValid: boolean;
      errors: string[];
      warnings: string[];
    };
  };
}

export interface PluginInstalledEvent extends DomainEvent {
  type: 'PluginInstalled';
  data: {
    pluginId: string;
    pluginName: string;
    version: string;
    tenantId: string;
    installedBy: string;
    dependencies: string[];
    permissions: string[];
  };
}

export interface PluginActivatedEvent extends DomainEvent {
  type: 'PluginActivated';
  data: {
    pluginId: string;
    pluginName: string;
    version: string;
    tenantId: string;
    activatedBy: string;
    configuration: Record<string, any>;
  };
}

export interface PluginDeactivatedEvent extends DomainEvent {
  type: 'PluginDeactivated';
  data: {
    pluginId: string;
    pluginName: string;
    version: string;
    tenantId: string;
    deactivatedBy: string;
    reason: string;
  };
}

export interface PluginUninstalledEvent extends DomainEvent {
  type: 'PluginUninstalled';
  data: {
    pluginId: string;
    pluginName: string;
    version: string;
    tenantId: string;
    uninstalledBy: string;
    reason: string;
    dependents: string[];
  };
}

export interface PluginUpdatedEvent extends DomainEvent {
  type: 'PluginUpdated';
  data: {
    pluginId: string;
    pluginName: string;
    oldVersion: string;
    newVersion: string;
    tenantId: string;
    updatedBy: string;
    changes: string[];
  };
}

export interface PluginConfigurationUpdatedEvent extends DomainEvent {
  type: 'PluginConfigurationUpdated';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    updatedBy: string;
    oldConfiguration: Record<string, any>;
    newConfiguration: Record<string, any>;
    changes: string[];
  };
}

// Plugin Execution Events

export interface PluginExecutionStartedEvent extends DomainEvent {
  type: 'PluginExecutionStarted';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    userId: string;
    executionId: string;
    trigger: 'api' | 'event' | 'schedule' | 'hook';
    context: any;
  };
}

export interface PluginExecutionCompletedEvent extends DomainEvent {
  type: 'PluginExecutionCompleted';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    userId: string;
    executionId: string;
    result: PluginExecutionResult;
    executionTime: number;
    memoryUsed: number;
    cpuUsed: number;
  };
}

export interface PluginExecutionFailedEvent extends DomainEvent {
  type: 'PluginExecutionFailed';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    userId: string;
    executionId: string;
    error: string;
    stackTrace?: string;
    executionTime: number;
    context: any;
  };
}

export interface PluginExecutionTimeoutEvent extends DomainEvent {
  type: 'PluginExecutionTimeout';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    userId: string;
    executionId: string;
    timeoutMs: number;
    context: any;
  };
}

// Plugin Health Events

export interface PluginHealthCheckEvent extends DomainEvent {
  type: 'PluginHealthCheck';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    healthScore: number;
    metrics: {
      executionCount: number;
      errorRate: number;
      averageExecutionTime: number;
      memoryUsage: number;
      cpuUsage: number;
    };
    issues: string[];
    recommendations: string[];
  };
}

export interface PluginErrorThresholdExceededEvent extends DomainEvent {
  type: 'PluginErrorThresholdExceeded';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    errorRate: number;
    threshold: number;
    recentErrors: Array<{
      timestamp: Date;
      error: string;
    }>;
  };
}

export interface PluginResourceLimitExceededEvent extends DomainEvent {
  type: 'PluginResourceLimitExceeded';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    resourceType: 'memory' | 'cpu' | 'timeout';
    usage: number;
    limit: number;
    action: 'warning' | 'throttle' | 'terminate';
  };
}

// Plugin Security Events

export interface PluginSecurityViolationEvent extends DomainEvent {
  type: 'PluginSecurityViolation';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    userId: string;
    violationType: 'permission' | 'resource' | 'network' | 'filesystem';
    description: string;
    attemptedAction: string;
    severity: 'low' | 'medium' | 'high' | 'critical';
  };
}

export interface PluginSandboxBreachEvent extends DomainEvent {
  type: 'PluginSandboxBreach';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    breachType: string;
    description: string;
    stackTrace: string;
    action: 'logged' | 'blocked' | 'terminated';
  };
}

// Plugin Marketplace Events

export interface PluginPublishedEvent extends DomainEvent {
  type: 'PluginPublished';
  data: {
    pluginId: string;
    pluginName: string;
    version: string;
    author: string;
    category: string;
    isPublic: boolean;
    publishedBy: string;
  };
}

export interface PluginDownloadedEvent extends DomainEvent {
  type: 'PluginDownloaded';
  data: {
    pluginId: string;
    pluginName: string;
    version: string;
    tenantId: string;
    downloadedBy: string;
    source: 'marketplace' | 'direct' | 'import';
  };
}

export interface PluginRatedEvent extends DomainEvent {
  type: 'PluginRated';
  data: {
    pluginId: string;
    pluginName: string;
    tenantId: string;
    userId: string;
    rating: number;
    review?: string;
    previousRating?: number;
  };
}

// Event Factory

export class PluginEventFactory {
  private static createBaseEvent(
    type: string,
    aggregateId: string,
    data: any,
    metadata?: DomainEvent['metadata']
  ): DomainEvent {
    return {
      id: require('uuid').v4(),
      type,
      aggregateId,
      aggregateType: 'Plugin',
      version: 1,
      timestamp: new Date(),
      data,
      metadata
    };
  }

  static createPluginUploadedEvent(
    plugin: Plugin,
    fileSize: number,
    checksum: string
  ): PluginUploadedEvent {
    return this.createBaseEvent('PluginUploaded', plugin.id, {
      pluginId: plugin.id,
      pluginName: plugin.manifest.metadata.name,
      version: plugin.manifest.metadata.version,
      tenantId: plugin.tenantId,
      uploadedBy: plugin.uploadedBy,
      fileSize,
      checksum
    }, {
      tenantId: plugin.tenantId,
      userId: plugin.uploadedBy
    }) as PluginUploadedEvent;
  }

  static createPluginValidatedEvent(
    plugin: Plugin,
    validationResult: { isValid: boolean; errors: string[]; warnings: string[] }
  ): PluginValidatedEvent {
    return this.createBaseEvent('PluginValidated', plugin.id, {
      pluginId: plugin.id,
      pluginName: plugin.manifest.metadata.name,
      version: plugin.manifest.metadata.version,
      tenantId: plugin.tenantId,
      validationResult
    }, {
      tenantId: plugin.tenantId
    }) as PluginValidatedEvent;
  }

  static createPluginInstalledEvent(
    plugin: Plugin,
    installedBy: string
  ): PluginInstalledEvent {
    return this.createBaseEvent('PluginInstalled', plugin.id, {
      pluginId: plugin.id,
      pluginName: plugin.manifest.metadata.name,
      version: plugin.manifest.metadata.version,
      tenantId: plugin.tenantId,
      installedBy,
      dependencies: Object.keys(plugin.manifest.dependencies.plugins || {}),
      permissions: plugin.manifest.security.permissions
    }, {
      tenantId: plugin.tenantId,
      userId: installedBy
    }) as PluginInstalledEvent;
  }

  static createPluginActivatedEvent(
    plugin: Plugin,
    activatedBy: string
  ): PluginActivatedEvent {
    return this.createBaseEvent('PluginActivated', plugin.id, {
      pluginId: plugin.id,
      pluginName: plugin.manifest.metadata.name,
      version: plugin.manifest.metadata.version,
      tenantId: plugin.tenantId,
      activatedBy,
      configuration: plugin.configuration
    }, {
      tenantId: plugin.tenantId,
      userId: activatedBy
    }) as PluginActivatedEvent;
  }

  static createPluginExecutionStartedEvent(
    plugin: Plugin,
    userId: string,
    executionId: string,
    trigger: 'api' | 'event' | 'schedule' | 'hook',
    context: any
  ): PluginExecutionStartedEvent {
    return this.createBaseEvent('PluginExecutionStarted', plugin.id, {
      pluginId: plugin.id,
      pluginName: plugin.manifest.metadata.name,
      tenantId: plugin.tenantId,
      userId,
      executionId,
      trigger,
      context
    }, {
      tenantId: plugin.tenantId,
      userId,
      correlationId: executionId
    }) as PluginExecutionStartedEvent;
  }

  static createPluginExecutionCompletedEvent(
    plugin: Plugin,
    userId: string,
    executionId: string,
    result: PluginExecutionResult,
    metrics: { executionTime: number; memoryUsed: number; cpuUsed: number }
  ): PluginExecutionCompletedEvent {
    return this.createBaseEvent('PluginExecutionCompleted', plugin.id, {
      pluginId: plugin.id,
      pluginName: plugin.manifest.metadata.name,
      tenantId: plugin.tenantId,
      userId,
      executionId,
      result,
      ...metrics
    }, {
      tenantId: plugin.tenantId,
      userId,
      correlationId: executionId
    }) as PluginExecutionCompletedEvent;
  }

  static createPluginExecutionFailedEvent(
    plugin: Plugin,
    userId: string,
    executionId: string,
    error: string,
    executionTime: number,
    context: any,
    stackTrace?: string
  ): PluginExecutionFailedEvent {
    return this.createBaseEvent('PluginExecutionFailed', plugin.id, {
      pluginId: plugin.id,
      pluginName: plugin.manifest.metadata.name,
      tenantId: plugin.tenantId,
      userId,
      executionId,
      error,
      stackTrace,
      executionTime,
      context
    }, {
      tenantId: plugin.tenantId,
      userId,
      correlationId: executionId
    }) as PluginExecutionFailedEvent;
  }

  static createPluginSecurityViolationEvent(
    plugin: Plugin,
    userId: string,
    violationType: 'permission' | 'resource' | 'network' | 'filesystem',
    description: string,
    attemptedAction: string,
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): PluginSecurityViolationEvent {
    return this.createBaseEvent('PluginSecurityViolation', plugin.id, {
      pluginId: plugin.id,
      pluginName: plugin.manifest.metadata.name,
      tenantId: plugin.tenantId,
      userId,
      violationType,
      description,
      attemptedAction,
      severity
    }, {
      tenantId: plugin.tenantId,
      userId
    }) as PluginSecurityViolationEvent;
  }
}
