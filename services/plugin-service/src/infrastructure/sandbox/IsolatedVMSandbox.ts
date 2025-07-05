/**
 * Isolated VM Sandbox Implementation
 * 
 * Provides secure plugin execution using isolated-vm library.
 * Implements resource limits, security constraints, and monitoring.
 */

import * as ivm from 'isolated-vm';
import { PluginSandbox, SandboxExecutionRequest, SandboxConfig } from '../../application/ports/PluginSandbox';
import { PluginExecutionResult } from '../../domain/entities/Plugin';
import { Logger } from '../../application/ports/Logger';

export class IsolatedVMSandbox implements PluginSandbox {
  private activeExecutions = new Map<string, ivm.Isolate>();
  private resourceUsage = {
    memoryUsed: 0,
    cpuUsed: 0,
    activeExecutions: 0
  };

  constructor(private logger: Logger) {}

  async execute(request: SandboxExecutionRequest): Promise<PluginExecutionResult> {
    const executionId = `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    let isolate: ivm.Isolate | null = null;

    try {
      // Create isolated VM
      isolate = new ivm.Isolate({
        memoryLimit: Math.floor(request.config.memoryLimit / (1024 * 1024)), // Convert bytes to MB
        inspector: false // Disable inspector for security
      });

      this.activeExecutions.set(executionId, isolate);
      this.resourceUsage.activeExecutions++;

      // Create context
      const context = await isolate.createContext();

      // Setup global objects and APIs
      await this.setupGlobals(context, request);

      // Load plugin files into context
      await this.loadPluginFiles(context, request.files);

      // Prepare execution script
      const executionScript = this.createExecutionScript(
        request.entryPoint,
        request.functionName,
        request.parameters,
        request.context
      );

      // Compile and run script
      const script = await isolate.compileScript(executionScript);
      
      // Execute with timeout
      const result = await script.run(context, {
        timeout: request.config.timeout,
        copy: true
      });

      const executionTime = Date.now() - startTime;

      // Get memory usage
      const memoryUsed = isolate.getHeapStatisticsSync().used_heap_size;

      this.logger.info('Plugin execution completed successfully', {
        executionId,
        executionTime,
        memoryUsed
      });

      return {
        success: true,
        data: result,
        metrics: {
          executionTime,
          memoryUsed,
          cpuUsed: 0 // CPU usage tracking would require additional implementation
        }
      };

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      this.logger.error('Plugin execution failed', error as Error, {
        executionId,
        executionTime
      });

      let errorMessage = (error as Error).message;
      
      // Handle specific error types
      if (errorMessage.includes('Script execution timed out')) {
        errorMessage = `Execution timed out after ${request.config.timeout}ms`;
      } else if (errorMessage.includes('Array buffer allocation failed')) {
        errorMessage = `Memory limit exceeded (${Math.floor(request.config.memoryLimit / (1024 * 1024))}MB)`;
      }

      return {
        success: false,
        error: errorMessage,
        metrics: {
          executionTime,
          memoryUsed: isolate?.getHeapStatisticsSync().used_heap_size || 0,
          cpuUsed: 0
        }
      };

    } finally {
      // Cleanup
      if (isolate) {
        try {
          isolate.dispose();
        } catch (disposeError) {
          this.logger.error('Error disposing isolate', disposeError as Error);
        }
      }

      this.activeExecutions.delete(executionId);
      this.resourceUsage.activeExecutions--;
    }
  }

  async validateCode(code: string): Promise<{
    isValid: boolean;
    issues: Array<{
      type: 'error' | 'warning';
      message: string;
      line?: number;
      column?: number;
    }>;
  }> {
    const issues: Array<{
      type: 'error' | 'warning';
      message: string;
      line?: number;
      column?: number;
    }> = [];

    try {
      // Create temporary isolate for validation
      const isolate = new ivm.Isolate({ memoryLimit: 32 }); // 32MB for validation
      
      try {
        // Try to compile the code
        await isolate.compileScript(code);
        
        // Check for potentially dangerous patterns
        this.checkSecurityPatterns(code, issues);
        
      } finally {
        isolate.dispose();
      }

    } catch (error) {
      issues.push({
        type: 'error',
        message: (error as Error).message
      });
    }

    return {
      isValid: issues.filter(issue => issue.type === 'error').length === 0,
      issues
    };
  }

  async getResourceUsage(): Promise<{
    memoryUsed: number;
    cpuUsed: number;
    activeExecutions: number;
  }> {
    // Calculate total memory usage from active isolates
    let totalMemory = 0;
    for (const isolate of this.activeExecutions.values()) {
      try {
        totalMemory += isolate.getHeapStatisticsSync().used_heap_size;
      } catch (error) {
        // Isolate might be disposed
      }
    }

    return {
      memoryUsed: totalMemory,
      cpuUsed: this.resourceUsage.cpuUsed,
      activeExecutions: this.resourceUsage.activeExecutions
    };
  }

  async terminate(executionId: string): Promise<void> {
    const isolate = this.activeExecutions.get(executionId);
    if (isolate) {
      try {
        isolate.dispose();
        this.activeExecutions.delete(executionId);
        this.resourceUsage.activeExecutions--;
        
        this.logger.info('Plugin execution terminated', { executionId });
      } catch (error) {
        this.logger.error('Error terminating plugin execution', error as Error, { executionId });
      }
    }
  }

  async cleanup(): Promise<void> {
    // Dispose all active isolates
    for (const [executionId, isolate] of this.activeExecutions.entries()) {
      try {
        isolate.dispose();
      } catch (error) {
        this.logger.error('Error disposing isolate during cleanup', error as Error, { executionId });
      }
    }

    this.activeExecutions.clear();
    this.resourceUsage.activeExecutions = 0;
    
    this.logger.info('Sandbox cleanup completed');
  }

  private async setupGlobals(context: ivm.Context, request: SandboxExecutionRequest): Promise<void> {
    const global = context.global;

    // Setup console
    await global.set('console', new ivm.Reference({
      log: (...args: any[]) => {
        this.logger.info('[Plugin Console]', { args });
      },
      error: (...args: any[]) => {
        this.logger.error('[Plugin Console]', new Error(args.join(' ')));
      },
      warn: (...args: any[]) => {
        this.logger.warn('[Plugin Console]', { args });
      },
      info: (...args: any[]) => {
        this.logger.info('[Plugin Console]', { args });
      }
    }));

    // Setup setTimeout/setInterval (limited)
    await global.set('setTimeout', new ivm.Reference((callback: Function, delay: number) => {
      if (delay > 60000) { // Max 1 minute
        throw new Error('setTimeout delay cannot exceed 60 seconds');
      }
      return setTimeout(callback, delay);
    }));

    // Setup basic utilities
    await global.set('JSON', new ivm.Reference(JSON));
    await global.set('Math', new ivm.Reference(Math));
    await global.set('Date', new ivm.Reference(Date));

    // Setup plugin context
    await global.set('__PLUGIN_CONTEXT__', new ivm.ExternalCopy(request.context).copyInto());

    // Setup allowed modules (if any)
    if (request.config.allowedModules.length > 0) {
      const modules: Record<string, any> = {};
      
      for (const moduleName of request.config.allowedModules) {
        try {
          // Only allow specific safe modules
          if (this.isSafeModule(moduleName)) {
            modules[moduleName] = require(moduleName);
          }
        } catch (error) {
          this.logger.warn('Failed to load allowed module', { moduleName, error: (error as Error).message });
        }
      }

      await global.set('__MODULES__', new ivm.ExternalCopy(modules).copyInto());
    }
  }

  private async loadPluginFiles(context: ivm.Context, files: Map<string, string>): Promise<void> {
    const global = context.global;
    const filesObject: Record<string, string> = {};

    for (const [filename, content] of files.entries()) {
      filesObject[filename] = content;
    }

    await global.set('__PLUGIN_FILES__', new ivm.ExternalCopy(filesObject).copyInto());
  }

  private createExecutionScript(
    entryPoint: string,
    functionName: string,
    parameters: any,
    context: any
  ): string {
    return `
      (function() {
        'use strict';
        
        // Setup module system
        const modules = {};
        const require = function(name) {
          if (modules[name]) {
            return modules[name].exports;
          }
          
          if (__MODULES__ && __MODULES__[name]) {
            return __MODULES__[name];
          }
          
          throw new Error('Module not found: ' + name);
        };
        
        // Load plugin files
        const loadModule = function(filename) {
          if (!__PLUGIN_FILES__[filename]) {
            throw new Error('File not found: ' + filename);
          }
          
          const module = { exports: {} };
          modules[filename] = module;
          
          const code = __PLUGIN_FILES__[filename];
          const wrappedCode = '(function(module, exports, require, __PLUGIN_CONTEXT__) {\\n' + code + '\\n})';
          
          try {
            const fn = eval(wrappedCode);
            fn(module, module.exports, require, __PLUGIN_CONTEXT__);
            return module.exports;
          } catch (error) {
            delete modules[filename];
            throw error;
          }
        };
        
        // Load entry point
        const pluginModule = loadModule('${entryPoint}');
        
        // Execute function
        if (typeof pluginModule['${functionName}'] !== 'function') {
          throw new Error('Function not found: ${functionName}');
        }
        
        const parameters = ${JSON.stringify(parameters)};
        return pluginModule['${functionName}'](parameters);
      })();
    `;
  }

  private isSafeModule(moduleName: string): boolean {
    const safeModules = [
      'crypto',
      'util',
      'querystring',
      'url',
      'path',
      'lodash',
      'moment',
      'uuid',
      'semver'
    ];

    return safeModules.includes(moduleName);
  }

  private checkSecurityPatterns(code: string, issues: Array<{
    type: 'error' | 'warning';
    message: string;
    line?: number;
    column?: number;
  }>): void {
    // Check for dangerous patterns
    const dangerousPatterns = [
      { pattern: /eval\s*\(/, message: 'Use of eval() is not allowed' },
      { pattern: /Function\s*\(/, message: 'Use of Function constructor is not allowed' },
      { pattern: /process\./g, message: 'Access to process object is not allowed' },
      { pattern: /require\s*\(\s*['"]child_process['"]/, message: 'Child process module is not allowed' },
      { pattern: /require\s*\(\s*['"]fs['"]/, message: 'File system module is not allowed without permission' },
      { pattern: /require\s*\(\s*['"]net['"]/, message: 'Network module is not allowed without permission' },
      { pattern: /require\s*\(\s*['"]http['"]/, message: 'HTTP module is not allowed without permission' },
      { pattern: /require\s*\(\s*['"]https['"]/, message: 'HTTPS module is not allowed without permission' },
      { pattern: /__proto__/, message: 'Prototype pollution attempts are not allowed' },
      { pattern: /constructor\s*\.\s*constructor/, message: 'Constructor access is not allowed' }
    ];

    for (const { pattern, message } of dangerousPatterns) {
      if (pattern.test(code)) {
        issues.push({
          type: 'error',
          message
        });
      }
    }

    // Check for suspicious patterns (warnings)
    const suspiciousPatterns = [
      { pattern: /while\s*\(\s*true\s*\)/, message: 'Infinite loop detected' },
      { pattern: /for\s*\(\s*;\s*;\s*\)/, message: 'Infinite loop detected' },
      { pattern: /setInterval/, message: 'setInterval usage should be carefully reviewed' }
    ];

    for (const { pattern, message } of suspiciousPatterns) {
      if (pattern.test(code)) {
        issues.push({
          type: 'warning',
          message
        });
      }
    }
  }
}
