/**
 * Tenant Repository Interface
 * 
 * Defines the contract for tenant data persistence operations.
 * This interface follows the Repository pattern from Domain-Driven Design,
 * allowing the domain layer to remain independent of infrastructure concerns.
 */

import { Tenant } from '../entities/Tenant';

export interface TenantRepository {
  /**
   * Save a tenant entity to persistence
   * @param tenant - Tenant entity to save
   * @returns Promise resolving to the saved tenant
   */
  save(tenant: Tenant): Promise<Tenant>;

  /**
   * Find a tenant by their unique identifier
   * @param id - Tenant ID
   * @returns Promise resolving to tenant or null if not found
   */
  findById(id: string): Promise<Tenant | null>;

  /**
   * Find a tenant by their slug
   * @param slug - Tenant slug (URL-safe identifier)
   * @returns Promise resolving to tenant or null if not found
   */
  findBySlug(slug: string): Promise<Tenant | null>;

  /**
   * Find tenants by owner ID
   * @param ownerId - Owner user ID
   * @returns Promise resolving to array of tenants
   */
  findByOwnerId(ownerId: string): Promise<Tenant[]>;

  /**
   * Find tenants by status with pagination
   * @param status - Tenant status
   * @param offset - Number of records to skip
   * @param limit - Maximum number of records to return
   * @returns Promise resolving to array of tenants
   */
  findByStatus(status: string, offset: number, limit: number): Promise<Tenant[]>;

  /**
   * Find tenants with expiring trials
   * @param daysUntilExpiry - Number of days until trial expires
   * @returns Promise resolving to array of tenants
   */
  findExpiringTrials(daysUntilExpiry: number): Promise<Tenant[]>;

  /**
   * Find tenants that have exceeded resource limits
   * @param resourceType - Type of resource (users, storage, apiCalls, etc.)
   * @param thresholdPercentage - Percentage threshold (e.g., 90 for 90%)
   * @returns Promise resolving to array of tenants
   */
  findExceedingLimits(resourceType?: string, thresholdPercentage?: number): Promise<Tenant[]>;

  /**
   * Update tenant entity
   * @param tenant - Tenant entity with updates
   * @returns Promise resolving to updated tenant
   */
  update(tenant: Tenant): Promise<Tenant>;

  /**
   * Delete a tenant by ID (soft delete recommended)
   * @param id - Tenant ID
   * @returns Promise resolving to boolean indicating success
   */
  delete(id: string): Promise<boolean>;

  /**
   * Count total tenants
   * @param status - Optional status filter
   * @returns Promise resolving to tenant count
   */
  count(status?: string): Promise<number>;

  /**
   * Search tenants by various criteria
   * @param criteria - Search criteria
   * @returns Promise resolving to array of matching tenants
   */
  search(criteria: {
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
  }): Promise<Tenant[]>;

  /**
   * Get tenant metrics aggregated data
   * @param tenantId - Optional tenant ID for specific tenant
   * @param timeRange - Time range for metrics
   * @returns Promise resolving to aggregated metrics
   */
  getTenantMetrics(tenantId?: string, timeRange?: {
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
  }>;

  /**
   * Get tenant usage statistics
   * @param tenantId - Tenant ID
   * @param timeRange - Time range for statistics
   * @returns Promise resolving to usage statistics
   */
  getTenantUsageStats(tenantId: string, timeRange?: {
    start: Date;
    end: Date;
  }): Promise<{
    users: {
      total: number;
      active: number;
      growth: number;
    };
    storage: {
      used: number;
      limit: number;
      percentage: number;
    };
    apiCalls: {
      thisMonth: number;
      limit: number;
      percentage: number;
      trend: number;
    };
    aiInteractions: {
      thisMonth: number;
      limit: number;
      percentage: number;
      trend: number;
    };
  }>;

  /**
   * Update tenant usage counters
   * @param tenantId - Tenant ID
   * @param usage - Usage data to update
   * @returns Promise resolving to success boolean
   */
  updateUsage(tenantId: string, usage: {
    userCount?: number;
    storageGB?: number;
    apiCalls?: number;
    aiInteractions?: number;
  }): Promise<boolean>;

  /**
   * Reset monthly usage counters for all tenants
   * @returns Promise resolving to number of tenants updated
   */
  resetMonthlyUsage(): Promise<number>;

  /**
   * Find tenants requiring billing processing
   * @param billingDate - Date for billing processing
   * @returns Promise resolving to array of tenants
   */
  findForBilling(billingDate: Date): Promise<Tenant[]>;

  /**
   * Update tenant billing status
   * @param tenantId - Tenant ID
   * @param billingData - Billing update data
   * @returns Promise resolving to success boolean
   */
  updateBillingStatus(tenantId: string, billingData: {
    lastBillingDate?: Date;
    nextBillingDate?: Date;
    outstandingAmount?: number;
    paymentStatus?: string;
  }): Promise<boolean>;

  /**
   * Get tenant resource utilization report
   * @param tenantId - Optional tenant ID for specific tenant
   * @returns Promise resolving to resource utilization data
   */
  getResourceUtilization(tenantId?: string): Promise<Array<{
    tenantId: string;
    tenantName: string;
    resources: Array<{
      type: string;
      current: number;
      limit: number;
      percentage: number;
      status: 'normal' | 'warning' | 'critical';
    }>;
  }>>;

  /**
   * Archive inactive tenants
   * @param inactiveDays - Number of days of inactivity
   * @returns Promise resolving to number of tenants archived
   */
  archiveInactiveTenants(inactiveDays: number): Promise<number>;
}
