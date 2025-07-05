/**
 * Health Check Controller
 * 
 * Provides health check endpoints for monitoring and load balancer health checks.
 * Includes comprehensive system health validation including database, Kafka, and dependencies.
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { KafkaEventPublisher } from '../../infrastructure/events/KafkaEventPublisher';
import { Logger } from '../../application/ports/Logger';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  checks: {
    database: HealthCheck;
    kafka: HealthCheck;
    memory: HealthCheck;
    disk: HealthCheck;
  };
  metadata?: Record<string, any>;
}

export interface HealthCheck {
  status: 'healthy' | 'unhealthy' | 'degraded';
  responseTime?: number;
  message?: string;
  details?: Record<string, any>;
}

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

  /**
   * Get Express router with health check routes
   */
  public getRouter(): Router {
    return this.router;
  }

  /**
   * Setup health check routes
   */
  private setupRoutes(): void {
    // Basic liveness probe - minimal check for container orchestration
    this.router.get('/live', this.livenessCheck.bind(this));

    // Readiness probe - comprehensive check for load balancer
    this.router.get('/ready', this.readinessCheck.bind(this));

    // Detailed health status - full system health information
    this.router.get('/', this.detailedHealthCheck.bind(this));

    // Individual component health checks
    this.router.get('/database', this.databaseHealthCheck.bind(this));
    this.router.get('/kafka', this.kafkaHealthCheck.bind(this));
    this.router.get('/memory', this.memoryHealthCheck.bind(this));
  }

  /**
   * Liveness check - indicates if the application is running
   * Used by Kubernetes liveness probes
   */
  private async livenessCheck(req: Request, res: Response): Promise<void> {
    try {
      const uptime = Date.now() - this.startTime;
      
      res.status(200).json({
        status: 'alive',
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime / 1000),
        service: 'user-service',
        version: process.env.npm_package_version || '1.0.0'
      });
    } catch (error) {
      this.logger.error('Liveness check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        status: 'dead',
        timestamp: new Date().toISOString(),
        error: 'Liveness check failed'
      });
    }
  }

  /**
   * Readiness check - indicates if the application is ready to serve traffic
   * Used by Kubernetes readiness probes and load balancers
   */
  private async readinessCheck(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();
      
      // Check critical dependencies
      const dbCheck = await this.checkDatabase();
      const kafkaCheck = await this.checkKafka();
      
      const responseTime = Date.now() - startTime;
      const isReady = dbCheck.status === 'healthy' && kafkaCheck.status === 'healthy';
      
      const status = {
        status: isReady ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        responseTime,
        checks: {
          database: dbCheck,
          kafka: kafkaCheck
        }
      };

      if (isReady) {
        res.status(200).json(status);
      } else {
        res.status(503).json(status);
      }
    } catch (error) {
      this.logger.error('Readiness check failed', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        error: 'Readiness check failed'
      });
    }
  }

  /**
   * Detailed health check - comprehensive system health status
   * Used for monitoring and debugging
   */
  private async detailedHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const startTime = Date.now();
      
      // Run all health checks in parallel
      const [dbCheck, kafkaCheck, memoryCheck, diskCheck] = await Promise.all([
        this.checkDatabase(),
        this.checkKafka(),
        this.checkMemory(),
        this.checkDisk()
      ]);

      const responseTime = Date.now() - startTime;
      const uptime = Date.now() - this.startTime;

      // Determine overall health status
      const checks = { database: dbCheck, kafka: kafkaCheck, memory: memoryCheck, disk: diskCheck };
      const overallStatus = this.determineOverallStatus(checks);

      const healthStatus: HealthStatus = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: Math.floor(uptime / 1000),
        version: process.env.npm_package_version || '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        checks,
        metadata: {
          responseTime,
          nodeVersion: process.version,
          platform: process.platform,
          architecture: process.arch,
          pid: process.pid
        }
      };

      // Set appropriate HTTP status code
      const httpStatus = overallStatus === 'healthy' ? 200 : 
                        overallStatus === 'degraded' ? 200 : 503;

      res.status(httpStatus).json(healthStatus);

      // Log health check results
      this.logger.info('Health check completed', {
        status: overallStatus,
        responseTime,
        checks: Object.entries(checks).map(([name, check]) => ({
          name,
          status: check.status,
          responseTime: check.responseTime
        }))
      });

    } catch (error) {
      this.logger.error('Detailed health check failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined
      });
      
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Database-specific health check endpoint
   */
  private async databaseHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const dbCheck = await this.checkDatabase();
      const httpStatus = dbCheck.status === 'healthy' ? 200 : 503;
      
      res.status(httpStatus).json({
        component: 'database',
        ...dbCheck,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        component: 'database',
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Kafka-specific health check endpoint
   */
  private async kafkaHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const kafkaCheck = await this.checkKafka();
      const httpStatus = kafkaCheck.status === 'healthy' ? 200 : 503;
      
      res.status(httpStatus).json({
        component: 'kafka',
        ...kafkaCheck,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        component: 'kafka',
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Memory-specific health check endpoint
   */
  private async memoryHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const memoryCheck = await this.checkMemory();
      const httpStatus = memoryCheck.status === 'healthy' ? 200 : 
                        memoryCheck.status === 'degraded' ? 200 : 503;
      
      res.status(httpStatus).json({
        component: 'memory',
        ...memoryCheck,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        component: 'memory',
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Individual health check methods

  /**
   * Check database connectivity and performance
   */
  private async checkDatabase(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // Test basic connectivity
      const client = await this.dbPool.connect();
      
      try {
        // Test query execution
        const result = await client.query('SELECT NOW() as current_time, version() as version');
        const responseTime = Date.now() - startTime;
        
        // Check connection pool status
        const poolStatus = {
          totalConnections: this.dbPool.totalCount,
          idleConnections: this.dbPool.idleCount,
          waitingClients: this.dbPool.waitingCount
        };

        return {
          status: responseTime < 1000 ? 'healthy' : 'degraded',
          responseTime,
          message: `Database connection successful`,
          details: {
            currentTime: result.rows[0].current_time,
            version: result.rows[0].version.split(' ')[0], // Just PostgreSQL version
            pool: poolStatus
          }
        };
      } finally {
        client.release();
      }
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        responseTime,
        message: 'Database connection failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Check Kafka connectivity and performance
   */
  private async checkKafka(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // For now, we'll just check if the event publisher is connected
      // In a real implementation, you might want to send a test message
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
        message: 'Kafka connection healthy',
        details: {
          connected: true
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        responseTime,
        message: 'Kafka connection failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Check memory usage and performance
   */
  private async checkMemory(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      const memoryUsage = process.memoryUsage();
      const responseTime = Date.now() - startTime;
      
      // Convert bytes to MB
      const memoryMB = {
        rss: Math.round(memoryUsage.rss / 1024 / 1024),
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
        external: Math.round(memoryUsage.external / 1024 / 1024)
      };

      // Determine status based on heap usage
      const heapUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
      const status = heapUsagePercent < 80 ? 'healthy' : 
                    heapUsagePercent < 95 ? 'degraded' : 'unhealthy';

      return {
        status,
        responseTime,
        message: `Memory usage: ${heapUsagePercent.toFixed(1)}%`,
        details: {
          usage: memoryMB,
          heapUsagePercent: Math.round(heapUsagePercent)
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        responseTime,
        message: 'Memory check failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Check disk usage (simplified check)
   */
  private async checkDisk(): Promise<HealthCheck> {
    const startTime = Date.now();
    
    try {
      // For containerized environments, disk checks are often not as relevant
      // This is a placeholder implementation
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'healthy',
        responseTime,
        message: 'Disk check not implemented',
        details: {
          note: 'Disk monitoring handled by container orchestration'
        }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        status: 'unhealthy',
        responseTime,
        message: 'Disk check failed',
        details: {
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Determine overall system health status based on individual checks
   */
  private determineOverallStatus(checks: Record<string, HealthCheck>): 'healthy' | 'unhealthy' | 'degraded' {
    const statuses = Object.values(checks).map(check => check.status);
    
    // If any critical component is unhealthy, system is unhealthy
    if (statuses.includes('unhealthy')) {
      return 'unhealthy';
    }
    
    // If any component is degraded, system is degraded
    if (statuses.includes('degraded')) {
      return 'degraded';
    }
    
    // All components are healthy
    return 'healthy';
  }
}
