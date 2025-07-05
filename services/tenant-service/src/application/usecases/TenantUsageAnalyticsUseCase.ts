import { TenantRepository } from '../../domain/repositories/TenantRepository';
import { Logger } from '../ports/Logger';

export interface TenantUsageAnalyticsRequest {
  tenantId: string;
  requesterId: string;
  requesterRole: 'owner' | 'admin' | 'user';
  timeRange?: {
    startDate: Date;
    endDate: Date;
  };
  metrics?: ('users' | 'storage' | 'apiCalls' | 'aiInteractions' | 'billing')[];
}

export interface UsageMetrics {
  users: {
    current: number;
    limit: number;
    utilizationPercentage: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  storage: {
    currentGB: number;
    limitGB: number;
    utilizationPercentage: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  apiCalls: {
    currentMonth: number;
    limit: number;
    utilizationPercentage: number;
    dailyAverage: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  aiInteractions: {
    currentMonth: number;
    limit: number;
    utilizationPercentage: number;
    dailyAverage: number;
    trend: 'increasing' | 'decreasing' | 'stable';
  };
  billing: {
    currentPlan: string;
    monthlyAmount: number;
    overageCharges: number;
    nextBillingDate: Date;
    paymentStatus: 'current' | 'overdue' | 'failed';
  };
}

export interface TenantUsageAnalyticsResponse {
  success: boolean;
  analytics?: {
    tenantId: string;
    tenantName: string;
    generatedAt: Date;
    timeRange: {
      startDate: Date;
      endDate: Date;
    };
    metrics: Partial<UsageMetrics>;
    recommendations: string[];
    alerts: {
      type: 'warning' | 'critical' | 'info';
      message: string;
      metric: string;
    }[];
  };
  error?: string;
}

export class TenantUsageAnalyticsUseCase {
  constructor(
    private tenantRepository: TenantRepository,
    private logger: Logger
  ) {}

  async execute(request: TenantUsageAnalyticsRequest): Promise<TenantUsageAnalyticsResponse> {
    try {
      this.logger.info('Generating tenant usage analytics', { 
        tenantId: request.tenantId,
        requesterId: request.requesterId 
      });

      // Validate input
      if (!request.tenantId || !request.requesterId) {
        return {
          success: false,
          error: 'Tenant ID and requester ID are required'
        };
      }

      // Get tenant
      const tenant = await this.tenantRepository.findById(request.tenantId);
      if (!tenant) {
        return {
          success: false,
          error: 'Tenant not found'
        };
      }

      // Authorization check
      const isAuthorized = this.checkAuthorization(tenant, request.requesterId, request.requesterRole);
      if (!isAuthorized) {
        this.logger.warn('Unauthorized analytics access attempt', {
          tenantId: request.tenantId,
          requesterId: request.requesterId,
          requesterRole: request.requesterRole
        });
        
        return {
          success: false,
          error: 'Unauthorized access to tenant analytics'
        };
      }

      // Set default time range (last 30 days)
      const timeRange = request.timeRange || {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date()
      };

      // Set default metrics
      const requestedMetrics = request.metrics || ['users', 'storage', 'apiCalls', 'aiInteractions', 'billing'];

      // Generate analytics
      const metrics = await this.generateMetrics(tenant, timeRange, requestedMetrics);
      const recommendations = this.generateRecommendations(tenant, metrics);
      const alerts = this.generateAlerts(tenant, metrics);

      this.logger.info('Tenant usage analytics generated successfully', { 
        tenantId: request.tenantId,
        metricsCount: Object.keys(metrics).length,
        alertsCount: alerts.length
      });

      return {
        success: true,
        analytics: {
          tenantId: tenant.id,
          tenantName: tenant.name,
          generatedAt: new Date(),
          timeRange,
          metrics,
          recommendations,
          alerts
        }
      };

    } catch (error) {
      this.logger.error('Error generating tenant usage analytics', error as Error, {
        tenantId: request.tenantId,
        requesterId: request.requesterId
      });

      return {
        success: false,
        error: 'Failed to generate tenant usage analytics'
      };
    }
  }

  private checkAuthorization(tenant: any, requesterId: string, requesterRole: string): boolean {
    // Owner can always access
    if (tenant.ownerId === requesterId) {
      return true;
    }

    // Admin role can access analytics
    if (requesterRole === 'admin') {
      return true;
    }

    // Regular users cannot access analytics
    return false;
  }

  private async generateMetrics(tenant: any, timeRange: any, requestedMetrics: string[]): Promise<Partial<UsageMetrics>> {
    const metrics: Partial<UsageMetrics> = {};

    for (const metric of requestedMetrics) {
      switch (metric) {
        case 'users':
          metrics.users = {
            current: tenant.currentUsage.users,
            limit: tenant.resourceLimits.users,
            utilizationPercentage: Math.round((tenant.currentUsage.users / tenant.resourceLimits.users) * 100),
            trend: this.calculateTrend('users', tenant) // Mock implementation
          };
          break;

        case 'storage':
          metrics.storage = {
            currentGB: Math.round(tenant.currentUsage.storageGB * 100) / 100,
            limitGB: tenant.resourceLimits.storageGB,
            utilizationPercentage: Math.round((tenant.currentUsage.storageGB / tenant.resourceLimits.storageGB) * 100),
            trend: this.calculateTrend('storage', tenant)
          };
          break;

        case 'apiCalls':
          metrics.apiCalls = {
            currentMonth: tenant.currentUsage.apiCallsThisMonth,
            limit: tenant.resourceLimits.apiCallsPerMonth,
            utilizationPercentage: Math.round((tenant.currentUsage.apiCallsThisMonth / tenant.resourceLimits.apiCallsPerMonth) * 100),
            dailyAverage: Math.round(tenant.currentUsage.apiCallsThisMonth / new Date().getDate()),
            trend: this.calculateTrend('apiCalls', tenant)
          };
          break;

        case 'aiInteractions':
          metrics.aiInteractions = {
            currentMonth: tenant.currentUsage.aiInteractionsThisMonth,
            limit: tenant.resourceLimits.aiInteractionsPerMonth,
            utilizationPercentage: Math.round((tenant.currentUsage.aiInteractionsThisMonth / tenant.resourceLimits.aiInteractionsPerMonth) * 100),
            dailyAverage: Math.round(tenant.currentUsage.aiInteractionsThisMonth / new Date().getDate()),
            trend: this.calculateTrend('aiInteractions', tenant)
          };
          break;

        case 'billing':
          metrics.billing = {
            currentPlan: tenant.plan,
            monthlyAmount: this.getPlanAmount(tenant.plan),
            overageCharges: this.calculateOverageCharges(tenant),
            nextBillingDate: this.getNextBillingDate(tenant),
            paymentStatus: tenant.billingInfo.paymentMethodId ? 'current' : 'failed'
          };
          break;
      }
    }

    return metrics;
  }

  private calculateTrend(metric: string, tenant: any): 'increasing' | 'decreasing' | 'stable' {
    // Mock implementation - in reality, you'd compare with historical data
    const utilizationPercentage = this.getUtilizationPercentage(metric, tenant);
    
    if (utilizationPercentage > 80) return 'increasing';
    if (utilizationPercentage < 20) return 'decreasing';
    return 'stable';
  }

  private getUtilizationPercentage(metric: string, tenant: any): number {
    switch (metric) {
      case 'users':
        return (tenant.currentUsage.users / tenant.resourceLimits.users) * 100;
      case 'storage':
        return (tenant.currentUsage.storageGB / tenant.resourceLimits.storageGB) * 100;
      case 'apiCalls':
        return (tenant.currentUsage.apiCallsThisMonth / tenant.resourceLimits.apiCallsPerMonth) * 100;
      case 'aiInteractions':
        return (tenant.currentUsage.aiInteractionsThisMonth / tenant.resourceLimits.aiInteractionsPerMonth) * 100;
      default:
        return 0;
    }
  }

  private getPlanAmount(plan: string): number {
    const planPricing = {
      starter: 29,
      professional: 99,
      enterprise: 299,
      custom: 0
    };
    return planPricing[plan as keyof typeof planPricing] || 0;
  }

  private calculateOverageCharges(tenant: any): number {
    let overageCharges = 0;

    // Calculate API calls overage
    if (tenant.currentUsage.apiCallsThisMonth > tenant.resourceLimits.apiCallsPerMonth) {
      const overage = tenant.currentUsage.apiCallsThisMonth - tenant.resourceLimits.apiCallsPerMonth;
      overageCharges += overage * 0.001; // $0.001 per extra API call
    }

    // Calculate AI interactions overage
    if (tenant.currentUsage.aiInteractionsThisMonth > tenant.resourceLimits.aiInteractionsPerMonth) {
      const overage = tenant.currentUsage.aiInteractionsThisMonth - tenant.resourceLimits.aiInteractionsPerMonth;
      overageCharges += overage * 0.01; // $0.01 per extra AI interaction
    }

    // Calculate storage overage
    if (tenant.currentUsage.storageGB > tenant.resourceLimits.storageGB) {
      const overage = tenant.currentUsage.storageGB - tenant.resourceLimits.storageGB;
      overageCharges += overage * 0.5; // $0.50 per extra GB
    }

    return Math.round(overageCharges * 100) / 100;
  }

  private getNextBillingDate(tenant: any): Date {
    // Mock implementation - calculate next billing date based on creation date
    const nextBilling = new Date(tenant.createdAt);
    nextBilling.setMonth(nextBilling.getMonth() + 1);
    return nextBilling;
  }

  private generateRecommendations(tenant: any, metrics: Partial<UsageMetrics>): string[] {
    const recommendations: string[] = [];

    // Check for high utilization
    if (metrics.users && metrics.users.utilizationPercentage > 80) {
      recommendations.push('Consider upgrading your plan to accommodate more users');
    }

    if (metrics.storage && metrics.storage.utilizationPercentage > 80) {
      recommendations.push('Storage usage is high. Consider archiving old data or upgrading your plan');
    }

    if (metrics.apiCalls && metrics.apiCalls.utilizationPercentage > 80) {
      recommendations.push('API usage is approaching limits. Consider optimizing API calls or upgrading your plan');
    }

    if (metrics.aiInteractions && metrics.aiInteractions.utilizationPercentage > 80) {
      recommendations.push('AI interaction usage is high. Consider upgrading to a higher plan for more interactions');
    }

    // Check for underutilization
    if (metrics.users && metrics.users.utilizationPercentage < 20 && tenant.plan !== 'starter') {
      recommendations.push('User utilization is low. Consider downgrading to save costs');
    }

    // Billing recommendations
    if (metrics.billing && metrics.billing.overageCharges > 0) {
      recommendations.push('You have overage charges. Consider upgrading your plan to avoid extra fees');
    }

    if (recommendations.length === 0) {
      recommendations.push('Your resource usage looks optimal for your current plan');
    }

    return recommendations;
  }

  private generateAlerts(tenant: any, metrics: Partial<UsageMetrics>): Array<{type: 'warning' | 'critical' | 'info'; message: string; metric: string}> {
    const alerts: Array<{type: 'warning' | 'critical' | 'info'; message: string; metric: string}> = [];

    // Critical alerts (>95% utilization)
    if (metrics.users && metrics.users.utilizationPercentage > 95) {
      alerts.push({
        type: 'critical',
        message: 'User limit almost reached. Immediate action required.',
        metric: 'users'
      });
    }

    if (metrics.storage && metrics.storage.utilizationPercentage > 95) {
      alerts.push({
        type: 'critical',
        message: 'Storage limit almost reached. Data uploads may fail.',
        metric: 'storage'
      });
    }

    if (metrics.apiCalls && metrics.apiCalls.utilizationPercentage > 95) {
      alerts.push({
        type: 'critical',
        message: 'API call limit almost reached. Service may be throttled.',
        metric: 'apiCalls'
      });
    }

    // Warning alerts (>80% utilization)
    if (metrics.users && metrics.users.utilizationPercentage > 80 && metrics.users.utilizationPercentage <= 95) {
      alerts.push({
        type: 'warning',
        message: 'User limit approaching. Consider upgrading your plan.',
        metric: 'users'
      });
    }

    if (metrics.storage && metrics.storage.utilizationPercentage > 80 && metrics.storage.utilizationPercentage <= 95) {
      alerts.push({
        type: 'warning',
        message: 'Storage usage is high. Consider cleanup or upgrade.',
        metric: 'storage'
      });
    }

    // Billing alerts
    if (metrics.billing && metrics.billing.paymentStatus === 'failed') {
      alerts.push({
        type: 'critical',
        message: 'Payment method failed. Please update your billing information.',
        metric: 'billing'
      });
    }

    if (metrics.billing && metrics.billing.overageCharges > 50) {
      alerts.push({
        type: 'warning',
        message: `High overage charges ($${metrics.billing.overageCharges}). Consider upgrading your plan.`,
        metric: 'billing'
      });
    }

    return alerts;
  }
}
