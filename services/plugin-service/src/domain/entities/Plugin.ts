/**
 * Plugin Domain Entity
 * 
 * Represents a plugin in the system with its metadata, configuration,
 * and execution context. Implements business rules for plugin lifecycle
 * management, security validation, and dependency resolution.
 */

import { v4 as uuidv4 } from 'uuid';
import * as semver from 'semver';

export interface PluginMetadata {
  name: string;
  version: string;
  description: string;
  author: string;
  license: string;
  homepage?: string;
  repository?: string;
  keywords: string[];
  category: 'ai' | 'integration' | 'analytics' | 'workflow' | 'ui' | 'utility';
  tags: string[];
}

export interface PluginDependencies {
  platform: string; // Minimum platform version required
  node: string; // Node.js version requirement
  plugins?: Record<string, string>; // Other plugin dependencies
  services?: string[]; // Required platform services
  permissions?: string[]; // Required permissions
}

export interface PluginConfiguration {
  schema: any; // JSON schema for configuration validation
  defaults: Record<string, any>; // Default configuration values
  required: string[]; // Required configuration keys
  sensitive: string[]; // Sensitive configuration keys (encrypted)
}

export interface PluginAPI {
  endpoints?: Array<{
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    path: string;
    handler: string; // Function name in plugin
    middleware?: string[]; // Middleware functions
    auth?: boolean; // Requires authentication
    permissions?: string[]; // Required permissions
  }>;
  events?: Array<{
    name: string;
    handler: string; // Function name in plugin
    priority?: number; // Event handler priority
  }>;
  hooks?: Array<{
    name: string;
    handler: string; // Function name in plugin
    phase: 'before' | 'after' | 'around';
  }>;
  scheduled?: Array<{
    name: string;
    handler: string; // Function name in plugin
    cron: string; // Cron expression
    timezone?: string;
  }>;
}

export interface PluginSecurity {
  sandbox: boolean; // Run in isolated sandbox
  permissions: string[]; // Granted permissions
  resourceLimits: {
    memory: number; // Memory limit in MB
    cpu: number; // CPU limit (percentage)
    timeout: number; // Execution timeout in ms
    fileSystem: boolean; // File system access
    network: boolean; // Network access
    database: boolean; // Database access
  };
  trustedDomains?: string[]; // Allowed network domains
  allowedModules?: string[]; // Allowed Node.js modules
}

export interface PluginManifest {
  metadata: PluginMetadata;
  dependencies: PluginDependencies;
  configuration: PluginConfiguration;
  api: PluginAPI;
  security: PluginSecurity;
  entryPoint: string; // Main plugin file
  files: string[]; // Plugin files
  checksum: string; // Plugin integrity checksum
}

export type PluginStatus = 
  | 'pending'     // Uploaded but not validated
  | 'validating'  // Being validated
  | 'validated'   // Passed validation
  | 'installing'  // Being installed
  | 'installed'   // Installed but not active
  | 'active'      // Running and available
  | 'inactive'    // Installed but disabled
  | 'error'       // Error state
  | 'deprecated'  // Marked for removal
  | 'removed';    // Uninstalled

export interface PluginExecutionContext {
  tenantId: string;
  userId: string;
  requestId: string;
  timestamp: Date;
  environment: 'development' | 'staging' | 'production';
  configuration: Record<string, any>;
  services: {
    logger: any;
    database: any;
    cache: any;
    events: any;
    http: any;
  };
}

export interface PluginExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  logs?: string[];
  metrics?: {
    executionTime: number;
    memoryUsed: number;
    cpuUsed: number;
  };
}

export class Plugin {
  public readonly id: string;
  public readonly manifest: PluginManifest;
  public readonly status: PluginStatus;
  public readonly tenantId: string;
  public readonly uploadedBy: string;
  public readonly configuration: Record<string, any>;
  public readonly createdAt: Date;
  public readonly updatedAt: Date;
  public readonly installedAt?: Date;
  public readonly lastExecutedAt?: Date;
  public readonly executionCount: number;
  public readonly errorCount: number;
  public readonly averageExecutionTime: number;

