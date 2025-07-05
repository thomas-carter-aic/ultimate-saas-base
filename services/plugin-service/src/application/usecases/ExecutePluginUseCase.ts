/**
 * Execute Plugin Use Case
 * 
 * Handles the secure execution of plugins within isolated sandboxes.
 * Manages resource limits, security constraints, and execution monitoring.
 */

import { v4 as uuidv4 } from 'uuid';
import { Plugin, PluginExecutionContext, PluginExecutionResult } from '../../domain/entities/Plugin';
import { PluginRepository } from '../../domain/repositories/PluginRepository';
import { EventPublisher } from '../ports/EventPublisher';
import { Logger } from '../ports/Logger';
import { PluginSandbox } from '../ports/PluginSandbox';
import { FileStorage } from '../ports/FileStorage';
import { PluginEventFactory } from '../../domain/events/PluginEvents';

export interface ExecutePluginRequest {
  pluginId: string;
  tenantId: string;
  userId: string;
  functionName?: string; // Specific function to execute, defaults to 'execute'
  parameters?: any; // Parameters to pass to the plugin
  context?: any; // Additional context data
  timeout?: number; // Override default timeout
  trigger: 'api' | 'event' | 'schedule' | 'hook';
}

export interface ExecutePluginResponse {
  success: boolean;
  executionId: string;
  result?: PluginExecutionResult;
  error?: string;
  metrics?: {
    executionTime: number;
    memoryUsed: number;
    cpuUsed: number;
  };
}

export class ExecutePluginUseCase {
  constructor(
    private pluginRepository: PluginRepository,
    private eventPublisher: EventPublisher,
    private pluginSandbox: PluginSandbox,
    private fileStorage: FileStorage,
    private logger: Logger
  ) {}

  async execute(request: ExecutePluginRequest): Promise<ExecutePluginResponse> {
    const executionId = uuidv4();
    const startTime = Date.now();

    try {
      this.logger.info('Starting plugin execution', {
        pluginId: request.pluginId,
        tenantId: request.tenantId,
        userId: request.userId,
        executionId,
        trigger: request.trigger
      });

      // Validate input
      const inputValidation = this.validateInput(request);
      if (!inputValidation.isValid) {
        return {
          success: false,
          executionId,
          error: inputValidation.errors.join(', ')
        };
      }

      // Get plugin
      const plugin = await this.pluginRepository.findById(request.pluginId);
      if (!plugin) {
        return {
          success: false,
          executionId,
          error: 'Plugin not found'
        };
      }

      // Verify tenant access
      if (plugin.tenantId !== request.tenantId) {
        this.logger.warn('Unauthorized plugin execution attempt', {
          pluginId: request.pluginId,
          pluginTenantId: plugin.tenantId,
          requestTenantId: request.tenantId,
          userId: request.userId
        });

        return {
          success: false,
          executionId,
          error: 'Unauthorized access to plugin'
        };
      }

      // Check if plugin can be executed
      if (!plugin.canExecute()) {
        return {
          success: false,
          executionId,
          error: `Plugin is not active (status: ${plugin.status})`
        };
      }

      // Publish execution started event
      const startedEvent = PluginEventFactory.createPluginExecutionStartedEvent(
        plugin,
        request.userId,
        executionId,
        request.trigger,
        request.context || {}
      );
      await this.eventPublisher.publish(startedEvent);

      // Prepare execution context
      const executionContext = await this.prepareExecutionContext(
        plugin,
        request,
        executionId
      );

      // Load plugin files
      const pluginFiles = await this.loadPluginFiles(plugin);
      if (!pluginFiles.success) {
        return {
          success: false,
          executionId,
          error: pluginFiles.error
        };
      }

      // Execute plugin in sandbox
      const executionResult = await this.executeInSandbox(
        plugin,
        pluginFiles.files!,
        executionContext,
        request.functionName || 'execute',
        request.parameters || {},
        request.timeout
      );

      const executionTime = Date.now() - startTime;

      // Record execution metrics
      const metrics = {
        executionTime,
        memoryUsed: executionResult.metrics?.memoryUsed || 0,
        cpuUsed: executionResult.metrics?.cpuUsed || 0
      };

      // Update plugin execution statistics
      const updatedPlugin = plugin.recordExecution(executionTime, executionResult.success);
      await this.pluginRepository.update(updatedPlugin);

      // Record execution in repository
      await this.pluginRepository.recordExecution(plugin.id, {
        success: executionResult.success,
        executionTime,
        memoryUsed: metrics.memoryUsed,
        cpuUsed: metrics.cpuUsed,
        error: executionResult.error,
        logs: executionResult.logs
      });

      // Publish execution completed/failed event
      if (executionResult.success) {
        const completedEvent = PluginEventFactory.createPluginExecutionCompletedEvent(
          plugin,
          request.userId,
          executionId,
          executionResult,
          metrics
        );
        await this.eventPublisher.publish(completedEvent);
      } else {
        const failedEvent = PluginEventFactory.createPluginExecutionFailedEvent(
          plugin,
          request.userId,
          executionId,
          executionResult.error || 'Unknown error',
          executionTime,
          request.context || {}
        );
        await this.eventPublisher.publish(failedEvent);
      }

      this.logger.info('Plugin execution completed', {
        pluginId: request.pluginId,
        executionId,
        success: executionResult.success,
        executionTime,
        memoryUsed: metrics.memoryUsed
      });

      return {
        success: executionResult.success,
        executionId,
        result: executionResult,
        error: executionResult.success ? undefined : executionResult.error,
        metrics
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;

      this.logger.error('Error executing plugin', error as Error, {
        pluginId: request.pluginId,
        tenantId: request.tenantId,
        userId: request.userId,
        executionId
      });

      // Publish execution failed event
      try {
        const plugin = await this.pluginRepository.findById(request.pluginId);
        if (plugin) {
          const failedEvent = PluginEventFactory.createPluginExecutionFailedEvent(
            plugin,
            request.userId,
            executionId,
            (error as Error).message,
            executionTime,
            request.context || {},
            (error as Error).stack
          );
          await this.eventPublisher.publish(failedEvent);
        }
      } catch (eventError) {
        this.logger.error('Error publishing execution failed event', eventError as Error);
      }

      return {
        success: false,
        executionId,
        error: 'Plugin execution failed'
      };
    }
  }

  private validateInput(request: ExecutePluginRequest): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request.pluginId) {
      errors.push('Plugin ID is required');
    }

