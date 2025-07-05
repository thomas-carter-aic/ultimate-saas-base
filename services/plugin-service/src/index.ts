/**
 * Plugin Service Main Entry Point
 * 
 * Initializes and starts the plugin service with all dependencies.
 * Implements clean architecture with dependency injection and secure plugin execution.
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { Pool } from 'pg';
import { Kafka } from 'kafkajs';
import { createClient } from 'redis';

// Application Layer
import { UploadPluginUseCase } from './application/usecases/UploadPluginUseCase';
import { ExecutePluginUseCase } from './application/usecases/ExecutePluginUseCase';

// Infrastructure Layer
import { PostgreSQLPluginRepository } from './infrastructure/repositories/PostgreSQLPluginRepository';
import { KafkaEventPublisher } from './infrastructure/events/KafkaEventPublisher';
import { WinstonLogger } from './infrastructure/logging/WinstonLogger';
import { S3FileStorage } from './infrastructure/storage/S3FileStorage';
import { IsolatedVMSandbox } from './infrastructure/sandbox/IsolatedVMSandbox';

// Interface Layer
import { PluginController } from './interfaces/http/PluginController';
import { HealthController } from './interfaces/http/HealthController';
import { MetricsController } from './interfaces/http/MetricsController';

// Configuration
const config = {
  port: parseInt(process.env.PORT || '3003'),
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'plugin_service',
    username: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    ssl: process.env.DB_SSL === 'true'
  },
  kafka: {
    brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
    clientId: 'plugin-service',
    groupId: 'plugin-service-group'
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD
  },
  s3: {
    region: process.env.AWS_REGION || 'us-east-1',
    bucket: process.env.S3_BUCKET || 'plugin-storage',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
};

async function createApp() {
  // Initialize logger
  const logger = new WinstonLogger();
  logger.info('Starting Plugin Service', { config: { ...config, database: { ...config.database, password: '***' } } });

  // Initialize database connection
  const dbPool = new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.username,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000
  });

  // Test database connection
  try {
    await dbPool.query('SELECT NOW()');
    logger.info('Database connection established');
  } catch (error) {
    logger.error('Failed to connect to database', error as Error);
    process.exit(1);
  }

  // Initialize Kafka
  const kafka = new Kafka({
    clientId: config.kafka.clientId,
    brokers: config.kafka.brokers
  });

  const kafkaProducer = kafka.producer();
  await kafkaProducer.connect();
  logger.info('Kafka producer connected');

  // Initialize Redis
  const redisClient = createClient({
    socket: {
      host: config.redis.host,
      port: config.redis.port
    },
    password: config.redis.password
  });

  await redisClient.connect();
  logger.info('Redis connection established');

  // Initialize repositories and services
  const pluginRepository = new PostgreSQLPluginRepository(dbPool, logger);
  const eventPublisher = new KafkaEventPublisher(kafkaProducer, logger);
  const fileStorage = new S3FileStorage(config.s3, logger);
  const pluginSandbox = new IsolatedVMSandbox(logger);

  // Initialize use cases
  const uploadPluginUseCase = new UploadPluginUseCase(
    pluginRepository,
    eventPublisher,
    fileStorage,
    logger
  );

  const executePluginUseCase = new ExecutePluginUseCase(
    pluginRepository,
    eventPublisher,
    pluginSandbox,
    fileStorage,
    logger
  );

  // Initialize controllers
  const pluginController = new PluginController(
    uploadPluginUseCase,
    executePluginUseCase,
    pluginRepository,
    logger
  );

  const healthController = new HealthController(dbPool, kafkaProducer, redisClient, logger);
  const metricsController = new MetricsController();

  // Create Express app
  const app = express();

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https:"]
      }
    }
  }));

  app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
    credentials: true
  }));

  app.use(compression());

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging middleware
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info('HTTP Request', {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        duration: `${duration}ms`,
        userAgent: req.get('User-Agent'),
        ip: req.ip
      });
    });
    next();
  });

  // Health check endpoints
  app.get('/health', healthController.getHealth.bind(healthController));
  app.get('/health/ready', healthController.getReadiness.bind(healthController));
  app.get('/health/live', healthController.getLiveness.bind(healthController));

  // Metrics endpoint
  app.get('/metrics', metricsController.getMetrics.bind(metricsController));

  // API routes
  app.use('/api/v1/plugins', pluginController.getRouter());

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      success: false,
      error: 'Endpoint not found',
      path: req.originalUrl,
      method: req.method
    });
  });

  // Global error handler
  app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    logger.error('Unhandled error', error, {
      url: req.url,
      method: req.method,
      body: req.body
    });

    res.status(500).json({
      success: false,
      error: 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { details: error.message })
    });
  });

  return { 
    app, 
    cleanup: async () => {
      await kafkaProducer.disconnect();
      await dbPool.end();
      await redisClient.disconnect();
      await pluginSandbox.cleanup();
    }
  };
}

async function startServer() {
  try {
    const { app, cleanup } = await createApp();

    const server = app.listen(config.port, () => {
      console.log(`🔌 Plugin Service running on port ${config.port}`);
      console.log(`📊 Health check: http://localhost:${config.port}/health`);
      console.log(`📈 Metrics: http://localhost:${config.port}/metrics`);
      console.log(`🔗 API: http://localhost:${config.port}/api/v1/plugins`);
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal: string) => {
      console.log(`\n${signal} received. Starting graceful shutdown...`);
      
      server.close(async () => {
        console.log('HTTP server closed');
        
        try {
          await cleanup();
          console.log('Cleanup completed');
          process.exit(0);
        } catch (error) {
          console.error('Error during cleanup:', error);
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        console.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Start the server if this file is run directly
if (require.main === module) {
  startServer();
}

export { createApp, config };
