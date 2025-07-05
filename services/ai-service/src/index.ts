import 'reflect-metadata';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { config } from 'dotenv';
import { Logger } from '../shared/infrastructure/logging/Logger';
import { MetricsCollector } from '../shared/infrastructure/monitoring/MetricsCollector';
import { DatabaseConnection } from '../shared/infrastructure/database/DatabaseConnection';
import { CacheManager } from '../shared/infrastructure/cache/CacheManager';
import { EventPublisher } from '../shared/infrastructure/events/EventPublisher';

// Import AI Service components
import { MLModelRepository } from './infrastructure/repositories/MLModelRepository';
import { TensorFlowInferenceService } from './infrastructure/inference/TensorFlowInferenceService';
import { PyTorchInferenceService } from './infrastructure/inference/PyTorchInferenceService';
import { KubernetesService } from './infrastructure/deployment/KubernetesService';

// Import use cases
import { TrainModelUseCase } from './application/usecases/TrainModelUseCase';
import { PredictUseCase } from './application/usecases/PredictUseCase';
import { DeployModelUseCase } from './application/usecases/DeployModelUseCase';

// Import controllers and routes
import { MLModelController } from './interfaces/http/controllers/MLModelController';
import { createMLModelRoutes } from './interfaces/http/routes/mlModelRoutes';

// Import middleware
import { handleUploadError } from './interfaces/http/middleware/uploadMiddleware';

// Load environment variables
config();

class AIServiceApplication {
  private app: express.Application;
  private logger: Logger;
  private metrics: MetricsCollector;
  private db: DatabaseConnection;
  private cache: CacheManager;
  private eventPublisher: EventPublisher;
  private server: any;

  constructor() {
    this.app = express();
    this.logger = new Logger('AIService');
    this.metrics = new MetricsCollector();
    
    // Initialize infrastructure components
    this.initializeInfrastructure();
  }

  private async initializeInfrastructure(): Promise<void> {
    try {
      // Initialize database connection
      this.db = new DatabaseConnection({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'ai_service',
        username: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'password'
      });

      // Initialize cache manager
      this.cache = new CacheManager({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD
      });

      // Initialize event publisher
      this.eventPublisher = new EventPublisher({
        brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
        clientId: 'ai-service',
        groupId: 'ai-service-group'
      });

      this.logger.info('Infrastructure components initialized');

    } catch (error) {
      this.logger.error('Failed to initialize infrastructure', { error: error.message });
      throw error;
    }
  }