  constructor(
    id: string,
    manifest: PluginManifest,
    status: PluginStatus,
    tenantId: string,
    uploadedBy: string,
    configuration: Record<string, any> = {},
    createdAt: Date = new Date(),
    updatedAt: Date = new Date(),
    installedAt?: Date,
    lastExecutedAt?: Date,
    executionCount: number = 0,
    errorCount: number = 0,
    averageExecutionTime: number = 0
  ) {
    this.id = id;
    this.manifest = manifest;
    this.status = status;
    this.tenantId = tenantId;
    this.uploadedBy = uploadedBy;
    this.configuration = configuration;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.installedAt = installedAt;
    this.lastExecutedAt = lastExecutedAt;
    this.executionCount = executionCount;
    this.errorCount = errorCount;
    this.averageExecutionTime = averageExecutionTime;
  }

  /**
   * Create a new plugin instance
   */
  static create(
    manifest: PluginManifest,
    tenantId: string,
    uploadedBy: string,
    configuration: Record<string, any> = {}
  ): Plugin {
    const id = uuidv4();
    
    return new Plugin(
      id,
      manifest,
      'pending',
      tenantId,
      uploadedBy,
      configuration
    );
  }

  /**
   * Validate plugin manifest and dependencies
   */
  validate(): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate metadata
    if (!this.manifest.metadata.name || this.manifest.metadata.name.length < 3) {
      errors.push('Plugin name must be at least 3 characters long');
    }

    if (!semver.valid(this.manifest.metadata.version)) {
      errors.push('Plugin version must be a valid semantic version');
    }

    if (!this.manifest.metadata.description || this.manifest.metadata.description.length < 10) {
      errors.push('Plugin description must be at least 10 characters long');
    }

    if (!this.manifest.metadata.author) {
      errors.push('Plugin author is required');
    }

    // Validate dependencies
    if (!semver.validRange(this.manifest.dependencies.platform)) {
      errors.push('Platform version requirement must be a valid semver range');
    }

    if (!semver.validRange(this.manifest.dependencies.node)) {
      errors.push('Node.js version requirement must be a valid semver range');
    }

    // Validate configuration schema
    if (this.manifest.configuration.schema && typeof this.manifest.configuration.schema !== 'object') {
      errors.push('Configuration schema must be a valid JSON schema object');
    }

    // Validate API endpoints
    if (this.manifest.api.endpoints) {
      for (const endpoint of this.manifest.api.endpoints) {
        if (!endpoint.method || !endpoint.path || !endpoint.handler) {
          errors.push('API endpoints must have method, path, and handler');
        }

        if (!endpoint.path.startsWith('/')) {
          errors.push('API endpoint paths must start with /');
        }
      }
    }

    // Validate security settings
    if (this.manifest.security.resourceLimits.memory < 1 || this.manifest.security.resourceLimits.memory > 1024) {
      errors.push('Memory limit must be between 1 and 1024 MB');
    }

    if (this.manifest.security.resourceLimits.timeout < 1000 || this.manifest.security.resourceLimits.timeout > 300000) {
      errors.push('Timeout must be between 1 second and 5 minutes');
    }

    // Validate entry point
    if (!this.manifest.entryPoint || !this.manifest.entryPoint.endsWith('.js')) {
      errors.push('Entry point must be a valid JavaScript file');
    }

    // Validate files
    if (!this.manifest.files || this.manifest.files.length === 0) {
      errors.push('Plugin must contain at least one file');
    }

