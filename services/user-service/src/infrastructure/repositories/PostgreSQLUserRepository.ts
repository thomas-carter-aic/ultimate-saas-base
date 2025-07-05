/**
 * PostgreSQL User Repository Implementation
 * 
 * Concrete implementation of UserRepository using PostgreSQL database.
 * This adapter handles all user data persistence operations with proper
 * error handling, connection management, and query optimization.
 */

import { Pool, PoolClient } from 'pg';
import { User } from '../../domain/entities/User';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { Logger } from '../../application/ports/Logger';

export class PostgreSQLUserRepository implements UserRepository {
  constructor(
    private readonly pool: Pool,
    private readonly logger: Logger
  ) {}

  /**
   * Save a user entity to PostgreSQL database
   * 
   * @param user - User entity to save
   * @returns Promise resolving to the saved user
   */
  async save(user: User): Promise<User> {
    const client = await this.pool.connect();
    
    try {
      // Begin transaction for data consistency
      await client.query('BEGIN');

      // Insert user data with JSONB columns for complex data
      const insertQuery = `
        INSERT INTO users (
          id, email, password_hash, tenant_id, profile, preferences, 
          metrics, created_at, updated_at, is_active, is_verified, roles
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          profile = EXCLUDED.profile,
          preferences = EXCLUDED.preferences,
          metrics = EXCLUDED.metrics,
          updated_at = EXCLUDED.updated_at,
          is_active = EXCLUDED.is_active,
          is_verified = EXCLUDED.is_verified,
          roles = EXCLUDED.roles
        RETURNING *
      `;

      const userData = user.toPersistence();
      const values = [
        userData.id,
        userData.email,
        userData.passwordHash,
        userData.tenantId,
        JSON.stringify(userData.profile),
        JSON.stringify(userData.preferences),
        JSON.stringify(userData.metrics),
        userData.createdAt,
        userData.updatedAt,
        userData.isActive,
        userData.isVerified,
        userData.roles
      ];

      const result = await client.query(insertQuery, values);
      
      // Commit transaction
      await client.query('COMMIT');

      this.logger.info('User saved successfully', {
        userId: user.id,
        email: user.email,
        tenantId: user.tenantId
      });

      // Convert database row back to domain entity
      return this.mapRowToUser(result.rows[0]);

    } catch (error) {
      // Rollback transaction on error
      await client.query('ROLLBACK');
      
      this.logger.error('Failed to save user', {
        userId: user.id,
        email: user.email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to save user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  /**
   * Find a user by their unique identifier
   * 
   * @param id - User ID
   * @returns Promise resolving to user or null if not found
   */
  async findById(id: string): Promise<User | null> {
    try {
      const query = 'SELECT * FROM users WHERE id = $1 AND is_active = true';
      const result = await this.pool.query(query, [id]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToUser(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find user by ID', {
        userId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find user by ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find a user by their email address
   * 
   * @param email - User email
   * @returns Promise resolving to user or null if not found
   */
  async findByEmail(email: string): Promise<User | null> {
    try {
      const query = 'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND is_active = true';
      const result = await this.pool.query(query, [email]);

      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToUser(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find user by email', {
        email,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find user by email: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find users by tenant ID with pagination
   * 
   * @param tenantId - Tenant identifier
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of users
   */
  async findByTenantId(tenantId: string, offset: number = 0, limit: number = 50): Promise<User[]> {
    try {
      const query = `
        SELECT * FROM users 
        WHERE tenant_id = $1 AND is_active = true 
        ORDER BY created_at DESC 
        LIMIT $2 OFFSET $3
      `;
      
      const result = await this.pool.query(query, [tenantId, limit, offset]);
      
      return result.rows.map(row => this.mapRowToUser(row));

    } catch (error) {
      this.logger.error('Failed to find users by tenant ID', {
        tenantId,
        offset,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find users by tenant ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find users by role with pagination
   * 
   * @param role - User role
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of users
   */
  async findByRole(role: string, offset: number = 0, limit: number = 50): Promise<User[]> {
    try {
      const query = `
        SELECT * FROM users 
        WHERE $1 = ANY(roles) AND is_active = true 
        ORDER BY created_at DESC 
        LIMIT $2 OFFSET $3
      `;
      
      const result = await this.pool.query(query, [role, limit, offset]);
      
      return result.rows.map(row => this.mapRowToUser(row));

    } catch (error) {
      this.logger.error('Failed to find users by role', {
        role,
        offset,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find users by role: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find active users for a tenant
   * 
   * @param tenantId - Tenant identifier
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of active users
   */
  async findActiveByTenantId(tenantId: string, offset: number = 0, limit: number = 50): Promise<User[]> {
    try {
      const query = `
        SELECT * FROM users 
        WHERE tenant_id = $1 AND is_active = true AND is_verified = true
        ORDER BY metrics->>'lastLoginAt' DESC NULLS LAST
        LIMIT $2 OFFSET $3
      `;
      
      const result = await this.pool.query(query, [tenantId, limit, offset]);
      
      return result.rows.map(row => this.mapRowToUser(row));

    } catch (error) {
      this.logger.error('Failed to find active users by tenant ID', {
        tenantId,
        offset,
        limit,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find active users by tenant ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Count total users for a tenant
   * 
   * @param tenantId - Tenant identifier
   * @returns Promise resolving to user count
   */
  async countByTenantId(tenantId: string): Promise<number> {
    try {
      const query = 'SELECT COUNT(*) as count FROM users WHERE tenant_id = $1 AND is_active = true';
      const result = await this.pool.query(query, [tenantId]);
      
      return parseInt(result.rows[0].count, 10);

    } catch (error) {
      this.logger.error('Failed to count users by tenant ID', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to count users by tenant ID: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Update user entity
   * 
   * @param user - User entity with updates
   * @returns Promise resolving to updated user
   */
  async update(user: User): Promise<User> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const updateQuery = `
        UPDATE users SET
          email = $2,
          password_hash = $3,
          profile = $4,
          preferences = $5,
          metrics = $6,
          updated_at = $7,
          is_active = $8,
          is_verified = $9,
          roles = $10
        WHERE id = $1
        RETURNING *
      `;

      const userData = user.toPersistence();
      const values = [
        userData.id,
        userData.email,
        userData.passwordHash,
        JSON.stringify(userData.profile),
        JSON.stringify(userData.preferences),
        JSON.stringify(userData.metrics),
        userData.updatedAt,
        userData.isActive,
        userData.isVerified,
        userData.roles
      ];

      const result = await client.query(updateQuery, values);
      
      if (result.rows.length === 0) {
        throw new Error('User not found for update');
      }

      await client.query('COMMIT');

      this.logger.info('User updated successfully', {
        userId: user.id,
        email: user.email
      });

      return this.mapRowToUser(result.rows[0]);

    } catch (error) {
      await client.query('ROLLBACK');
      
      this.logger.error('Failed to update user', {
        userId: user.id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to update user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      client.release();
    }
  }

  /**
   * Delete a user by ID (soft delete)
   * 
   * @param id - User ID
   * @returns Promise resolving to boolean indicating success
   */
  async delete(id: string): Promise<boolean> {
    try {
      const query = `
        UPDATE users SET 
          is_active = false, 
          updated_at = NOW() 
        WHERE id = $1 AND is_active = true
      `;
      
      const result = await this.pool.query(query, [id]);
      
      const success = result.rowCount > 0;
      
      if (success) {
        this.logger.info('User soft deleted successfully', { userId: id });
      } else {
        this.logger.warn('User not found for deletion', { userId: id });
      }
      
      return success;

    } catch (error) {
      this.logger.error('Failed to delete user', {
        userId: id,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to delete user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find users with AI personalization enabled for analytics
   * 
   * @param tenantId - Optional tenant filter
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of users with AI data
   */
  async findUsersForAIAnalytics(tenantId?: string, offset: number = 0, limit: number = 100): Promise<User[]> {
    try {
      let query = `
        SELECT * FROM users 
        WHERE is_active = true 
        AND preferences->>'aiPersonalization'->>'enabled' = 'true'
        AND preferences->>'aiPersonalization'->>'dataCollection' = 'true'
      `;
      
      const params: any[] = [];
      
      if (tenantId) {
        query += ' AND tenant_id = $1';
        params.push(tenantId);
      }
      
      query += ` ORDER BY updated_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limit, offset);
      
      const result = await this.pool.query(query, params);
      
      return result.rows.map(row => this.mapRowToUser(row));

    } catch (error) {
      this.logger.error('Failed to find users for AI analytics', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find users for AI analytics: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find users who haven't logged in for specified days
   * 
   * @param days - Number of days since last login
   * @param tenantId - Optional tenant filter
   * @returns Promise resolving to array of inactive users
   */
  async findInactiveUsers(days: number, tenantId?: string): Promise<User[]> {
    try {
      let query = `
        SELECT * FROM users 
        WHERE is_active = true 
        AND (
          metrics->>'lastLoginAt' IS NULL 
          OR (metrics->>'lastLoginAt')::timestamp < NOW() - INTERVAL '${days} days'
        )
      `;
      
      const params: any[] = [];
      
      if (tenantId) {
        query += ' AND tenant_id = $1';
        params.push(tenantId);
      }
      
      query += ' ORDER BY created_at DESC';
      
      const result = await this.pool.query(query, params);
      
      return result.rows.map(row => this.mapRowToUser(row));

    } catch (error) {
      this.logger.error('Failed to find inactive users', {
        days,
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to find inactive users: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Get user metrics aggregated by tenant
   * 
   * @param tenantId - Tenant identifier
   * @returns Promise resolving to aggregated metrics
   */
  async getUserMetricsByTenant(tenantId: string): Promise<{
    totalUsers: number;
    activeUsers: number;
    verifiedUsers: number;
    averageLoginCount: number;
    averageSessionDuration: number;
    topFeatures: Array<{ feature: string; usage: number }>;
  }> {
    try {
      // Get basic user counts
      const countsQuery = `
        SELECT 
          COUNT(*) as total_users,
          COUNT(*) FILTER (WHERE is_active = true) as active_users,
          COUNT(*) FILTER (WHERE is_verified = true) as verified_users,
          AVG((metrics->>'loginCount')::int) as avg_login_count,
          AVG((metrics->>'sessionDuration')::int) as avg_session_duration
        FROM users 
        WHERE tenant_id = $1
      `;
      
      const countsResult = await this.pool.query(countsQuery, [tenantId]);
      const counts = countsResult.rows[0];

      // Get top features usage
      const featuresQuery = `
        SELECT 
          feature,
          COUNT(*) as usage_count
        FROM users,
        jsonb_array_elements_text(metrics->'featuresUsed') as feature
        WHERE tenant_id = $1 AND is_active = true
        GROUP BY feature
        ORDER BY usage_count DESC
        LIMIT 10
      `;
      
      const featuresResult = await this.pool.query(featuresQuery, [tenantId]);

      return {
        totalUsers: parseInt(counts.total_users, 10),
        activeUsers: parseInt(counts.active_users, 10),
        verifiedUsers: parseInt(counts.verified_users, 10),
        averageLoginCount: parseFloat(counts.avg_login_count) || 0,
        averageSessionDuration: parseFloat(counts.avg_session_duration) || 0,
        topFeatures: featuresResult.rows.map(row => ({
          feature: row.feature,
          usage: parseInt(row.usage_count, 10)
        }))
      };

    } catch (error) {
      this.logger.error('Failed to get user metrics by tenant', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to get user metrics by tenant: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Search users by various criteria
   * 
   * @param criteria - Search criteria
   * @returns Promise resolving to array of matching users
   */
  async search(criteria: {
    tenantId?: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    role?: string;
    isActive?: boolean;
    isVerified?: boolean;
    createdAfter?: Date;
    createdBefore?: Date;
    offset?: number;
    limit?: number;
  }): Promise<User[]> {
    try {
      let query = 'SELECT * FROM users WHERE 1=1';
      const params: any[] = [];
      let paramIndex = 1;

      // Build dynamic query based on criteria
      if (criteria.tenantId) {
        query += ` AND tenant_id = $${paramIndex}`;
        params.push(criteria.tenantId);
        paramIndex++;
      }

      if (criteria.email) {
        query += ` AND LOWER(email) LIKE LOWER($${paramIndex})`;
        params.push(`%${criteria.email}%`);
        paramIndex++;
      }

      if (criteria.firstName) {
        query += ` AND LOWER(profile->>'firstName') LIKE LOWER($${paramIndex})`;
        params.push(`%${criteria.firstName}%`);
        paramIndex++;
      }

      if (criteria.lastName) {
        query += ` AND LOWER(profile->>'lastName') LIKE LOWER($${paramIndex})`;
        params.push(`%${criteria.lastName}%`);
        paramIndex++;
      }

      if (criteria.company) {
        query += ` AND LOWER(profile->>'company') LIKE LOWER($${paramIndex})`;
        params.push(`%${criteria.company}%`);
        paramIndex++;
      }

      if (criteria.role) {
        query += ` AND $${paramIndex} = ANY(roles)`;
        params.push(criteria.role);
        paramIndex++;
      }

      if (criteria.isActive !== undefined) {
        query += ` AND is_active = $${paramIndex}`;
        params.push(criteria.isActive);
        paramIndex++;
      }

      if (criteria.isVerified !== undefined) {
        query += ` AND is_verified = $${paramIndex}`;
        params.push(criteria.isVerified);
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

      query += ' ORDER BY created_at DESC';

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
      
      return result.rows.map(row => this.mapRowToUser(row));

    } catch (error) {
      this.logger.error('Failed to search users', {
        criteria,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      throw new Error(`Failed to search users: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Map database row to User domain entity
   * 
   * @param row - Database row
   * @returns User domain entity
   */
  private mapRowToUser(row: any): User {
    return User.fromPersistence({
      id: row.id,
      email: row.email,
      passwordHash: row.password_hash,
      tenantId: row.tenant_id,
      profile: row.profile,
      preferences: row.preferences,
      metrics: row.metrics,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      isActive: row.is_active,
      isVerified: row.is_verified,
      roles: row.roles
    });
  }
}
