/**
 * PostgreSQL Plugin Repository Implementation
 * 
 * Implements plugin data persistence using PostgreSQL with JSONB optimization.
 * Provides efficient queries for plugin management, filtering, and analytics.
 */

import { Pool, PoolClient } from 'pg';
import { Plugin, PluginStatus } from '../../domain/entities/Plugin';
import { PluginRepository, PluginFilters, PluginQueryOptions } from '../../domain/repositories/PluginRepository';
import { Logger } from '../../application/ports/Logger';

export class PostgreSQLPluginRepository implements PluginRepository {
  constructor(
    private pool: Pool,
    private logger: Logger
  ) {}

  async save(plugin: Plugin): Promise<Plugin> {
    const client = await this.pool.connect();
    
    try {
      const query = `
        INSERT INTO plugins (
          id, manifest, status, tenant_id, uploaded_by, configuration,
          created_at, updated_at, installed_at, last_executed_at,
          execution_count, error_count, average_execution_time
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        RETURNING *
      `;

      const values = [
        plugin.id,
        JSON.stringify(plugin.manifest),
        plugin.status,
        plugin.tenantId,
        plugin.uploadedBy,
        JSON.stringify(plugin.configuration),
        plugin.createdAt,
        plugin.updatedAt,
        plugin.installedAt,
        plugin.lastExecutedAt,
        plugin.executionCount,
        plugin.errorCount,
        plugin.averageExecutionTime
      ];

      const result = await client.query(query, values);
      return this.mapRowToPlugin(result.rows[0]);

    } catch (error) {
      this.logger.error('Error saving plugin', error as Error, { pluginId: plugin.id });
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<Plugin | null> {
    const client = await this.pool.connect();
    
    try {
      const query = 'SELECT * FROM plugins WHERE id = $1';
      const result = await client.query(query, [id]);
      
      return result.rows.length > 0 ? this.mapRowToPlugin(result.rows[0]) : null;

    } catch (error) {
      this.logger.error('Error finding plugin by ID', error as Error, { pluginId: id });
      throw error;
    } finally {
      client.release();
    }
  }

  async findByNameAndVersion(name: string, version: string, tenantId?: string): Promise<Plugin | null> {
    const client = await this.pool.connect();
    
    try {
      let query = `
        SELECT * FROM plugins 
        WHERE manifest->>'metadata'->>'name' = $1 
        AND manifest->>'metadata'->>'version' = $2
      `;
      const params = [name, version];

      if (tenantId) {
        query += ' AND tenant_id = $3';
        params.push(tenantId);
      }

      const result = await client.query(query, params);
      return result.rows.length > 0 ? this.mapRowToPlugin(result.rows[0]) : null;

    } catch (error) {
      this.logger.error('Error finding plugin by name and version', error as Error, { name, version, tenantId });
      throw error;
    } finally {
      client.release();
    }
  }

  async findByTenantId(tenantId: string): Promise<Plugin[]> {
    const client = await this.pool.connect();
    
    try {
      const query = 'SELECT * FROM plugins WHERE tenant_id = $1 ORDER BY created_at DESC';
      const result = await client.query(query, [tenantId]);
      
      return result.rows.map(row => this.mapRowToPlugin(row));

    } catch (error) {
      this.logger.error('Error finding plugins by tenant ID', error as Error, { tenantId });
      throw error;
    } finally {
      client.release();
    }
  }

  async findWithFilters(options: PluginQueryOptions): Promise<Plugin[]> {
    const client = await this.pool.connect();
    
    try {
      let query = 'SELECT * FROM plugins WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      // Apply filters
      if (options.filters) {
        const { filters } = options;

        if (filters.tenantId) {
          query += ` AND tenant_id = $${paramIndex}`;
          params.push(filters.tenantId);
          paramIndex++;
        }

        if (filters.status) {
          if (Array.isArray(filters.status)) {
            query += ` AND status = ANY($${paramIndex})`;
            params.push(filters.status);
          } else {
            query += ` AND status = $${paramIndex}`;
            params.push(filters.status);
          }
          paramIndex++;
        }

        if (filters.category) {
          query += ` AND manifest->'metadata'->>'category' = $${paramIndex}`;
          params.push(filters.category);
          paramIndex++;
        }

        if (filters.author) {
          query += ` AND manifest->'metadata'->>'author' = $${paramIndex}`;
          params.push(filters.author);
          paramIndex++;
        }

        if (filters.name) {
          query += ` AND manifest->'metadata'->>'name' ILIKE $${paramIndex}`;
          params.push(`%${filters.name}%`);
          paramIndex++;
        }

        if (filters.search) {
          query += ` AND (
            manifest->'metadata'->>'name' ILIKE $${paramIndex} OR
            manifest->'metadata'->>'description' ILIKE $${paramIndex} OR
            manifest->'metadata'->>'author' ILIKE $${paramIndex}
          )`;
          params.push(`%${filters.search}%`);
          paramIndex++;
        }

        if (filters.tags && filters.tags.length > 0) {
          query += ` AND manifest->'metadata'->'tags' ?| $${paramIndex}`;
          params.push(filters.tags);
          paramIndex++;
        }
      }

      // Apply sorting
      if (options.sorting) {
        const sortField = this.mapSortField(options.sorting.field);
        query += ` ORDER BY ${sortField} ${options.sorting.direction.toUpperCase()}`;
      } else {
        query += ' ORDER BY created_at DESC';
      }

      // Apply pagination
      if (options.pagination) {
        const offset = (options.pagination.page - 1) * options.pagination.limit;
        query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(options.pagination.limit, offset);
      }

      const result = await client.query(query, params);
      return result.rows.map(row => this.mapRowToPlugin(row));

    } catch (error) {
      this.logger.error('Error finding plugins with filters', error as Error, { options });
      throw error;
    } finally {
      client.release();
    }
  }

  async countWithFilters(filters?: PluginFilters): Promise<number> {
    const client = await this.pool.connect();
    
    try {
      let query = 'SELECT COUNT(*) FROM plugins WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      if (filters) {
        if (filters.tenantId) {
          query += ` AND tenant_id = $${paramIndex}`;
          params.push(filters.tenantId);
          paramIndex++;
        }

        if (filters.status) {
          if (Array.isArray(filters.status)) {
            query += ` AND status = ANY($${paramIndex})`;
            params.push(filters.status);
          } else {
            query += ` AND status = $${paramIndex}`;
            params.push(filters.status);
          }
          paramIndex++;
        }

        if (filters.category) {
          query += ` AND manifest->'metadata'->>'category' = $${paramIndex}`;
          params.push(filters.category);
          paramIndex++;
        }

        if (filters.search) {
          query += ` AND (
            manifest->'metadata'->>'name' ILIKE $${paramIndex} OR
            manifest->'metadata'->>'description' ILIKE $${paramIndex} OR
            manifest->'metadata'->>'author' ILIKE $${paramIndex}
          )`;
          params.push(`%${filters.search}%`);
          paramIndex++;
        }
      }

      const result = await client.query(query, params);
      return parseInt(result.rows[0].count);

    } catch (error) {
      this.logger.error('Error counting plugins with filters', error as Error, { filters });
      throw error;
    } finally {
      client.release();
    }
  }

  async update(plugin: Plugin): Promise<Plugin> {
    const client = await this.pool.connect();
    
    try {
      const query = `
        UPDATE plugins SET
          manifest = $2,
          status = $3,
          configuration = $4,
          updated_at = $5,
          installed_at = $6,
          last_executed_at = $7,
          execution_count = $8,
          error_count = $9,
          average_execution_time = $10
        WHERE id = $1
        RETURNING *
      `;

      const values = [
        plugin.id,
        JSON.stringify(plugin.manifest),
        plugin.status,
        JSON.stringify(plugin.configuration),
        plugin.updatedAt,
        plugin.installedAt,
        plugin.lastExecutedAt,
        plugin.executionCount,
        plugin.errorCount,
        plugin.averageExecutionTime
      ];

      const result = await client.query(query, values);
      
      if (result.rows.length === 0) {
        throw new Error(`Plugin not found: ${plugin.id}`);
      }

      return this.mapRowToPlugin(result.rows[0]);

    } catch (error) {
      this.logger.error('Error updating plugin', error as Error, { pluginId: plugin.id });
      throw error;
    } finally {
      client.release();
    }
  }

  async delete(id: string): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      const query = 'DELETE FROM plugins WHERE id = $1';
      const result = await client.query(query, [id]);
      
      if (result.rowCount === 0) {
        throw new Error(`Plugin not found: ${id}`);
      }

    } catch (error) {
      this.logger.error('Error deleting plugin', error as Error, { pluginId: id });
      throw error;
    } finally {
      client.release();
    }
  }

  async findByStatus(status: PluginStatus | PluginStatus[], tenantId?: string): Promise<Plugin[]> {
    const client = await this.pool.connect();
    
    try {
      let query = 'SELECT * FROM plugins WHERE ';
      const params: any[] = [];

      if (Array.isArray(status)) {
        query += 'status = ANY($1)';
        params.push(status);
      } else {
        query += 'status = $1';
        params.push(status);
      }

      if (tenantId) {
        query += ' AND tenant_id = $2';
        params.push(tenantId);
      }

      query += ' ORDER BY created_at DESC';

      const result = await client.query(query, params);
      return result.rows.map(row => this.mapRowToPlugin(row));

    } catch (error) {
      this.logger.error('Error finding plugins by status', error as Error, { status, tenantId });
      throw error;
    } finally {
      client.release();
    }
  }

  async findByCategory(category: string, tenantId?: string): Promise<Plugin[]> {
    const client = await this.pool.connect();
    
    try {
      let query = `SELECT * FROM plugins WHERE manifest->'metadata'->>'category' = $1`;
      const params = [category];

      if (tenantId) {
        query += ' AND tenant_id = $2';
        params.push(tenantId);
      }

      query += ' ORDER BY created_at DESC';

      const result = await client.query(query, params);
      return result.rows.map(row => this.mapRowToPlugin(row));

    } catch (error) {
      this.logger.error('Error finding plugins by category', error as Error, { category, tenantId });
      throw error;
    } finally {
      client.release();
    }
  }

  async findDependents(pluginName: string, tenantId?: string): Promise<Plugin[]> {
    const client = await this.pool.connect();
    
    try {
      let query = `
        SELECT * FROM plugins 
        WHERE manifest->'dependencies'->'plugins' ? $1
      `;
      const params = [pluginName];

      if (tenantId) {
        query += ' AND tenant_id = $2';
        params.push(tenantId);
      }

      const result = await client.query(query, params);
      return result.rows.map(row => this.mapRowToPlugin(row));

    } catch (error) {
      this.logger.error('Error finding plugin dependents', error as Error, { pluginName, tenantId });
      throw error;
    } finally {
      client.release();
    }
  }

  async findByPermissions(permissions: string[], tenantId?: string): Promise<Plugin[]> {
    const client = await this.pool.connect();
    
    try {
      let query = `
        SELECT * FROM plugins 
        WHERE manifest->'security'->'permissions' ?| $1
      `;
      const params = [permissions];

      if (tenantId) {
        query += ' AND tenant_id = $2';
        params.push(tenantId);
      }

      const result = await client.query(query, params);
      return result.rows.map(row => this.mapRowToPlugin(row));

    } catch (error) {
      this.logger.error('Error finding plugins by permissions', error as Error, { permissions, tenantId });
      throw error;
    } finally {
      client.release();
    }
  }

  // Placeholder implementations for complex methods
  async getExecutionStats(pluginId: string, timeRange?: { start: Date; end: Date }): Promise<any> {
    // This would query plugin_executions table
    return {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      executionsByHour: []
    };
  }

  async getTenantUsageSummary(tenantId: string): Promise<any> {
    // This would aggregate plugin usage data
    return {
      totalPlugins: 0,
      activePlugins: 0,
      pluginsByCategory: [],
      pluginsByStatus: [],
      totalExecutions: 0,
      averageErrorRate: 0
    };
  }

  async findRequiringUpdates(tenantId?: string): Promise<any[]> {
    // This would check for available updates
    return [];
  }

  async getHealthReport(tenantId?: string): Promise<any[]> {
    // This would analyze plugin health
    return [];
  }

  async archiveOldVersions(keepVersions: number): Promise<number> {
    // This would archive old plugin versions
    return 0;
  }

  async bulkUpdateStatus(pluginIds: string[], status: PluginStatus): Promise<void> {
    const client = await this.pool.connect();
    
    try {
      const query = 'UPDATE plugins SET status = $1, updated_at = NOW() WHERE id = ANY($2)';
      await client.query(query, [status, pluginIds]);

    } catch (error) {
      this.logger.error('Error bulk updating plugin status', error as Error, { pluginIds, status });
      throw error;
    } finally {
      client.release();
    }
  }

  async findByExecutionFrequency(frequency: 'high' | 'medium' | 'low' | 'unused', tenantId?: string): Promise<Plugin[]> {
    // This would analyze execution frequency
    return [];
  }

  async getDependencyGraph(tenantId: string): Promise<any> {
    // This would build dependency graph
    return { nodes: [], edges: [] };
  }

  async findConflicts(plugin: Plugin): Promise<any[]> {
    // This would check for conflicts
    return [];
  }

  async getMarketplaceData(tenantId?: string): Promise<any> {
    // This would provide marketplace data
    return {
      featured: [],
      popular: [],
      recent: [],
      categories: []
    };
  }

  async recordExecution(pluginId: string, execution: any): Promise<void> {
    // This would record execution in plugin_executions table
    this.logger.info('Plugin execution recorded', { pluginId, execution });
  }

  async getPluginLogs(pluginId: string, options?: any): Promise<any[]> {
    // This would query plugin_logs table
    return [];
  }

  async cleanup(options: any): Promise<any> {
    // This would clean up old data
    return {
      pluginsRemoved: 0,
      logsRemoved: 0,
      executionsRemoved: 0
    };
  }

  private mapRowToPlugin(row: any): Plugin {
    return new Plugin(
      row.id,
      JSON.parse(row.manifest),
      row.status,
      row.tenant_id,
      row.uploaded_by,
      JSON.parse(row.configuration || '{}'),
      row.created_at,
      row.updated_at,
      row.installed_at,
      row.last_executed_at,
      row.execution_count || 0,
      row.error_count || 0,
      row.average_execution_time || 0
    );
  }

  private mapSortField(field: string): string {
    const fieldMap: Record<string, string> = {
      'name': "manifest->'metadata'->>'name'",
      'version': "manifest->'metadata'->>'version'",
      'createdAt': 'created_at',
      'updatedAt': 'updated_at',
      'executionCount': 'execution_count',
      'errorRate': '(CASE WHEN execution_count > 0 THEN error_count::float / execution_count ELSE 0 END)'
    };

    return fieldMap[field] || 'created_at';
  }
}
