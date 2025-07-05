/**
 * Health Check Controller for Tenant Service
 * 
 * Provides health check endpoints for monitoring and load balancer health checks.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { KafkaEventPublisher } from '../../infrastructure/events/KafkaEventPublisher';
import { Logger } from '../../application/ports/Logger';

export class HealthController {
  private router: Router;
  private startTime: number;

  constructor(
    private readonly dbPool: Pool,
    private readonly eventPublisher: KafkaEventPublisher,
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
    this.router.get('/live', this.livenessCheck.bind(this));
    this.router.get('/ready', this.readinessCheck.bind(this));
    this.router.get('/', this.detailedHealthCheck.bind(this));
  }

  private async livenessCheck(req: Request, res: Response): Promise<void> {
    try {
      const uptime = Date.now() - this.startTime;
      
      res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime / 1000),
        service: 'tenant-service',
        version: process.env.npm_package_version || '1.0.0'
      });
    } catch (error) {
      res.status(500).json({
        status: 'dead',
        timestamp: new Date().toISOString(),
        error: 'Liveness check failed'
      });
    }
  }

  private async readinessCheck(req: Request, res: Response): Promise<void> {
    try {
      const dbCheck = await this.checkDatabase();
      const isReady = dbCheck.status === 'healthy';
      
      const status = {
        status: isReady ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        checks: {
          database: dbCheck
        }
      };

      res.status(isReady ? 200 : 503).json(status);
    } catch (error) {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        error: 'Readiness check failed'
      });
    }
  }

  private async detailedHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const dbCheck = await this.checkDatabase();
      const memoryCheck = this.checkMemory();
      
      const uptime = Date.now() - this.startTime;
      const overallStatus = dbCheck.status === 'healthy' ? 'healthy' : 'unhealthy';

      const healthStatus = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime / 1000),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        checks: {
          database: dbCheck,
          memory: memoryCheck
        }
      };

      res.status(overallStatus === 'healthy' ? 200 : 503).json(healthStatus);

    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed'
      });
    }
  }

  private async checkDatabase(): Promise<any> {
    const startTime = Date.now();
    
    try {
      const client = await this.dbPool.connect();
      
      try {
        await client.query('SELECT NOW()');
        const responseTime = Date.now() - startTime;
        
        return {
          status: responseTime < 1000 ? 'healthy' : 'degraded',
          responseTime,
          message: 'Database connection successful'
        };
      } finally {
        client.release();
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        responseTime: Date.now() - startTime,
        message: 'Database connection failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  private checkMemory(): any {
    const memoryUsage = process.memoryUsage();
    const heapUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
    
    return {
      status: heapUsagePercent < 80 ? 'healthy' : 'degraded',
      heapUsagePercent: Math.round(heapUsagePercent),
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024)
    };
  }
}