    if (!request.tenantId) {
      errors.push('Tenant ID is required');
    }

    if (!request.userId) {
      errors.push('User ID is required');
    }

    if (!request.trigger) {
      errors.push('Execution trigger is required');
    }

    const validTriggers = ['api', 'event', 'schedule', 'hook'];
    if (request.trigger && !validTriggers.includes(request.trigger)) {
      errors.push('Invalid execution trigger');
    }

    if (request.timeout && (request.timeout < 1000 || request.timeout > 300000)) {
      errors.push('Timeout must be between 1 second and 5 minutes');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private async prepareExecutionContext(
    plugin: Plugin,
    request: ExecutePluginRequest,
    executionId: string
  ): Promise<PluginExecutionContext> {
    return {
      tenantId: request.tenantId,
      userId: request.userId,
      requestId: executionId,
      timestamp: new Date(),
      environment: process.env.NODE_ENV as 'development' | 'staging' | 'production' || 'development',
      configuration: plugin.configuration,
      services: {
        logger: this.createPluginLogger(plugin, executionId),
        database: this.createDatabaseService(plugin),
        cache: this.createCacheService(plugin),
        events: this.createEventService(plugin),
        http: this.createHttpService(plugin)
      }
    };
  }

  private async loadPluginFiles(plugin: Plugin): Promise<{
    success: boolean;
    files?: Map<string, string>;
    error?: string;
  }> {
    try {
      const storagePath = `plugins/${plugin.tenantId}/${plugin.manifest.metadata.name}/${plugin.manifest.metadata.version}`;
      const files = new Map<string, string>();

      // Load all plugin files
      for (const file of plugin.manifest.files) {
        const filePath = `${storagePath}/files/${file}`;
        const fileContent = await this.fileStorage.get(filePath);
        
        if (!fileContent) {
          return {
            success: false,
            error: `Plugin file not found: ${file}`
          };
        }

        files.set(file, fileContent.toString('utf-8'));
      }

      return {
        success: true,
        files
      };

    } catch (error) {
      this.logger.error('Error loading plugin files', error as Error, {
        pluginId: plugin.id
      });

      return {
        success: false,
        error: 'Failed to load plugin files'
      };
    }
  }

  private async executeInSandbox(
    plugin: Plugin,
    files: Map<string, string>,
    context: PluginExecutionContext,
    functionName: string,
    parameters: any,
    timeout?: number
  ): Promise<PluginExecutionResult> {
    const effectiveTimeout = timeout || plugin.manifest.security.resourceLimits.timeout;

    try {
      // Create sandbox configuration
      const sandboxConfig = {
        memoryLimit: plugin.manifest.security.resourceLimits.memory * 1024 * 1024, // Convert MB to bytes
        cpuLimit: plugin.manifest.security.resourceLimits.cpu,
        timeout: effectiveTimeout,
        allowedModules: plugin.manifest.security.allowedModules || [],
        networkAccess: plugin.manifest.security.resourceLimits.network,
        fileSystemAccess: plugin.manifest.security.resourceLimits.fileSystem,
        trustedDomains: plugin.manifest.security.trustedDomains || []
      };

      // Execute in sandbox
      const result = await this.pluginSandbox.execute({
        files,
        entryPoint: plugin.manifest.entryPoint,
        functionName,
        parameters,
        context,
        config: sandboxConfig
      });

      return result;

    } catch (error) {
      this.logger.error('Error in sandbox execution', error as Error, {
        pluginId: plugin.id,
        functionName
      });

      return {
        success: false,
        error: (error as Error).message,
        logs: [`Sandbox execution error: ${(error as Error).message}`]
      };
    }
  }

  private createPluginLogger(plugin: Plugin, executionId: string) {
    return {
      info: (message: string, metadata?: any) => {
        this.logger.info(`[Plugin:${plugin.manifest.metadata.name}] ${message}`, {
          pluginId: plugin.id,
          executionId,
          ...metadata
        });
      },
      warn: (message: string, metadata?: any) => {
        this.logger.warn(`[Plugin:${plugin.manifest.metadata.name}] ${message}`, {
          pluginId: plugin.id,
          executionId,
          ...metadata
        });
      },
      error: (message: string, error?: Error, metadata?: any) => {
        this.logger.error(`[Plugin:${plugin.manifest.metadata.name}] ${message}`, error, {
          pluginId: plugin.id,
          executionId,
          ...metadata
        });
      },
      debug: (message: string, metadata?: any) => {
        this.logger.debug(`[Plugin:${plugin.manifest.metadata.name}] ${message}`, {
          pluginId: plugin.id,
          executionId,
          ...metadata
        });
      }
    };
  }

  private createDatabaseService(plugin: Plugin) {
    // Return database service if plugin has database permission
    if (plugin.hasPermission('database')) {
      return {
        query: async (sql: string, params?: any[]) => {
          // Implement database query with tenant isolation
          // This would use a connection pool with tenant-specific database or schema
          throw new Error('Database service not implemented');
        },
        transaction: async (callback: Function) => {
          // Implement database transaction
          throw new Error('Database transaction not implemented');
        }
      };
    }

    return null;
  }

  private createCacheService(plugin: Plugin) {
    // Return cache service if plugin has cache permission
    if (plugin.hasPermission('cache')) {
      return {
        get: async (key: string) => {
          // Implement cache get with tenant isolation
          throw new Error('Cache service not implemented');
        },
        set: async (key: string, value: any, ttl?: number) => {
          // Implement cache set with tenant isolation
          throw new Error('Cache service not implemented');
        },
        delete: async (key: string) => {
          // Implement cache delete
          throw new Error('Cache service not implemented');
        }
      };
    }

    return null;
  }

  private createEventService(plugin: Plugin) {
    // Return event service if plugin has events permission
    if (plugin.hasPermission('events')) {
      return {
        publish: async (eventName: string, data: any) => {
          // Implement event publishing with tenant isolation
          throw new Error('Event service not implemented');
        },
        subscribe: async (eventName: string, handler: Function) => {
          // Implement event subscription
          throw new Error('Event subscription not implemented');
        }
      };
    }

    return null;
  }

  private createHttpService(plugin: Plugin) {
    // Return HTTP service if plugin has network permission
    if (plugin.hasPermission('network')) {
      return {
        get: async (url: string, options?: any) => {
          // Implement HTTP GET with domain restrictions
          throw new Error('HTTP service not implemented');
        },
        post: async (url: string, data: any, options?: any) => {
          // Implement HTTP POST with domain restrictions
          throw new Error('HTTP service not implemented');
        }
      };
    }

    return null;
  }
}
