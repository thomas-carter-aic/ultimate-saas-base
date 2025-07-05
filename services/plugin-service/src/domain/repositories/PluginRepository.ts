/**
 * Plugin Repository Interface
 * 
 * Defines the contract for plugin data persistence operations.
 * Follows the Repository pattern from Domain-Driven Design,
 * allowing the domain layer to remain independent of infrastructure concerns.
 */

import { Plugin, PluginStatus } from '../entities/Plugin';

export interface PluginFilters {
  status?: PluginStatus | PluginStatus[];
  category?: string;
  author?: string;
  tenantId?: string;
  name?: string;
  version?: string;
  tags?: string[];
  search?: string;
  isHealthy?: boolean;
}

export interface PluginPagination {
  page: number;
  limit: number;
}

export interface PluginSorting {
  field: 'name' | 'version' | 'createdAt' | 'updatedAt' | 'executionCount' | 'errorRate';
  direction: 'asc' | 'desc';
}

export interface PluginQueryOptions {
  filters?: PluginFilters;
  pagination?: PluginPagination;
  sorting?: PluginSorting;
}

export interface PluginRepository {
  /**
   * Save a new plugin
   */
  save(plugin: Plugin): Promise<Plugin>;

  /**
   * Find plugin by ID
   */
  findById(id: string): Promise<Plugin | null>;

  /**
   * Find plugin by name and version
   */
  findByNameAndVersion(name: string, version: string, tenantId?: string): Promise<Plugin | null>;

  /**
   * Find plugins by tenant ID
   */
  findByTenantId(tenantId: string): Promise<Plugin[]>;

  /**
   * Find plugins with filters, pagination, and sorting
   */
  findWithFilters(options: PluginQueryOptions): Promise<Plugin[]>;

  /**
   * Count plugins with filters
   */
  countWithFilters(filters?: PluginFilters): Promise<number>;

  /**
   * Update an existing plugin
   */
  update(plugin: Plugin): Promise<Plugin>;

  /**
   * Delete a plugin
   */
  delete(id: string): Promise<void>;

  /**
   * Find plugins by status
   */
  findByStatus(status: PluginStatus | PluginStatus[], tenantId?: string): Promise<Plugin[]>;

  /**
   * Find plugins by category
   */
  findByCategory(category: string, tenantId?: string): Promise<Plugin[]>;

  /**
   * Find plugins that depend on a specific plugin
   */
  findDependents(pluginName: string, tenantId?: string): Promise<Plugin[]>;

  /**
   * Find plugins with specific permissions
   */
  findByPermissions(permissions: string[], tenantId?: string): Promise<Plugin[]>;

  /**
   * Get plugin execution statistics
   */
  getExecutionStats(pluginId: string, timeRange?: {
    start: Date;
    end: Date;
  }): Promise<{
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    executionsByHour: Array<{
      hour: string;
      count: number;
      averageTime: number;
    }>;
  }>;

  /**
   * Get tenant plugin usage summary
   */
  getTenantUsageSummary(tenantId: string): Promise<{
    totalPlugins: number;
    activePlugins: number;
    pluginsByCategory: Array<{
      category: string;
      count: number;
    }>;
    pluginsByStatus: Array<{
      status: PluginStatus;
      count: number;
    }>;
    totalExecutions: number;
    averageErrorRate: number;
  }>;

  /**
   * Find plugins requiring updates
   */
  findRequiringUpdates(tenantId?: string): Promise<Array<{
    plugin: Plugin;
    availableVersion: string;
    updateType: 'major' | 'minor' | 'patch';
  }>>;

  /**
   * Get plugin health report
   */
  getHealthReport(tenantId?: string): Promise<Array<{
    plugin: Plugin;
    healthScore: number;
    issues: string[];
    recommendations: string[];
  }>>;

  /**
   * Archive old plugin versions
   */
  archiveOldVersions(keepVersions: number): Promise<number>;

  /**
   * Bulk update plugin status
   */
  bulkUpdateStatus(pluginIds: string[], status: PluginStatus): Promise<void>;

  /**
   * Find plugins by execution frequency
   */
  findByExecutionFrequency(
    frequency: 'high' | 'medium' | 'low' | 'unused',
    tenantId?: string
  ): Promise<Plugin[]>;

  /**
   * Get plugin dependency graph
   */
  getDependencyGraph(tenantId: string): Promise<{
    nodes: Array<{
      id: string;
      name: string;
      version: string;
      status: PluginStatus;
    }>;
    edges: Array<{
      from: string;
      to: string;
      type: 'depends' | 'conflicts';
    }>;
  }>;

  /**
   * Find conflicting plugins
   */
  findConflicts(plugin: Plugin): Promise<Array<{
    conflictingPlugin: Plugin;
    conflictType: 'version' | 'permission' | 'resource' | 'api';
    description: string;
  }>>;

  /**
   * Get plugin marketplace data
   */
  getMarketplaceData(tenantId?: string): Promise<{
    featured: Plugin[];
    popular: Plugin[];
    recent: Plugin[];
    categories: Array<{
      name: string;
      count: number;
      plugins: Plugin[];
    }>;
  }>;

  /**
   * Record plugin execution
   */
  recordExecution(pluginId: string, execution: {
    success: boolean;
    executionTime: number;
    memoryUsed: number;
    cpuUsed: number;
    error?: string;
    logs?: string[];
  }): Promise<void>;

  /**
   * Get plugin logs
   */
  getPluginLogs(pluginId: string, options?: {
    level?: 'error' | 'warn' | 'info' | 'debug';
    limit?: number;
    offset?: number;
    startDate?: Date;
    endDate?: Date;
  }): Promise<Array<{
    timestamp: Date;
    level: string;
    message: string;
    metadata?: any;
  }>>;

  /**
   * Clean up plugin data
   */
  cleanup(options: {
    removeUnusedPlugins?: boolean;
    removeOldLogs?: boolean;
    removeOldExecutions?: boolean;
    olderThanDays?: number;
  }): Promise<{
    pluginsRemoved: number;
    logsRemoved: number;
    executionsRemoved: number;
  }>;
}
