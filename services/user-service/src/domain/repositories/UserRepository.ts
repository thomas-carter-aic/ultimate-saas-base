/**
 * User Repository Interface
 * 
 * Defines the contract for user data persistence operations.
 * This interface follows the Repository pattern from Domain-Driven Design,
 * allowing the domain layer to remain independent of infrastructure concerns.
 */

import { User } from '../entities/User';

export interface UserRepository {
  /**
   * Save a user entity to persistence
   * @param user - User entity to save
   * @returns Promise resolving to the saved user
   */
  save(user: User): Promise<User>;

  /**
   * Find a user by their unique identifier
   * @param id - User ID
   * @returns Promise resolving to user or null if not found
   */
  findById(id: string): Promise<User | null>;

  /**
   * Find a user by their email address
   * @param email - User email
   * @returns Promise resolving to user or null if not found
   */
  findByEmail(email: string): Promise<User | null>;

  /**
   * Find users by tenant ID with pagination
   * @param tenantId - Tenant identifier
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of users
   */
  findByTenantId(tenantId: string, offset: number, limit: number): Promise<User[]>;

  /**
   * Find users by role with pagination
   * @param role - User role
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of users
   */
  findByRole(role: string, offset: number, limit: number): Promise<User[]>;

  /**
   * Find active users for a tenant
   * @param tenantId - Tenant identifier
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of active users
   */
  findActiveByTenantId(tenantId: string, offset: number, limit: number): Promise<User[]>;

  /**
   * Count total users for a tenant
   * @param tenantId - Tenant identifier
   * @returns Promise resolving to user count
   */
  countByTenantId(tenantId: string): Promise<number>;

  /**
   * Update user entity
   * @param user - User entity with updates
   * @returns Promise resolving to updated user
   */
  update(user: User): Promise<User>;

  /**
   * Delete a user by ID (soft delete recommended)
   * @param id - User ID
   * @returns Promise resolving to boolean indicating success
   */
  delete(id: string): Promise<boolean>;

  /**
   * Find users with AI personalization enabled for analytics
   * @param tenantId - Optional tenant filter
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of users with AI data
   */
  findUsersForAIAnalytics(tenantId?: string, offset?: number, limit?: number): Promise<User[]>;

  /**
   * Find users who haven't logged in for specified days
   * @param days - Number of days since last login
   * @param tenantId - Optional tenant filter
   * @returns Promise resolving to array of inactive users
   */
  findInactiveUsers(days: number, tenantId?: string): Promise<User[]>;

  /**
   * Get user metrics aggregated by tenant
   * @param tenantId - Tenant identifier
   * @returns Promise resolving to aggregated metrics
   */
  getUserMetricsByTenant(tenantId: string): Promise<{
    totalUsers: number;
    activeUsers: number;
    verifiedUsers: number;
    averageLoginCount: number;
    averageSessionDuration: number;
    topFeatures: Array<{ feature: string; usage: number }>;
  }>;

  /**
   * Search users by various criteria
   * @param criteria - Search criteria
   * @returns Promise resolving to array of matching users
   */
  search(criteria: {
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
  }): Promise<User[]>;
}
