/**
 * Plugin Sandbox Port
 * 
 * Defines the interface for secure plugin execution environments.
 * Implementations provide isolated execution contexts with resource
 * limits and security constraints.
 */

import { PluginExecutionContext, PluginExecutionResult } from '../../domain/entities/Plugin';

export interface SandboxConfig {
  memoryLimit: number; // Memory limit in bytes
  cpuLimit: number; // CPU limit as percentage
  timeout: number; // Execution timeout in milliseconds
  allowedModules: string[]; // Allowed Node.js modules
  networkAccess: boolean; // Allow network access
  fileSystemAccess: boolean; // Allow file system access
  trustedDomains: string[]; // Allowed network domains
}

export interface SandboxExecutionRequest {
  files: Map<string, string>; // Plugin files (filename -> content)
  entryPoint: string; // Main plugin file
  functionName: string; // Function to execute
  parameters: any; // Function parameters
  context: PluginExecutionContext; // Execution context
  config: SandboxConfig; // Sandbox configuration
}

export interface PluginSandbox {
  /**
   * Execute plugin code in isolated sandbox
   */
  execute(request: SandboxExecutionRequest): Promise<PluginExecutionResult>;

  /**
   * Validate plugin code for security issues
   */
  validateCode(code: string): Promise<{
    isValid: boolean;
    issues: Array<{
      type: 'error' | 'warning';
      message: string;
      line?: number;
      column?: number;
    }>;
  }>;

  /**
   * Get sandbox resource usage
   */
  getResourceUsage(): Promise<{
    memoryUsed: number;
    cpuUsed: number;
    activeExecutions: number;
  }>;

  /**
   * Terminate running execution
   */
  terminate(executionId: string): Promise<void>;

  /**
   * Clean up sandbox resources
   */
  cleanup(): Promise<void>;
}
