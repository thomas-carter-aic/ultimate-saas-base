/**
 * Metrics Controller
 * 
 * Provides application metrics endpoints for monitoring and observability.
 * Exposes Prometheus-compatible metrics and custom business metrics.
 */

import { Router, Request, Response } from 'express';
import { UserRepository } from '../../domain/repositories/UserRepository';
import { Logger } from '../../application/ports/Logger';

export interface ApplicationMetrics {
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  system: {
    memory: {
      rss: number;
      heapTotal: number;
      heapUsed: number;
      heapUsagePercent: number;
      external: number;
    };
    cpu: {
      userTime: number;
      systemTime: number;
    };
    eventLoop: {
      lag: number;
    };
  };
  business: {
    users: {
      total: number;
      active: number;
      verified: number;
      createdToday: number;
      createdThisWeek: number;
      createdThisMonth: number;
    };
    activity: {
      loginsToday: number;
      loginsThisWeek: number;
      averageSessionDuration: number;
      topFeatures: Array<{
        feature: string;
        usage: number;
      }>;
    };
    ai: {
      interactionsToday: number;
      interactionsThisWeek: number;
      personalizedUsers: number;
      averageSatisfaction: number;
    };
  };
}

export class MetricsController {
  private router: Router;
  private startTime: number;
  private metricsCache: Map<string, { data: any; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute cache

  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: Logger
  ) {
    this.router = Router();
    this.startTime = Date.now();
    this.setupRoutes();
  }

  /**
   * Get Express router with metrics routes
   */
  public getRouter(): Router {
    return this.router;
  }

  /**
   * Setup metrics routes
   */
  private setupRoutes(): void {
    // Prometheus-compatible metrics endpoint
    this.router.get('/', this.prometheusMetrics.bind(this));

    // JSON metrics endpoint for dashboards
    this.router.get('/json', this.jsonMetrics.bind(this));

    // Business metrics endpoint
    this.router.get('/business', this.businessMetrics.bind(this));

    // System metrics endpoint
    this.router.get('/system', this.systemMetrics.bind(this));

    // User-specific metrics (admin only)
    this.router.get('/users/:tenantId', this.userMetrics.bind(this));

    // AI metrics endpoint
    this.router.get('/ai', this.aiMetrics.bind(this));
  }

  /**
   * Prometheus-compatible metrics endpoint
   */
  private async prometheusMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await this.collectAllMetrics();
      
