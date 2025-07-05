/**
 * Tenant Domain Entity
 * 
 * Core business entity representing a tenant in the multi-tenant SaaS platform.
 * Encapsulates tenant-specific business logic, resource management, billing,
 * and compliance requirements following Domain-Driven Design principles.
 */

import { v4 as uuidv4 } from 'uuid';

export interface TenantSettings {
  branding: {
    logoUrl?: string;
    primaryColor?: string;
    secondaryColor?: string;
    customDomain?: string;
    companyName: string;
  };
  features: {
    aiPersonalization: boolean;
    advancedAnalytics: boolean;
    customIntegrations: boolean;
    whiteLabeling: boolean;
    apiAccess: boolean;
    ssoIntegration: boolean;
  };
  security: {
    passwordPolicy: {
      minLength: number;
      requireUppercase: boolean;
      requireLowercase: boolean;
      requireNumbers: boolean;
      requireSpecialChars: boolean;
      maxAge: number; // days
    };
    sessionTimeout: number; // minutes
    mfaRequired: boolean;
    ipWhitelist: string[];
    dataRetentionDays: number;
  };
  compliance: {
    gdprEnabled: boolean;
    hipaaEnabled: boolean;
    soc2Enabled: boolean;
    dataResidency: 'us' | 'eu' | 'asia' | 'global';
    auditLogRetention: number; // days
  };
}

export interface ResourceLimits {
  users: {
    max: number;
    current: number;
  };
  storage: {
    maxGB: number;
    currentGB: number;
  };
  apiCalls: {
    monthlyLimit: number;
    currentMonth: number;
    resetDate: Date;
  };
  aiInteractions: {
    monthlyLimit: number;
    currentMonth: number;
    resetDate: Date;
  };
  customIntegrations: {
    max: number;
    current: number;
  };
}

export interface BillingInfo {
  plan: 'starter' | 'professional' | 'enterprise' | 'custom';
  billingCycle: 'monthly' | 'yearly';
  currency: string;
  amount: number; // in cents
  nextBillingDate: Date;
  paymentMethod: {
    type: 'card' | 'bank' | 'invoice';
    last4?: string;
    expiryMonth?: number;
    expiryYear?: number;
  };
  billingAddress: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string;
  };
  taxInfo: {
    taxId?: string;
    taxRate: number;
    taxExempt: boolean;
  };
}

export interface TenantMetrics {
  users: {
    total: number;
    active: number;
    lastWeekGrowth: number;
  };
  usage: {
    storageUsedGB: number;
    apiCallsThisMonth: number;
    aiInteractionsThisMonth: number;
    averageSessionDuration: number;
  };
  performance: {
    averageResponseTime: number;
    uptime: number;
    errorRate: number;
  };
  billing: {
    monthlyRevenue: number;
    outstandingAmount: number;
    lastPaymentDate?: Date;
  };
}

export type TenantStatus = 'active' | 'suspended' | 'trial' | 'cancelled' | 'pending';