  private setupMiddleware(): void {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'"],
          imgSrc: ["'self'", "data:", "https:"],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true
      }
    }));

    // CORS configuration
    this.app.use(cors({
      origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID']
    }));

    // Compression
    this.app.use(compression());

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      const startTime = Date.now();
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        
        this.logger.info('HTTP Request', {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          userAgent: req.headers['user-agent'],
          tenantId: req.headers['x-tenant-id']
        });

        this.metrics.recordHistogram('http_request_duration_ms', duration, {
          method: req.method,
          path: req.path,
          status_code: res.statusCode.toString()
        });
      });

      next();
    });

    this.logger.info('Middleware configured');
  }

  private async setupRoutes(): Promise<void> {
    try {
      // Initialize services
      const modelRepository = new MLModelRepository(
        this.db,
        this.cache,
        this.logger,
        this.eventPublisher
      );

      const tensorflowService = new TensorFlowInferenceService(
        {},
        this.logger,
        this.metrics,
        this.cache
      );

      const pytorchService = new PyTorchInferenceService(
        {},
        this.logger,
        this.metrics,
        this.cache
      );

      const kubernetesService = new KubernetesService(
        {},
        this.logger,
        this.metrics
      );

      // Initialize use cases
      const trainModelUseCase = new TrainModelUseCase(
        modelRepository,
        this.logger,
        this.eventPublisher,
        this.metrics
      );

      const predictUseCase = new PredictUseCase(
        modelRepository,
        tensorflowService,
        pytorchService,
        this.logger,
        this.metrics
      );

      const deployModelUseCase = new DeployModelUseCase(
        modelRepository,
        tensorflowService,
        pytorchService,
        kubernetesService,
        this.logger,
        this.eventPublisher,
        this.metrics
      );

      // Initialize controller
      const mlModelController = new MLModelController(
        trainModelUseCase,
        predictUseCase,
        deployModelUseCase,
        modelRepository,
        this.logger,
        this.metrics
      );

      // Setup routes
      this.app.use('/api/v1/ai', createMLModelRoutes(mlModelController));

      // Health check endpoint
      this.app.get('/health', (req, res) => {
        res.json({
          status: 'healthy',
          timestamp: new Date().toISOString(),
          service: 'ai-service',
          version: process.env.SERVICE_VERSION || '1.0.0'
        });
      });

      // Metrics endpoint
      this.app.get('/metrics', async (req, res) => {
        try {
          const metrics = await this.metrics.getMetrics();
          res.set('Content-Type', 'text/plain');
          res.send(metrics);
        } catch (error) {
          res.status(500).json({ error: 'Failed to get metrics' });
        }
      });

      this.logger.info('Routes configured');

    } catch (error) {
      this.logger.error('Failed to setup routes', { error: error.message });
      throw error;
    }
  }

  private setupErrorHandling(): void {
    // Handle multer upload errors
    this.app.use(handleUploadError);

    // Global error handler
    this.app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      this.logger.error('Unhandled error', {
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method
      });

      this.metrics.incrementCounter('ai_service_errors_total', {
        error_type: error.constructor.name,
        path: req.path,
        method: req.method
      });

      const statusCode = error.statusCode || 500;
      const message = error.message || 'Internal server error';

      res.status(statusCode).json({
        success: false,
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
      });
    });

    // 404 handler
    this.app.use((req: express.Request, res: express.Response) => {
      res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
      });
    });

    this.logger.info('Error handling configured');
  }

  private setupGracefulShutdown(): void {
    const gracefulShutdown = async (signal: string) => {
      this.logger.info(`Received ${signal}, starting graceful shutdown`);

      // Stop accepting new requests
      if (this.server) {
        this.server.close(async () => {
          this.logger.info('HTTP server closed');

          try {
            // Close database connections
            await this.db.close();
            this.logger.info('Database connections closed');

            // Close cache connections
            await this.cache.close();
            this.logger.info('Cache connections closed');

            // Close event publisher
            await this.eventPublisher.close();
            this.logger.info('Event publisher closed');

            this.logger.info('Graceful shutdown completed');
            process.exit(0);

          } catch (error) {
            this.logger.error('Error during graceful shutdown', { error: error.message });
            process.exit(1);
          }
        });
      }

      // Force shutdown after timeout
      setTimeout(() => {
        this.logger.error('Graceful shutdown timeout, forcing exit');
        process.exit(1);
      }, 30000); // 30 seconds timeout
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
  }

  public async start(): Promise<void> {
    try {
      // Setup application components
      this.setupMiddleware();
      await this.setupRoutes();
      this.setupErrorHandling();
      this.setupGracefulShutdown();

      // Start server
      const port = parseInt(process.env.PORT || '3004');
      const host = process.env.HOST || '0.0.0.0';

      this.server = this.app.listen(port, host, () => {
        this.logger.info('AI Service started successfully', {
          port,
          host,
          environment: process.env.NODE_ENV || 'development',
          version: process.env.SERVICE_VERSION || '1.0.0'
        });
      });

      // Handle server errors
      this.server.on('error', (error: any) => {
        this.logger.error('Server error', { error: error.message });
        process.exit(1);
      });

    } catch (error) {
      this.logger.error('Failed to start AI Service', { error: error.message });
      process.exit(1);
    }
  }
}

// Start the application
const aiService = new AIServiceApplication();
aiService.start().catch((error) => {
  console.error('Failed to start AI Service:', error);
  process.exit(1);
});

export default AIServiceApplication;