      // Convert to Prometheus format
      const prometheusFormat = this.convertToPrometheusFormat(metrics);
      
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(prometheusFormat);
    } catch (error) {
      this.logger.error('Failed to generate Prometheus metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).send('# Error generating metrics\n');
    }
  }

  /**
   * JSON metrics endpoint for dashboards and APIs
   */
  private async jsonMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await this.collectAllMetrics();
      
      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      this.logger.error('Failed to generate JSON metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to generate metrics'
      });
    }
  }

  /**
   * Business metrics endpoint
   */
  private async businessMetrics(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.query.tenantId as string;
      const businessMetrics = await this.collectBusinessMetrics(tenantId);
      
      res.json({
        success: true,
        data: businessMetrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('Failed to generate business metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to generate business metrics'
      });
    }
  }

  /**
   * System metrics endpoint
   */
  private async systemMetrics(req: Request, res: Response): Promise<void> {
    try {
      const systemMetrics = await this.collectSystemMetrics();
      
      res.json({
        success: true,
        data: systemMetrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('Failed to generate system metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to generate system metrics'
      });
    }
  }

  /**
   * User metrics for specific tenant
   */
  private async userMetrics(req: Request, res: Response): Promise<void> {
    try {
      const { tenantId } = req.params;
      
      // Validate tenant ID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!uuidRegex.test(tenantId)) {
        res.status(400).json({
          success: false,
          error: 'Invalid tenant ID format'
        });
        return;
      }

      const userMetrics = await this.collectUserMetrics(tenantId);
      
      res.json({
        success: true,
        data: userMetrics,
        tenantId,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('Failed to generate user metrics', {
        tenantId: req.params.tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to generate user metrics'
      });
    }
  }

  /**
   * AI metrics endpoint
   */
  private async aiMetrics(req: Request, res: Response): Promise<void> {
    try {
      const tenantId = req.query.tenantId as string;
      const aiMetrics = await this.collectAIMetrics(tenantId);
      
      res.json({
        success: true,
        data: aiMetrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('Failed to generate AI metrics', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        success: false,
        error: 'Failed to generate AI metrics'
      });
    }
  }

  // Metrics collection methods

  /**
   * Collect all application metrics
   */
  private async collectAllMetrics(): Promise<ApplicationMetrics> {
    const cacheKey = 'all_metrics';
    const cached = this.getCachedMetrics(cacheKey);
    if (cached) {
      return cached;
    }

    const [systemMetrics, businessMetrics] = await Promise.all([
      this.collectSystemMetrics(),
      this.collectBusinessMetrics()
    ]);

    const metrics: ApplicationMetrics = {
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      system: systemMetrics,
      business: businessMetrics
    };

    this.setCachedMetrics(cacheKey, metrics);
    return metrics;
  }

  /**
   * Collect system performance metrics
   */
  private async collectSystemMetrics(): Promise<ApplicationMetrics['system']> {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Simple event loop lag measurement
    const start = process.hrtime.bigint();
    await new Promise(resolve => setImmediate(resolve));
    const lag = Number(process.hrtime.bigint() - start) / 1000000; // Convert to milliseconds

    return {
      memory: {
        rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        heapUsagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100),
        external: Math.round(memoryUsage.external / 1024 / 1024) // MB
      },
      cpu: {
        userTime: Math.round(cpuUsage.user / 1000), // Convert microseconds to milliseconds
        systemTime: Math.round(cpuUsage.system / 1000)
      },
      eventLoop: {
        lag: Math.round(lag * 100) / 100 // Round to 2 decimal places
      }
    };
  }

  /**
   * Collect business metrics
   */
  private async collectBusinessMetrics(tenantId?: string): Promise<ApplicationMetrics['business']> {
    const cacheKey = `business_metrics_${tenantId || 'all'}`;
    const cached = this.getCachedMetrics(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      // Get date ranges
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const thisWeek = new Date(today.getTime() - (7 * 24 * 60 * 60 * 1000));
      const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      // Collect user metrics
      const userMetrics = tenantId ? 
        await this.userRepository.getUserMetricsByTenant(tenantId) :
        await this.collectAggregatedUserMetrics();

      const businessMetrics = {
        users: {
          total: userMetrics.totalUsers,
          active: userMetrics.activeUsers,
          verified: userMetrics.verifiedUsers,
          createdToday: await this.getUsersCreatedSince(today, tenantId),
          createdThisWeek: await this.getUsersCreatedSince(thisWeek, tenantId),
          createdThisMonth: await this.getUsersCreatedSince(thisMonth, tenantId)
        },
        activity: {
          loginsToday: await this.getLoginsToday(tenantId),
          loginsThisWeek: await this.getLoginsThisWeek(tenantId),
          averageSessionDuration: userMetrics.averageSessionDuration,
          topFeatures: userMetrics.topFeatures.slice(0, 10) // Top 10 features
        },
        ai: {
          interactionsToday: await this.getAIInteractionsToday(tenantId),
          interactionsThisWeek: await this.getAIInteractionsThisWeek(tenantId),
          personalizedUsers: await this.getPersonalizedUsersCount(tenantId),
          averageSatisfaction: 0.85 // Placeholder - would come from feedback data
        }
      };

      this.setCachedMetrics(cacheKey, businessMetrics);
      return businessMetrics;
    } catch (error) {
      this.logger.error('Failed to collect business metrics', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      // Return default metrics on error
      return {
        users: { total: 0, active: 0, verified: 0, createdToday: 0, createdThisWeek: 0, createdThisMonth: 0 },
        activity: { loginsToday: 0, loginsThisWeek: 0, averageSessionDuration: 0, topFeatures: [] },
        ai: { interactionsToday: 0, interactionsThisWeek: 0, personalizedUsers: 0, averageSatisfaction: 0 }
      };
    }
  }

  /**
   * Collect user-specific metrics for a tenant
   */
  private async collectUserMetrics(tenantId: string): Promise<any> {
    return await this.userRepository.getUserMetricsByTenant(tenantId);
  }

  /**
   * Collect AI-specific metrics
   */
  private async collectAIMetrics(tenantId?: string): Promise<any> {
    // This would integrate with the AI personalization service
    // For now, return placeholder data
    return {
      modelPerformance: {
        accuracy: 0.85,
        precision: 0.82,
        recall: 0.78,
        f1Score: 0.80
      },
      userSatisfaction: 0.88,
      adoptionRate: 0.65,
      interactionsToday: await this.getAIInteractionsToday(tenantId),
      interactionsThisWeek: await this.getAIInteractionsThisWeek(tenantId),
      personalizedUsers: await this.getPersonalizedUsersCount(tenantId)
    };
  }

  // Helper methods for specific metrics

  private async collectAggregatedUserMetrics(): Promise<any> {
    // This would aggregate metrics across all tenants
    // For now, return placeholder data
    return {
      totalUsers: 1000,
      activeUsers: 850,
      verifiedUsers: 900,
      averageLoginCount: 15,
      averageSessionDuration: 1800,
      topFeatures: [
        { feature: 'dashboard', usage: 500 },
        { feature: 'analytics', usage: 300 },
        { feature: 'settings', usage: 200 }
      ]
    };
  }

  private async getUsersCreatedSince(date: Date, tenantId?: string): Promise<number> {
    try {
      const users = await this.userRepository.search({
        tenantId,
        createdAfter: date,
        limit: 1000 // Reasonable limit for counting
      });
      return users.length;
    } catch (error) {
      this.logger.warn('Failed to get users created since date', {
        date: date.toISOString(),
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  private async getLoginsToday(tenantId?: string): Promise<number> {
    // This would query login events from today
    // Placeholder implementation
    return Math.floor(Math.random() * 100);
  }

  private async getLoginsThisWeek(tenantId?: string): Promise<number> {
    // This would query login events from this week
    // Placeholder implementation
    return Math.floor(Math.random() * 500);
  }

  private async getAIInteractionsToday(tenantId?: string): Promise<number> {
    // This would query AI interaction events from today
    // Placeholder implementation
    return Math.floor(Math.random() * 50);
  }

  private async getAIInteractionsThisWeek(tenantId?: string): Promise<number> {
    // This would query AI interaction events from this week
    // Placeholder implementation
    return Math.floor(Math.random() * 200);
  }

  private async getPersonalizedUsersCount(tenantId?: string): Promise<number> {
    try {
      const users = await this.userRepository.findUsersForAIAnalytics(tenantId, 0, 1000);
      return users.length;
    } catch (error) {
      this.logger.warn('Failed to get personalized users count', {
        tenantId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return 0;
    }
  }

  /**
   * Convert metrics to Prometheus format
   */
  private convertToPrometheusFormat(metrics: ApplicationMetrics): string {
    const lines: string[] = [];
    
    // Add metadata
    lines.push(`# HELP user_service_info Information about the user service`);
    lines.push(`# TYPE user_service_info gauge`);
    lines.push(`user_service_info{version="${metrics.version}",environment="${metrics.environment}"} 1`);
    lines.push('');

    // System metrics
    lines.push(`# HELP user_service_uptime_seconds Uptime of the service in seconds`);
    lines.push(`# TYPE user_service_uptime_seconds counter`);
    lines.push(`user_service_uptime_seconds ${metrics.uptime}`);
    lines.push('');

    lines.push(`# HELP user_service_memory_usage_bytes Memory usage in bytes`);
    lines.push(`# TYPE user_service_memory_usage_bytes gauge`);
    lines.push(`user_service_memory_usage_bytes{type="rss"} ${metrics.system.memory.rss * 1024 * 1024}`);
    lines.push(`user_service_memory_usage_bytes{type="heap_total"} ${metrics.system.memory.heapTotal * 1024 * 1024}`);
    lines.push(`user_service_memory_usage_bytes{type="heap_used"} ${metrics.system.memory.heapUsed * 1024 * 1024}`);
    lines.push('');

    // Business metrics
    lines.push(`# HELP user_service_users_total Total number of users`);
    lines.push(`# TYPE user_service_users_total gauge`);
    lines.push(`user_service_users_total ${metrics.business.users.total}`);
    lines.push('');

    lines.push(`# HELP user_service_users_active Number of active users`);
    lines.push(`# TYPE user_service_users_active gauge`);
    lines.push(`user_service_users_active ${metrics.business.users.active}`);
    lines.push('');

    lines.push(`# HELP user_service_ai_interactions_total Total AI interactions`);
    lines.push(`# TYPE user_service_ai_interactions_total counter`);
    lines.push(`user_service_ai_interactions_total ${metrics.business.ai.interactionsToday}`);
    lines.push('');

    return lines.join('\n');
  }

  // Cache management methods

  private getCachedMetrics(key: string): any {
    const cached = this.metricsCache.get(key);
    if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
      return cached.data;
    }
    return null;
  }

  private setCachedMetrics(key: string, data: any): void {
    this.metricsCache.set(key, {
      data,
      timestamp: Date.now()
    });
  }
}