export class Tenant {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly slug: string,
    public readonly ownerId: string,
    public settings: TenantSettings,
    public resourceLimits: ResourceLimits,
    public billingInfo: BillingInfo,
    public metrics: TenantMetrics,
    public readonly status: TenantStatus,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public readonly trialEndsAt?: Date,
    public readonly suspendedAt?: Date,
    public readonly suspensionReason?: string
  ) {}

  /**
   * Factory method to create a new tenant
   */
  public static create(
    name: string,
    slug: string,
    ownerId: string,
    plan: 'starter' | 'professional' | 'enterprise' | 'custom' = 'starter',
    billingInfo: Partial<BillingInfo> = {}
  ): Tenant {
    // Business rule: Name must be provided and valid
    if (!name || name.trim().length === 0) {
      throw new Error('Tenant name is required');
    }

    if (name.length > 100) {
      throw new Error('Tenant name must be less than 100 characters');
    }

    // Business rule: Slug must be valid and URL-safe
    if (!slug || !this.isValidSlug(slug)) {
      throw new Error('Invalid tenant slug. Must be lowercase, alphanumeric with hyphens only');
    }

    // Business rule: Owner ID must be provided
    if (!ownerId || ownerId.trim().length === 0) {
      throw new Error('Tenant owner ID is required');
    }

    const now = new Date();
    const trialEndsAt = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000)); // 14 days trial

    return new Tenant(
      uuidv4(),
      name.trim(),
      slug.toLowerCase(),
      ownerId,
      this.getDefaultSettings(name.trim()),
      this.getDefaultResourceLimits(plan),
      this.getDefaultBillingInfo(plan, billingInfo),
      this.getInitialMetrics(),
      'trial',
      now,
      now,
      trialEndsAt
    );
  }

  /**
   * Factory method to reconstruct tenant from persistence
   */
  public static fromPersistence(data: any): Tenant {
    return new Tenant(
      data.id,
      data.name,
      data.slug,
      data.ownerId,
      data.settings,
      data.resourceLimits,
      data.billingInfo,
      data.metrics,
      data.status,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.trialEndsAt ? new Date(data.trialEndsAt) : undefined,
      data.suspendedAt ? new Date(data.suspendedAt) : undefined,
      data.suspensionReason
    );
  }

  /**
   * Update tenant settings with validation
   */
  public updateSettings(newSettings: Partial<TenantSettings>): void {
    // Validate branding settings
    if (newSettings.branding) {
      if (newSettings.branding.companyName !== undefined && 
          (!newSettings.branding.companyName || newSettings.branding.companyName.trim().length === 0)) {
        throw new Error('Company name cannot be empty');
      }

      if (newSettings.branding.customDomain && 
          !this.isValidDomain(newSettings.branding.customDomain)) {
        throw new Error('Invalid custom domain format');
      }
    }

    // Validate security settings
    if (newSettings.security?.passwordPolicy) {
      const policy = newSettings.security.passwordPolicy;
      if (policy.minLength !== undefined && (policy.minLength < 8 || policy.minLength > 128)) {
        throw new Error('Password minimum length must be between 8 and 128 characters');
      }
      if (policy.maxAge !== undefined && (policy.maxAge < 30 || policy.maxAge > 365)) {
        throw new Error('Password max age must be between 30 and 365 days');
      }
    }

    if (newSettings.security?.sessionTimeout !== undefined && 
        (newSettings.security.sessionTimeout < 15 || newSettings.security.sessionTimeout > 1440)) {
      throw new Error('Session timeout must be between 15 and 1440 minutes');
    }

    // Deep merge settings
    this.settings = this.deepMerge(this.settings, newSettings);
    this.updatedAt = new Date();
  }

  /**
   * Update resource limits with validation
   */
  public updateResourceLimits(newLimits: Partial<ResourceLimits>): void {
    // Validate that new limits don't go below current usage
    if (newLimits.users?.max !== undefined && 
        newLimits.users.max < this.resourceLimits.users.current) {
      throw new Error('Cannot set user limit below current usage');
    }

    if (newLimits.storage?.maxGB !== undefined && 
        newLimits.storage.maxGB < this.resourceLimits.storage.currentGB) {
      throw new Error('Cannot set storage limit below current usage');
    }

    // Update limits
    this.resourceLimits = { ...this.resourceLimits, ...newLimits };
    this.updatedAt = new Date();
  }

  /**
   * Update billing information
   */
  public updateBillingInfo(newBillingInfo: Partial<BillingInfo>): void {
    // Validate billing address if provided
    if (newBillingInfo.billingAddress) {
      const addr = newBillingInfo.billingAddress;
      if (!addr.street || !addr.city || !addr.country) {
        throw new Error('Billing address must include street, city, and country');
      }
    }

    // Validate payment method if provided
    if (newBillingInfo.paymentMethod) {
      const pm = newBillingInfo.paymentMethod;
      if (pm.type === 'card' && (!pm.last4 || !pm.expiryMonth || !pm.expiryYear)) {
        throw new Error('Card payment method must include last4, expiry month, and year');
      }
    }

    this.billingInfo = { ...this.billingInfo, ...newBillingInfo };
    this.updatedAt = new Date();
  }

  /**
   * Activate tenant (from trial or suspended state)
   */
  public activate(): Tenant {
    if (this.status === 'active') {
      return this; // Already active
    }

    return new Tenant(
      this.id,
      this.name,
      this.slug,
      this.ownerId,
      this.settings,
      this.resourceLimits,
      this.billingInfo,
      this.metrics,
      'active',
      this.createdAt,
      new Date(),
      this.trialEndsAt,
      undefined, // Clear suspension
      undefined
    );
  }

  /**
   * Suspend tenant with reason
   */
  public suspend(reason: string): Tenant {
    if (!reason || reason.trim().length === 0) {
      throw new Error('Suspension reason is required');
    }

    return new Tenant(
      this.id,
      this.name,
      this.slug,
      this.ownerId,
      this.settings,
      this.resourceLimits,
      this.billingInfo,
      this.metrics,
      'suspended',
      this.createdAt,
      new Date(),
      this.trialEndsAt,
      new Date(),
      reason.trim()
    );
  }

  /**
   * Cancel tenant subscription
   */
  public cancel(): Tenant {
    return new Tenant(
      this.id,
      this.name,
      this.slug,
      this.ownerId,
      this.settings,
      this.resourceLimits,
      this.billingInfo,
      this.metrics,
      'cancelled',
      this.createdAt,
      new Date(),
      this.trialEndsAt,
      this.suspendedAt,
      this.suspensionReason
    );
  }

  /**
   * Check if tenant has exceeded resource limits
   */
  public hasExceededLimits(): {
    exceeded: boolean;
    limits: Array<{
      resource: string;
      current: number;
      limit: number;
      percentage: number;
    }>;
  } {
    const limits = [];
    let exceeded = false;

    // Check user limit
    const userPercentage = (this.resourceLimits.users.current / this.resourceLimits.users.max) * 100;
    if (userPercentage >= 100) exceeded = true;
    limits.push({
      resource: 'users',
      current: this.resourceLimits.users.current,
      limit: this.resourceLimits.users.max,
      percentage: userPercentage
    });

    // Check storage limit
    const storagePercentage = (this.resourceLimits.storage.currentGB / this.resourceLimits.storage.maxGB) * 100;
    if (storagePercentage >= 100) exceeded = true;
    limits.push({
      resource: 'storage',
      current: this.resourceLimits.storage.currentGB,
      limit: this.resourceLimits.storage.maxGB,
      percentage: storagePercentage
    });

    // Check API calls limit
    const apiPercentage = (this.resourceLimits.apiCalls.currentMonth / this.resourceLimits.apiCalls.monthlyLimit) * 100;
    if (apiPercentage >= 100) exceeded = true;
    limits.push({
      resource: 'apiCalls',
      current: this.resourceLimits.apiCalls.currentMonth,
      limit: this.resourceLimits.apiCalls.monthlyLimit,
      percentage: apiPercentage
    });

    return { exceeded, limits };
  }

  /**
   * Check if tenant is in trial period
   */
  public isInTrial(): boolean {
    return this.status === 'trial' && 
           this.trialEndsAt !== undefined && 
           this.trialEndsAt > new Date();
  }

  /**
   * Check if trial has expired
   */
  public isTrialExpired(): boolean {
    return this.status === 'trial' && 
           this.trialEndsAt !== undefined && 
           this.trialEndsAt <= new Date();
  }

  /**
   * Get days remaining in trial
   */
  public getTrialDaysRemaining(): number {
    if (!this.trialEndsAt || this.status !== 'trial') {
      return 0;
    }

    const now = new Date();
    const diffTime = this.trialEndsAt.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    return Math.max(0, diffDays);
  }

  /**
   * Update usage metrics
   */
  public updateUsage(usage: {
    userCount?: number;
    storageGB?: number;
    apiCalls?: number;
    aiInteractions?: number;
  }): void {
    if (usage.userCount !== undefined) {
      this.resourceLimits.users.current = usage.userCount;
    }

    if (usage.storageGB !== undefined) {
      this.resourceLimits.storage.currentGB = usage.storageGB;
    }

    if (usage.apiCalls !== undefined) {
      this.resourceLimits.apiCalls.currentMonth += usage.apiCalls;
    }

    if (usage.aiInteractions !== undefined) {
      this.resourceLimits.aiInteractions.currentMonth += usage.aiInteractions;
    }

    this.updatedAt = new Date();
  }

  /**
   * Reset monthly usage counters
   */
  public resetMonthlyUsage(): void {
    const now = new Date();
    const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    this.resourceLimits.apiCalls.currentMonth = 0;
    this.resourceLimits.apiCalls.resetDate = nextMonth;
    
    this.resourceLimits.aiInteractions.currentMonth = 0;
    this.resourceLimits.aiInteractions.resetDate = nextMonth;

    this.updatedAt = new Date();
  }

  /**
   * Convert to plain object for persistence
   */
  public toPersistence(): any {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      ownerId: this.ownerId,
      settings: this.settings,
      resourceLimits: this.resourceLimits,
      billingInfo: this.billingInfo,
      metrics: this.metrics,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      trialEndsAt: this.trialEndsAt?.toISOString(),
      suspendedAt: this.suspendedAt?.toISOString(),
      suspensionReason: this.suspensionReason
    };
  }

  // Private helper methods

  private static isValidSlug(slug: string): boolean {
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    return slugRegex.test(slug) && slug.length >= 3 && slug.length <= 50;
  }

  private isValidDomain(domain: string): boolean {
    const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{1,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$/;
    return domainRegex.test(domain);
  }

  private static getDefaultSettings(companyName: string): TenantSettings {
    return {
      branding: {
        companyName,
        primaryColor: '#007bff',
        secondaryColor: '#6c757d'
      },
      features: {
        aiPersonalization: true,
        advancedAnalytics: false,
        customIntegrations: false,
        whiteLabeling: false,
        apiAccess: true,
        ssoIntegration: false
      },
      security: {
        passwordPolicy: {
          minLength: 8,
          requireUppercase: true,
          requireLowercase: true,
          requireNumbers: true,
          requireSpecialChars: false,
          maxAge: 90
        },
        sessionTimeout: 480, // 8 hours
        mfaRequired: false,
        ipWhitelist: [],
        dataRetentionDays: 365
      },
      compliance: {
        gdprEnabled: true,
        hipaaEnabled: false,
        soc2Enabled: false,
        dataResidency: 'global',
        auditLogRetention: 2555 // 7 years
      }
    };
  }

  private static getDefaultResourceLimits(plan: string): ResourceLimits {
    const limits = {
      starter: {
        users: { max: 10, current: 0 },
        storage: { maxGB: 5, currentGB: 0 },
        apiCalls: { monthlyLimit: 10000, currentMonth: 0, resetDate: new Date() },
        aiInteractions: { monthlyLimit: 1000, currentMonth: 0, resetDate: new Date() },
        customIntegrations: { max: 2, current: 0 }
      },
      professional: {
        users: { max: 100, current: 0 },
        storage: { maxGB: 50, currentGB: 0 },
        apiCalls: { monthlyLimit: 100000, currentMonth: 0, resetDate: new Date() },
        aiInteractions: { monthlyLimit: 10000, currentMonth: 0, resetDate: new Date() },
        customIntegrations: { max: 10, current: 0 }
      },
      enterprise: {
        users: { max: 1000, current: 0 },
        storage: { maxGB: 500, currentGB: 0 },
        apiCalls: { monthlyLimit: 1000000, currentMonth: 0, resetDate: new Date() },
        aiInteractions: { monthlyLimit: 100000, currentMonth: 0, resetDate: new Date() },
        customIntegrations: { max: 50, current: 0 }
      }
    };

    return limits[plan as keyof typeof limits] || limits.starter;
  }

  private static getDefaultBillingInfo(plan: string, partial: Partial<BillingInfo>): BillingInfo {
    const amounts = {
      starter: 2900, // $29.00
      professional: 9900, // $99.00
      enterprise: 29900, // $299.00
      custom: 0
    };

    const now = new Date();
    const nextBilling = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

    return {
      plan: plan as any,
      billingCycle: 'monthly',
      currency: 'USD',
      amount: amounts[plan as keyof typeof amounts] || 0,
      nextBillingDate: nextBilling,
      paymentMethod: {
        type: 'card'
      },
      billingAddress: {
        street: '',
        city: '',
        state: '',
        postalCode: '',
        country: 'US'
      },
      taxInfo: {
        taxRate: 0,
        taxExempt: false
      },
      ...partial
    };
  }

  private static getInitialMetrics(): TenantMetrics {
    return {
      users: {
        total: 0,
        active: 0,
        lastWeekGrowth: 0
      },
      usage: {
        storageUsedGB: 0,
        apiCallsThisMonth: 0,
        aiInteractionsThisMonth: 0,
        averageSessionDuration: 0
      },
      performance: {
        averageResponseTime: 0,
        uptime: 100,
        errorRate: 0
      },
      billing: {
        monthlyRevenue: 0,
        outstandingAmount: 0
      }
    };
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    
    return result;
  }
}
