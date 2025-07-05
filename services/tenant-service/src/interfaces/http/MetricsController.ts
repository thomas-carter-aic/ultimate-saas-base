/**
 * Metrics Controller for Tenant Service
 * 
 * Provides application metrics endpoints for monitoring and observability.
 */

import { Router, Request, Response } from 'express';
import { TenantRepository } from '../../domain/repositories/TenantRepository';
import { Logger } from '../../application/ports/Logger';

export class MetricsController {
  private router: Router;
  private startTime: number;

  constructor(
    private readonly tenantRepository: TenantRepository,
    private readonly logger: Logger
  ) {
    this.router = Router();
    this.startTime = Date.now();
    this.setupRoutes();
  }

  public getRouter(): Router {
    return this.router;
  }

  private setupRoutes(): void {
    this.router.get('/', this.prometheusMetrics.bind(this));
    this.router.get('/json', this.jsonMetrics.bind(this));
    this.router.get('/tenants', this.tenantMetrics.bind(this));
  }

  private async prometheusMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await this.collectMetrics();
      const prometheusFormat = this.convertToPrometheusFormat(metrics);
      
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(prometheusFormat);
    } catch (error) {
      res.status(500).send('# Error generating metrics\n');
    }
  }

  private async jsonMetrics(req: Request, res: Response): Promise<void> {
    try {
      const metrics = await this.collectMetrics();
      
      res.json({
        success: true,
        data: metrics
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to generate metrics'
      });
    }
  }

  private async tenantMetrics(req: Request, res: Response): Promise<void> {
    try {
      const tenantMetrics = await this.tenantRepository.getTenantMetrics();
      
      res.json({
        success: true,
        data: tenantMetrics,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to generate tenant metrics'
      });
    }
  }

  private async collectMetrics(): Promise<any> {
    const memoryUsage = process.memoryUsage();
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);
    
    // Get tenant metrics
    const tenantMetrics = await this.tenantRepository.getTenantMetrics();

    return {
      timestamp: new Date().toISOString(),
      uptime,
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      system: {
        memory: {
          rss: Math.round(memoryUsage.rss / 1024 / 1024),
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
          heapUsagePercent: Math.round((memoryUsage.heapUsed / memoryUsage.heapTotal) * 100)
        }
      },
      business: {
        tenants: tenantMetrics
      }
    };
  }

  private convertToPrometheusFormat(metrics: any): string {
    const lines: string[] = [];
    
    // Service info
    lines.push(`# HELP tenant_service_info Information about the tenant service`);
    lines.push(`# TYPE tenant_service_info gauge`);
    lines.push(`tenant_service_info{version="${metrics.version}",environment="${metrics.environment}"} 1`);
    lines.push('');

    // Uptime
    lines.push(`# HELP tenant_service_uptime_seconds Uptime of the service in seconds`);
    lines.push(`# TYPE tenant_service_uptime_seconds counter`);
    lines.push(`tenant_service_uptime_seconds ${metrics.uptime}`);
    lines.push('');

    // Memory metrics
    lines.push(`# HELP tenant_service_memory_usage_bytes Memory usage in bytes`);
    lines.push(`# TYPE tenant_service_memory_usage_bytes gauge`);
    lines.push(`tenant_service_memory_usage_bytes{type="heap_used"} ${metrics.system.memory.heapUsed * 1024 * 1024}`);
    lines.push(`tenant_service_memory_usage_bytes{type="heap_total"} ${metrics.system.memory.heapTotal * 1024 * 1024}`);
    lines.push('');

    // Tenant metrics
    lines.push(`# HELP tenant_service_tenants_total Total number of tenants`);
    lines.push(`# TYPE tenant_service_tenants_total gauge`);
    lines.push(`tenant_service_tenants_total ${metrics.business.tenants.totalTenants}`);
    lines.push('');

    lines.push(`# HELP tenant_service_tenants_active Number of active tenants`);
    lines.push(`# TYPE tenant_service_tenants_active gauge`);
    lines.push(`tenant_service_tenants_active ${metrics.business.tenants.activeTenants}`);
    lines.push('');

    return lines.join('\n');
  }
}
