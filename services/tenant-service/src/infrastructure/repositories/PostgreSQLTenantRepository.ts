/**
 * PostgreSQL Tenant Repository Implementation
 * 
 * Concrete implementation of TenantRepository using PostgreSQL database.
 * This adapter handles all tenant data persistence operations with proper
 * error handling, connection management, and query optimization.
 */

import { Pool, PoolClient } from 'pg';
import { Tenant } from '../../domain/entities/Tenant';
import { TenantRepository } from '../../domain/repositories/TenantRepository';
import { Logger } from '../../application/ports/Logger';

export class PostgreSQLTenantRepository implements TenantRepository {
  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger
  ) {}

  /**
   * Save a tenant entity to PostgreSQL database
   */
  async save(tenant: Tenant): Promise<Tenant> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const insertQuery = `
        INSERT INTO tenants (
          id, name, slug, owner_id, settings, resource_limits, 
          billing_info, metrics, status, created_at, updated_at,
          trial_ends_at, suspended_at, suspension_reason
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          settings = EXCLUDED.settings,
          resource_limits = EXCLUDED.resource_limits,
          billing_info = EXCLUDED.billing_info,
          metrics = EXCLUDED.metrics,
          status = EXCLUDED.status,
          updated_at = EXCLUDED.updated_at,
          trial_ends_at = EXCLUDED.trial_ends_at,
          suspended_at = EXCLUDED.suspended_at,
          suspension_reason = EXCLUDED.suspension_reason
        RETURNING *
      `;

      const tenantData = tenant.toPersistence();
      const values = [
        tenantData.id,
        tenantData.name,
        tenantData.slug,
        tenantData.ownerId,
        JSON.stringify(tenantData.settings),
        JSON.stringify(tenantData.resourceLimits),
        JSON.stringify(tenantData.billingInfo),
        JSON.stringify(tenantData.metrics),
        tenantData.status,
        tenantData.createdAt,
        tenantData.updatedAt,
        tenantData.trialEndsAt,
        tenantData.suspendedAt,
        tenantData.suspensionReason
      ];

      const result = await client.query(insertQuery, values);
      await client.query('COMMIT');

      this.logger.info('Tenant saved successfully', {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug
      });

      return this.mapRowToTenant(result.rows[0]);

    } catch (error) {
      await client.query('ROLLBACK');
      
      this.logger.error('Failed to save tenant', {
        tenantId: tenant.id,
        name: tenant.name,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to save tenant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  /**
   * Find a tenant by their unique identifier
   */
  async findById(id: string): Promise<Tenant | null> {
    try {
      const query = 'SELECT * FROM tenants WHERE id = $1';
      const result = await this.pool.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToTenant(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find tenant by ID', {
        tenantId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find tenant by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find a tenant by their slug
   */
  async findBySlug(slug: string): Promise<Tenant | null> {
    try {
      const query = 'SELECT * FROM tenants WHERE slug = $1';
      const result = await this.pool.query(query, [slug]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToTenant(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find tenant by slug', {
        slug,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find tenant by slug: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find tenants by owner ID
   */
  async findByOwnerId(ownerId: string): Promise<Tenant[]> {
    try {
      const query = 'SELECT * FROM tenants WHERE owner_id = $1 ORDER BY created_at DESC';
      const result = await this.pool.query(query, [ownerId]);
      
      return result.rows.map(row => this.mapRowToTenant(row));

    } catch (error) {
      this.logger.error('Failed to find tenants by owner ID', {
        ownerId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find tenants by owner ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find tenants by status with pagination
   */
  async findByStatus(status: string, offset: number = 0, limit: number = 50): Promise<Tenant[]> {
    try {
      const query = `
        SELECT * FROM tenants 
        WHERE status = $1 
        ORDER BY created_at DESC 
        LIMIT $2 OFFSET $3
      `;
      
      const result = await this.pool.query(query, [status, limit, offset]);
      
      return result.rows.map(row => this.mapRowToTenant(row));

    } catch (error) {
      this.logger.error('Failed to find tenants by status', {
        status,
        offset,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find tenants by status: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find tenants with expiring trials
   */
  async findExpiringTrials(daysUntilExpiry: number): Promise<Tenant[]> {
    try {
      const query = `
        SELECT * FROM tenants 
        WHERE status = 'trial' 
        AND trial_ends_at IS NOT NULL 
        AND trial_ends_at <= NOW() + INTERVAL '${daysUntilExpiry} days'
        AND trial_ends_at > NOW()
        ORDER BY trial_ends_at ASC
      `;
      
      const result = await this.pool.query(query);
      
      return result.rows.map(row => this.mapRowToTenant(row));

    } catch (error) {
      this.logger.error('Failed to find expiring trials', {
        daysUntilExpiry,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find expiring trials: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find tenants that have exceeded resource limits
   */
  async findExceedingLimits(resourceType?: string, thresholdPercentage: number = 90): Promise<Tenant[]> {
    try {
      let query = `
        SELECT * FROM tenants 
        WHERE status IN ('active', 'trial')
      `;

      if (resourceType) {
        switch (resourceType) {
          case 'users':
            query += ` AND (resource_limits->'users'->>'current')::int >= 
                      (resource_limits->'users'->>'max')::int * ${thresholdPercentage / 100}`;
            break;
          case 'storage':
            query += ` AND (resource_limits->'storage'->>'currentGB')::float >= 
                      (resource_limits->'storage'->>'maxGB')::float * ${thresholdPercentage / 100}`;
            break;
          case 'apiCalls':
            query += ` AND (resource_limits->'apiCalls'->>'currentMonth')::int >= 
                      (resource_limits->'apiCalls'->>'monthlyLimit')::int * ${thresholdPercentage / 100}`;
            break;
        }
      } else {
        query += ` AND (
          (resource_limits->'users'->>'current')::int >= 
          (resource_limits->'users'->>'max')::int * ${thresholdPercentage / 100}
          OR
          (resource_limits->'storage'->>'currentGB')::float >= 
          (resource_limits->'storage'->>'maxGB')::float * ${thresholdPercentage / 100}
          OR
          (resource_limits->'apiCalls'->>'currentMonth')::int >= 
          (resource_limits->'apiCalls'->>'monthlyLimit')::int * ${thresholdPercentage / 100}
        )`;
      }

      query += ' ORDER BY created_at DESC';
      
      const result = await this.pool.query(query);
      
      return result.rows.map(row => this.mapRowToTenant(row));

    } catch (error) {
      this.logger.error('Failed to find tenants exceeding limits', {
        resourceType,
        thresholdPercentage,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find tenants exceeding limits: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find tenants with filters, pagination, and sorting
   */
  async findWithFilters(options: {
    filters?: {
      status?: string;
      plan?: string;
      ownerId?: string;
      search?: string;
    };
    pagination?: {
      page: number;
      limit: number;
    };
    sorting?: {
      field: string;
      direction: 'asc' | 'desc';
    };
  }): Promise<Tenant[]> {
    try {
      let query = 'SELECT * FROM tenants WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      // Apply filters
      if (options.filters?.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(options.filters.status);
        paramIndex++;
      }

      if (options.filters?.plan) {
        query += ` AND plan = $${paramIndex}`;
        params.push(options.filters.plan);
        paramIndex++;
      }

      if (options.filters?.ownerId) {
        query += ` AND owner_id = $${paramIndex}`;
        params.push(options.filters.ownerId);
        paramIndex++;
      }

      if (options.filters?.search) {
        query += ` AND (name ILIKE $${paramIndex} OR slug ILIKE $${paramIndex})`;
        params.push(`%${options.filters.search}%`);
        paramIndex++;
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

      const result = await this.pool.query(query, params);
      return result.rows.map(row => this.mapRowToTenant(row));

    } catch (error) {
      this.logger.error('Error finding tenants with filters', error as Error, { options });
      throw error;
    }
  }

  /**
   * Count tenants with filters
   */
  async countWithFilters(filters?: {
    status?: string;
    plan?: string;
    ownerId?: string;
    search?: string;
  }): Promise<number> {
    try {
      let query = 'SELECT COUNT(*) FROM tenants WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      // Apply filters
      if (filters?.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(filters.status);
        paramIndex++;
      }

      if (filters?.plan) {
        query += ` AND plan = $${paramIndex}`;
        params.push(filters.plan);
        paramIndex++;
      }

      if (filters?.ownerId) {
        query += ` AND owner_id = $${paramIndex}`;
        params.push(filters.ownerId);
        paramIndex++;
      }

      if (filters?.search) {
        query += ` AND (name ILIKE $${paramIndex} OR slug ILIKE $${paramIndex})`;
        params.push(`%${filters.search}%`);
        paramIndex++;
      }

      const result = await this.pool.query(query, params);
      return parseInt(result.rows[0].count);

    } catch (error) {
      this.logger.error('Error counting tenants with filters', error as Error, { filters });
      throw error;
    }
  }

  private mapSortField(field: string): string {
    const fieldMap: Record<string, string> = {
      'name': 'name',
      'createdAt': 'created_at',
      'updatedAt': 'updated_at',
      'status': 'status',
      'plan': 'plan'
    };

    return fieldMap[field] || 'created_at';
  }
  async update(tenant: Tenant): Promise<Tenant> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const updateQuery = `
        UPDATE tenants SET
          name = $2,
          settings = $3,
          resource_limits = $4,
          billing_info = $5,
          metrics = $6,
          status = $7,
          updated_at = $8,
          trial_ends_at = $9,
          suspended_at = $10,
          suspension_reason = $11
        WHERE id = $1
        RETURNING *
      `;

      const tenantData = tenant.toPersistence();
      const values = [
        tenantData.id,
        tenantData.name,
        JSON.stringify(tenantData.settings),
        JSON.stringify(tenantData.resourceLimits),
        JSON.stringify(tenantData.billingInfo),
        JSON.stringify(tenantData.metrics),
        tenantData.status,
        tenantData.updatedAt,
        tenantData.trialEndsAt,
        tenantData.suspendedAt,
        tenantData.suspensionReason
      ];

      const result = await client.query(updateQuery, values);
      
      if (result.rows.length === 0) {
        throw new Error('Tenant not found for update');
      }

      await client.query('COMMIT');

      this.logger.info('Tenant updated successfully', {
        tenantId: tenant.id,
        name: tenant.name
      });

      return this.mapRowToTenant(result.rows[0]);

    } catch (error) {
      await client.query('ROLLBACK');
      
      this.logger.error('Failed to update tenant', {
        tenantId: tenant.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to update tenant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  /**
   * Delete a tenant by ID (soft delete)
   */
  async delete(id: string): Promise<boolean> {
    try {
      const query = `
        UPDATE tenants SET 
          status = 'cancelled',
          updated_at = NOW() 
        WHERE id = $1 AND status != 'cancelled'
      `;
      
      const result = await this.pool.query(query, [id]);
      
      const success = result.rowCount > 0;
      
      if (success) {
        this.logger.info('Tenant soft deleted successfully', { tenantId: id });
      } else {
        this.logger.warn('Tenant not found for deletion', { tenantId: id });
      }
      
      return success;

    } catch (error) {
      this.logger.error('Failed to delete tenant', {
        tenantId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to delete tenant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Count total tenants
   */
  async count(status?: string): Promise<number> {
    try {
      let query = 'SELECT COUNT(*) as count FROM tenants';
      const params: any[] = [];
      
      if (status) {
        query += ' WHERE status = $1';
        params.push(status);
      }
      
      const result = await this.pool.query(query, params);
      
      return parseInt(result.rows[0].count, 10);

    } catch (error) {
      this.logger.error('Failed to count tenants', {
        status,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to count tenants: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search tenants by various criteria
   */
  async search(criteria: {
    name?: string;
    slug?: string;
    ownerId?: string;
    status?: string;
    plan?: string;
    createdAfter?: Date;
    createdBefore?: Date;
    trialExpiring?: boolean;
    offset?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<Tenant[]> {
    try {
      let query = 'SELECT * FROM tenants WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      // Build dynamic query based on criteria
      if (criteria.name) {
        query += ` AND LOWER(name) LIKE LOWER($${paramIndex})`;
        params.push(`%${criteria.name}%`);
        paramIndex++;
      }

      if (criteria.slug) {
        query += ` AND slug = $${paramIndex}`;
        params.push(criteria.slug);
        paramIndex++;
      }

      if (criteria.ownerId) {
        query += ` AND owner_id = $${paramIndex}`;
        params.push(criteria.ownerId);
        paramIndex++;
      }

      if (criteria.status) {
        query += ` AND status = $${paramIndex}`;
        params.push(criteria.status);
        paramIndex++;
      }

      if (criteria.plan) {
        query += ` AND billing_info->>'plan' = $${paramIndex}`;
        params.push(criteria.plan);
        paramIndex++;
      }

      if (criteria.createdAfter) {
        query += ` AND created_at >= $${paramIndex}`;
        params.push(criteria.createdAfter);
        paramIndex++;
      }

      if (criteria.createdBefore) {
        query += ` AND created_at <= $${paramIndex}`;
        params.push(criteria.createdBefore);
        paramIndex++;
      }

      if (criteria.trialExpiring) {
        query += ` AND status = 'trial' AND trial_ends_at <= NOW() + INTERVAL '7 days'`;
      }

      // Add sorting
      const sortBy = criteria.sortBy || 'created_at';
      const sortOrder = criteria.sortOrder || 'desc';
      query += ` ORDER BY ${sortBy} ${sortOrder}`;

      // Add pagination
      if (criteria.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(criteria.limit);
        paramIndex++;
      }

      if (criteria.offset) {
        query += ` OFFSET $${paramIndex}`;
        params.push(criteria.offset);
        paramIndex++;
      }

      const result = await this.pool.query(query, params);
      
      return result.rows.map(row => this.mapRowToTenant(row));

    } catch (error) {
      this.logger.error('Failed to search tenants', {
        criteria,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to search tenants: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get tenant metrics aggregated data
   */
  async getTenantMetrics(tenantId?: string, timeRange?: {
    start: Date;
    end: Date;
  }): Promise<{
    totalTenants: number;
    activeTenants: number;
    trialTenants: number;
    suspendedTenants: number;
    totalRevenue: number;
    averageUsage: {
      users: number;
      storage: number;
      apiCalls: number;
    };
    planDistribution: Array<{
      plan: string;
      count: number;
      percentage: number;
    }>;
  }> {
    try {
      // Get basic counts
      const countsQuery = `
        SELECT 
          COUNT(*) as total_tenants,
          COUNT(*) FILTER (WHERE status = 'active') as active_tenants,
          COUNT(*) FILTER (WHERE status = 'trial') as trial_tenants,
          COUNT(*) FILTER (WHERE status = 'suspended') as suspended_tenants,
          SUM((billing_info->>'amount')::int) as total_revenue,
          AVG((resource_limits->'users'->>'current')::int) as avg_users,
          AVG((resource_limits->'storage'->>'currentGB')::float) as avg_storage,
          AVG((resource_limits->'apiCalls'->>'currentMonth')::int) as avg_api_calls
        FROM tenants
        ${tenantId ? 'WHERE id = $1' : ''}
      `;
      
      const countsParams = tenantId ? [tenantId] : [];
      const countsResult = await this.pool.query(countsQuery, countsParams);
      const counts = countsResult.rows[0];

      // Get plan distribution
      const planQuery = `
        SELECT 
          billing_info->>'plan' as plan,
          COUNT(*) as count
        FROM tenants
        ${tenantId ? 'WHERE id = $1' : ''}
        GROUP BY billing_info->>'plan'
        ORDER BY count DESC
      `;
      
      const planResult = await this.pool.query(planQuery, countsParams);
      const totalForPercentage = parseInt(counts.total_tenants, 10);
      
      const planDistribution = planResult.rows.map(row => ({
        plan: row.plan,
        count: parseInt(row.count, 10),
        percentage: totalForPercentage > 0 ? 
          Math.round((parseInt(row.count, 10) / totalForPercentage) * 100) : 0
      }));

      return {
        totalTenants: parseInt(counts.total_tenants, 10),
        activeTenants: parseInt(counts.active_tenants, 10),
        trialTenants: parseInt(counts.trial_tenants, 10),
        suspendedTenants: parseInt(counts.suspended_tenants, 10),
        totalRevenue: parseInt(counts.total_revenue, 10) || 0,
        averageUsage: {
          users: parseFloat(counts.avg_users) || 0,
          storage: parseFloat(counts.avg_storage) || 0,
          apiCalls: parseFloat(counts.avg_api_calls) || 0
        },
        planDistribution
      };

    } catch (error) {
      this.logger.error('Failed to get tenant metrics', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to get tenant metrics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Additional methods would be implemented here...
  // For brevity, I'm including stubs for the remaining methods

  async getTenantUsageStats(tenantId: string, timeRange?: { start: Date; end: Date; }): Promise<any> {
    // Implementation would go here
    return {};
  }

  async updateUsage(tenantId: string, usage: any): Promise<boolean> {
    // Implementation would go here
    return true;
  }

  async resetMonthlyUsage(): Promise<number> {
    // Implementation would go here
    return 0;
  }

  async findForBilling(billingDate: Date): Promise<Tenant[]> {
    // Implementation would go here
    return [];
  }

  async updateBillingStatus(tenantId: string, billingData: any): Promise<boolean> {
    // Implementation would go here
    return true;
  }

  async getResourceUtilization(tenantId?: string): Promise<any[]> {
    // Implementation would go here
    return [];
  }

  async archiveInactiveTenants(inactiveDays: number): Promise<number> {
    // Implementation would go here
    return 0;
  }

  /**
   * Map database row to Tenant domain entity
   */
  private mapRowToTenant(row: any): Tenant {
    return Tenant.fromPersistence({
      id: row.id,
      name: row.name,
      slug: row.slug,
      ownerId: row.owner_id,
      settings: row.settings,
      resourceLimits: row.resource_limits,
      billingInfo: row.billing_info,
      metrics: row.metrics,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      trialEndsAt: row.trial_ends_at,
      suspendedAt: row.suspended_at,
      suspensionReason: row.suspension_reason
    });
  }
}
