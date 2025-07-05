/**
 * Tenant Domain Events
 * 
 * Domain events that are published when significant tenant-related actions occur.
 * These events enable event-driven architecture and allow other services to react
 * to tenant changes without tight coupling.
 */

export interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  eventVersion: number;
  occurredAt: Date;
  tenantId: string;
  userId?: string;
  metadata?: Record<string, any>;
}

/**
 * Published when a new tenant is created
 */
export interface TenantCreatedEvent extends DomainEvent {
  eventType: 'TenantCreated';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    name: string;
    slug: string;
    ownerId: string;
    plan: string;
    status: string;
    trialEndsAt?: Date;
    createdAt: Date;
    settings: {
      branding: {
        companyName: string;
        primaryColor?: string;
        secondaryColor?: string;
      };
      features: Record<string, boolean>;
    };
  };
}

/**
 * Published when tenant is activated
 */
export interface TenantActivatedEvent extends DomainEvent {
  eventType: 'TenantActivated';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    name: string;
    slug: string;
    ownerId: string;
    previousStatus: string;
    activatedAt: Date;
    activatedBy?: string;
  };
}

/**
 * Published when tenant is suspended
 */
export interface TenantSuspendedEvent extends DomainEvent {
  eventType: 'TenantSuspended';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    name: string;
    slug: string;
    ownerId: string;
    reason: string;
    suspendedAt: Date;
    suspendedBy?: string;
    previousStatus: string;
  };
}

/**
 * Published when tenant subscription is cancelled
 */
export interface TenantCancelledEvent extends DomainEvent {
  eventType: 'TenantCancelled';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    name: string;
    slug: string;
    ownerId: string;
    cancelledAt: Date;
    cancelledBy?: string;
    reason?: string;
    finalBillingAmount?: number;
  };
}

/**
 * Published when tenant settings are updated
 */
export interface TenantSettingsUpdatedEvent extends DomainEvent {
  eventType: 'TenantSettingsUpdated';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    updatedBy: string;
    updatedAt: Date;
    changedSettings: string[];
    previousSettings: Record<string, any>;
    newSettings: Record<string, any>;
  };
}

/**
 * Published when tenant resource limits are updated
 */
export interface TenantResourceLimitsUpdatedEvent extends DomainEvent {
  eventType: 'TenantResourceLimitsUpdated';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    updatedBy: string;
    updatedAt: Date;
    previousLimits: Record<string, any>;
    newLimits: Record<string, any>;
    changedResources: string[];
  };
}

/**
 * Published when tenant exceeds resource limits
 */
export interface TenantResourceLimitExceededEvent extends DomainEvent {
  eventType: 'TenantResourceLimitExceeded';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    resource: string;
    currentUsage: number;
    limit: number;
    percentage: number;
    exceededAt: Date;
    severity: 'warning' | 'critical';
  };
}

/**
 * Published when tenant billing information is updated
 */
export interface TenantBillingUpdatedEvent extends DomainEvent {
  eventType: 'TenantBillingUpdated';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    updatedBy: string;
    updatedAt: Date;
    changedFields: string[];
    previousPlan?: string;
    newPlan?: string;
    billingCycle?: string;
    amount?: number;
    currency?: string;
  };
}

/**
 * Published when tenant usage is updated
 */
export interface TenantUsageUpdatedEvent extends DomainEvent {
  eventType: 'TenantUsageUpdated';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    updatedAt: Date;
    usage: {
      users?: number;
      storageGB?: number;
      apiCalls?: number;
      aiInteractions?: number;
    };
    resourceUtilization: Array<{
      resource: string;
      current: number;
      limit: number;
      percentage: number;
    }>;
  };
}

/**
 * Published when tenant trial is about to expire
 */
export interface TenantTrialExpiringEvent extends DomainEvent {
  eventType: 'TenantTrialExpiring';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    name: string;
    ownerId: string;
    trialEndsAt: Date;
    daysRemaining: number;
    notificationSent: boolean;
  };
}

/**
 * Published when tenant trial expires
 */
export interface TenantTrialExpiredEvent extends DomainEvent {
  eventType: 'TenantTrialExpired';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    name: string;
    ownerId: string;
    expiredAt: Date;
    gracePeriodEnds?: Date;
    autoSuspend: boolean;
  };
}

/**
 * Published when tenant monthly usage is reset
 */
export interface TenantUsageResetEvent extends DomainEvent {
  eventType: 'TenantUsageReset';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    resetAt: Date;
    previousUsage: {
      apiCalls: number;
      aiInteractions: number;
    };
    nextResetDate: Date;
  };
}

/**
 * Published when tenant plan is upgraded or downgraded
 */
export interface TenantPlanChangedEvent extends DomainEvent {
  eventType: 'TenantPlanChanged';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    changedBy: string;
    changedAt: Date;
    previousPlan: string;
    newPlan: string;
    previousLimits: Record<string, any>;
    newLimits: Record<string, any>;
    proratedAmount?: number;
    effectiveDate: Date;
  };
}

/**
 * Published when tenant custom domain is configured
 */
export interface TenantCustomDomainConfiguredEvent extends DomainEvent {
  eventType: 'TenantCustomDomainConfigured';
  aggregateType: 'Tenant';
  data: {
    tenantId: string;
    domain: string;
    configuredBy: string;
    configuredAt: Date;
    sslEnabled: boolean;
    dnsVerified: boolean;
  };
}