    if (!this.manifest.files.includes(this.manifest.entryPoint)) {
      errors.push('Entry point must be included in plugin files');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Check if plugin is compatible with platform version
   */
  isCompatible(platformVersion: string): boolean {
    return semver.satisfies(platformVersion, this.manifest.dependencies.platform);
  }

  /**
   * Check if plugin dependencies are satisfied
   */
  checkDependencies(availablePlugins: Plugin[], platformServices: string[]): { satisfied: boolean; missing: string[] } {
    const missing: string[] = [];

    // Check plugin dependencies
    if (this.manifest.dependencies.plugins) {
      for (const [pluginName, versionRange] of Object.entries(this.manifest.dependencies.plugins)) {
        const dependentPlugin = availablePlugins.find(p => p.manifest.metadata.name === pluginName);
        
        if (!dependentPlugin) {
          missing.push(`Plugin dependency: ${pluginName}`);
        } else if (!semver.satisfies(dependentPlugin.manifest.metadata.version, versionRange)) {
          missing.push(`Plugin dependency: ${pluginName}@${versionRange} (found ${dependentPlugin.manifest.metadata.version})`);
        }
      }
    }

    // Check service dependencies
    if (this.manifest.dependencies.services) {
      for (const service of this.manifest.dependencies.services) {
        if (!platformServices.includes(service)) {
          missing.push(`Service dependency: ${service}`);
        }
      }
    }

    return {
      satisfied: missing.length === 0,
      missing
    };
  }

  /**
   * Validate configuration against schema
   */
  validateConfiguration(config: Record<string, any>): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check required fields
    for (const required of this.manifest.configuration.required) {
      if (!(required in config)) {
        errors.push(`Required configuration field missing: ${required}`);
      }
    }

    // TODO: Implement JSON schema validation
    // This would use a library like ajv to validate against the schema

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get plugin permissions
   */
  getPermissions(): string[] {
    return [...this.manifest.security.permissions];
  }

  /**
   * Check if plugin has specific permission
   */
  hasPermission(permission: string): boolean {
    return this.manifest.security.permissions.includes(permission);
  }

  /**
   * Get plugin resource limits
   */
  getResourceLimits() {
    return { ...this.manifest.security.resourceLimits };
  }

  /**
   * Update plugin status
   */
  updateStatus(newStatus: PluginStatus): Plugin {
    return new Plugin(
      this.id,
      this.manifest,
      newStatus,
      this.tenantId,
      this.uploadedBy,
      this.configuration,
      this.createdAt,
      new Date(),
      newStatus === 'installed' ? new Date() : this.installedAt,
      this.lastExecutedAt,
      this.executionCount,
      this.errorCount,
      this.averageExecutionTime
    );
  }

  /**
   * Update plugin configuration
   */
  updateConfiguration(newConfig: Record<string, any>): Plugin {
    return new Plugin(
      this.id,
      this.manifest,
      this.status,
      this.tenantId,
      this.uploadedBy,
      { ...this.configuration, ...newConfig },
      this.createdAt,
      new Date(),
      this.installedAt,
      this.lastExecutedAt,
      this.executionCount,
      this.errorCount,
      this.averageExecutionTime
    );
  }

  /**
   * Record plugin execution
   */
  recordExecution(executionTime: number, success: boolean): Plugin {
    const newExecutionCount = this.executionCount + 1;
    const newErrorCount = success ? this.errorCount : this.errorCount + 1;
    const newAverageExecutionTime = ((this.averageExecutionTime * this.executionCount) + executionTime) / newExecutionCount;

    return new Plugin(
      this.id,
      this.manifest,
      this.status,
      this.tenantId,
      this.uploadedBy,
      this.configuration,
      this.createdAt,
      new Date(),
      this.installedAt,
      new Date(),
      newExecutionCount,
      newErrorCount,
      newAverageExecutionTime
    );
  }

  /**
   * Get plugin health metrics
   */
  getHealthMetrics() {
    const errorRate = this.executionCount > 0 ? (this.errorCount / this.executionCount) * 100 : 0;
    const isHealthy = errorRate < 5 && this.averageExecutionTime < 5000; // Less than 5% error rate and 5s avg execution

    return {
      executionCount: this.executionCount,
      errorCount: this.errorCount,
      errorRate: Math.round(errorRate * 100) / 100,
      averageExecutionTime: Math.round(this.averageExecutionTime),
      lastExecutedAt: this.lastExecutedAt,
      isHealthy,
      status: this.status
    };
  }

  /**
   * Check if plugin can be executed
   */
  canExecute(): boolean {
    return this.status === 'active';
  }

  /**
   * Get plugin summary for API responses
   */
  toSummary() {
    return {
      id: this.id,
      name: this.manifest.metadata.name,
      version: this.manifest.metadata.version,
      description: this.manifest.metadata.description,
      author: this.manifest.metadata.author,
      category: this.manifest.metadata.category,
      status: this.status,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      health: this.getHealthMetrics()
    };
  }

  /**
   * Get full plugin details
   */
  toDetail() {
    return {
      id: this.id,
      manifest: this.manifest,
      status: this.status,
      tenantId: this.tenantId,
      uploadedBy: this.uploadedBy,
      configuration: this.configuration,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      installedAt: this.installedAt,
      health: this.getHealthMetrics()
    };
  }
}