/**
 * Union type for all tenant events
 */
export type TenantEvent = 
  | TenantCreatedEvent
  | TenantActivatedEvent
  | TenantSuspendedEvent
  | TenantCancelledEvent
  | TenantSettingsUpdatedEvent
  | TenantResourceLimitsUpdatedEvent
  | TenantResourceLimitExceededEvent
  | TenantBillingUpdatedEvent
  | TenantUsageUpdatedEvent
  | TenantTrialExpiringEvent
  | TenantTrialExpiredEvent
  | TenantUsageResetEvent
  | TenantPlanChangedEvent
  | TenantCustomDomainConfiguredEvent;

/**
 * Event factory for creating tenant events
 */
export class TenantEventFactory {
  /**
   * Create a TenantCreated event
   */
  static createTenantCreatedEvent(
    tenant: any,
    metadata?: Record<string, any>
  ): TenantCreatedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'TenantCreated',
      aggregateId: tenant.id,
      aggregateType: 'Tenant',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: tenant.id,
      metadata,
      data: {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        ownerId: tenant.ownerId,
        plan: tenant.billingInfo.plan,
        status: tenant.status,
        trialEndsAt: tenant.trialEndsAt,
        createdAt: tenant.createdAt,
        settings: {
          branding: {
            companyName: tenant.settings.branding.companyName,
            primaryColor: tenant.settings.branding.primaryColor,
            secondaryColor: tenant.settings.branding.secondaryColor
          },
          features: tenant.settings.features
        }
      }
    };
  }

  /**
   * Create a TenantActivated event
   */
  static createTenantActivatedEvent(
    tenant: any,
    previousStatus: string,
    activatedBy?: string,
    metadata?: Record<string, any>
  ): TenantActivatedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'TenantActivated',
      aggregateId: tenant.id,
      aggregateType: 'Tenant',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: tenant.id,
      userId: activatedBy,
      metadata,
      data: {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        ownerId: tenant.ownerId,
        previousStatus,
        activatedAt: new Date(),
        activatedBy
      }
    };
  }

  /**
   * Create a TenantSuspended event
   */
  static createTenantSuspendedEvent(
    tenant: any,
    previousStatus: string,
    suspendedBy?: string,
    metadata?: Record<string, any>
  ): TenantSuspendedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'TenantSuspended',
      aggregateId: tenant.id,
      aggregateType: 'Tenant',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: tenant.id,
      userId: suspendedBy,
      metadata,
      data: {
        tenantId: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        ownerId: tenant.ownerId,
        reason: tenant.suspensionReason || 'No reason provided',
        suspendedAt: tenant.suspendedAt || new Date(),
        suspendedBy,
        previousStatus
      }
    };
  }

  /**
   * Create a TenantResourceLimitExceeded event
   */
  static createTenantResourceLimitExceededEvent(
    tenantId: string,
    resource: string,
    currentUsage: number,
    limit: number,
    severity: 'warning' | 'critical' = 'warning',
    metadata?: Record<string, any>
  ): TenantResourceLimitExceededEvent {
    const percentage = (currentUsage / limit) * 100;
    
    return {
      eventId: this.generateEventId(),
      eventType: 'TenantResourceLimitExceeded',
      aggregateId: tenantId,
      aggregateType: 'Tenant',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId,
      metadata,
      data: {
        tenantId,
        resource,
        currentUsage,
        limit,
        percentage,
        exceededAt: new Date(),
        severity
      }
    };
  }

  /**
   * Create a TenantUsageUpdated event
   */
  static createTenantUsageUpdatedEvent(
    tenant: any,
    usage: {
      users?: number;
      storageGB?: number;
      apiCalls?: number;
      aiInteractions?: number;
    },
    metadata?: Record<string, any>
  ): TenantUsageUpdatedEvent {
    const resourceUtilization = [];
    
    if (usage.users !== undefined) {
      resourceUtilization.push({
        resource: 'users',
        current: usage.users,
        limit: tenant.resourceLimits.users.max,
        percentage: (usage.users / tenant.resourceLimits.users.max) * 100
      });
    }

    if (usage.storageGB !== undefined) {
      resourceUtilization.push({
        resource: 'storage',
        current: usage.storageGB,
        limit: tenant.resourceLimits.storage.maxGB,
        percentage: (usage.storageGB / tenant.resourceLimits.storage.maxGB) * 100
      });
    }

    return {
      eventId: this.generateEventId(),
      eventType: 'TenantUsageUpdated',
      aggregateId: tenant.id,
      aggregateType: 'Tenant',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: tenant.id,
      metadata,
      data: {
        tenantId: tenant.id,
        updatedAt: new Date(),
        usage,
        resourceUtilization
      }
    };
  }

  /**
   * Create a TenantTrialExpiring event
   */
  static createTenantTrialExpiringEvent(
    tenant: any,
    daysRemaining: number,
    metadata?: Record<string, any>
  ): TenantTrialExpiringEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'TenantTrialExpiring',
      aggregateId: tenant.id,
      aggregateType: 'Tenant',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: tenant.id,
      metadata,
      data: {
        tenantId: tenant.id,
        name: tenant.name,
        ownerId: tenant.ownerId,
        trialEndsAt: tenant.trialEndsAt,
        daysRemaining,
        notificationSent: true
      }
    };
  }

  /**
   * Generate unique event ID
   */
  private static generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
