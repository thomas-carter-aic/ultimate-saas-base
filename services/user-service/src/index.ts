/**
 * User Service Main Entry Point
 * 
 * This is the main entry point for the User Service microservice.
 * It sets up the application with dependency injection, configures
 * all infrastructure components, and starts the HTTP server.
 */

import dotenv from 'dotenv';
import { Pool } from 'pg';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { trace, context, SpanStatusCode } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';

// Load environment variables
dotenv.config();

// Import application components
import { PostgreSQLUserRepository } from './infrastructure/repositories/PostgreSQLUserRepository';
import { KafkaEventPublisher } from './infrastructure/events/KafkaEventPublisher';
import { WinstonLogger } from './infrastructure/logging/WinstonLogger';
import { SageMakerAIPersonalizationService } from './infrastructure/ai/SageMakerAIPersonalizationService';
import { CreateUserUseCase } from './application/usecases/CreateUserUseCase';
import { GetUserUseCase } from './application/usecases/GetUserUseCase';
import { UpdateUserUseCase } from './application/usecases/UpdateUserUseCase';
import { ListUsersUseCase } from './application/usecases/ListUsersUseCase';
import { UserController } from './interfaces/http/UserController';
import { HealthController } from './interfaces/http/HealthController';
import { MetricsController } from './interfaces/http/MetricsController';

/**
 * Application configuration interface
 */
interface AppConfig {
  port: number;
  nodeEnv: string;
  database: {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
    ssl: boolean;
    maxConnections: number;
  };
  kafka: {
    clientId: string;
    brokers: string[];
    ssl: boolean;
    sasl?: {
      mechanism: 'plain' | 'scram-sha-256' | 'scram-sha-512';
      username: string;
      password: string;
    };
  };
  aws: {
    region: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  };
  logging: {
    level: string;
    format: 'json' | 'text';
  };
  security: {
    corsOrigins: string[];
    rateLimitWindowMs: number;
    rateLimitMaxRequests: number;
  };
}

/**
 * Load and validate application configuration
 */
function loadConfig(): AppConfig {
  const requiredEnvVars = [
    'DATABASE_HOST',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
    'KAFKA_BROKERS',
    'AWS_REGION'
  ];

  // Check for required environment variables
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Required environment variable ${envVar} is not set`);
    }
  }

  return {
    port: parseInt(process.env.PORT || '3001', 10),
    nodeEnv: process.env.NODE_ENV || 'development',
    database: {
      host: process.env.DATABASE_HOST!,
      port: parseInt(process.env.DATABASE_PORT || '5432', 10),
      database: process.env.DATABASE_NAME!,
      username: process.env.DATABASE_USER!,
      password: process.env.DATABASE_PASSWORD!,
      ssl: process.env.DATABASE_SSL === 'true',
      maxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS || '20', 10)
    },
    kafka: {
      clientId: process.env.KAFKA_CLIENT_ID || 'user-service',
      brokers: process.env.KAFKA_BROKERS!.split(','),
      ssl: process.env.KAFKA_SSL === 'true',
      sasl: process.env.KAFKA_USERNAME ? {
        mechanism: (process.env.KAFKA_SASL_MECHANISM as any) || 'plain',
        username: process.env.KAFKA_USERNAME,
        password: process.env.KAFKA_PASSWORD!
      } : undefined
    },
    aws: {
      region: process.env.AWS_REGION!,
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    logging: {
      level: process.env.LOG_LEVEL || 'info',
      format: (process.env.LOG_FORMAT as 'json' | 'text') || 'json'
    },
    security: {
      corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['http://localhost:3000'],
      rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10), // 15 minutes
      rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100', 10)
    }
  };
}

/**
 * Initialize OpenTelemetry instrumentation
 */
function initializeTracing(): NodeSDK {
  const sdk = new NodeSDK({
    instrumentations: [
      new ExpressInstrumentation({
        requestHook: (span, info) => {
          span.setAttributes({
            'http.request.body.size': info.request.headers['content-length'] || 0,
            'user.tenant_id': info.request.headers['x-tenant-id'] || 'unknown'
          });
        }
      }),
      new PgInstrumentation({
        requestHook: (span, queryConfig) => {
          span.setAttributes({
            'db.statement': queryConfig.text?.substring(0, 100) || 'unknown'
          });
        }
      })
    ]
  });

  sdk.start();
  return sdk;
}

/**
 * Create and configure Express application
 */
function createApp(
  userController: UserController,
  healthController: HealthController,
  metricsController: MetricsController,
  config: AppConfig
): express.Application {
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

  // CORS configuration
  app.use(cors({
    origin: config.security.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-User-ID']
  }));

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Request logging middleware
  app.use((req, res, next) => {
    const tracer = trace.getTracer('user-service');
    const span = tracer.startSpan(`${req.method} ${req.path}`);
    
    context.with(trace.setSpan(context.active(), span), () => {
      span.setAttributes({
        'http.method': req.method,
        'http.url': req.url,
        'http.user_agent': req.headers['user-agent'] || 'unknown',
        'tenant.id': req.headers['x-tenant-id'] || 'unknown'
      });

      res.on('finish', () => {
        span.setAttributes({
          'http.status_code': res.statusCode,
          'http.response.size': res.get('content-length') || 0
        });
        
        if (res.statusCode >= 400) {
          span.setStatus({ code: SpanStatusCode.ERROR });
        }
        
        span.end();
      });

      next();
    });
  });

  // Health check routes
  app.use('/health', healthController.getRouter());

  // Metrics routes
  app.use('/metrics', metricsController.getRouter());

  // API routes
  app.use('/api/v1/users', userController.getRouter());

  // Global error handler
  app.use((error: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    const tracer = trace.getTracer('user-service');
    const span = trace.getActiveSpan();
    
    if (span) {
      span.recordException(error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    }

    console.error('Unhandled error:', error);

    res.status(500).json({
      error: 'Internal server error',
      message: config.nodeEnv === 'development' ? error.message : 'Something went wrong',
      requestId: req.headers['x-request-id'] || 'unknown'
    });
  });

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'Not found',
      message: `Route ${req.method} ${req.originalUrl} not found`
    });
  });

  return app;
}

/**
 * Initialize database connection pool
 */
function createDatabasePool(config: AppConfig): Pool {
  return new Pool({
    host: config.database.host,
    port: config.database.port,
    database: config.database.database,
    user: config.database.username,
    password: config.database.password,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false,
    max: config.database.maxConnections,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });
}

/**
 * Main application bootstrap function
 */
async function bootstrap(): Promise<void> {
  try {
    // Load configuration
    const config = loadConfig();
    
    // Initialize tracing
    const sdk = initializeTracing();
    
    console.log('Starting User Service...');
    console.log(`Environment: ${config.nodeEnv}`);
    console.log(`Port: ${config.port}`);

    // Initialize logger
    const logger = new WinstonLogger({
      level: config.logging.level as any,
      format: config.logging.format,
      destination: 'console',
      enableTracing: true,
      enableMetrics: true
    });

    // Initialize database connection
    const dbPool = createDatabasePool(config);
    
    // Test database connection
    try {
      const client = await dbPool.connect();
      await client.query('SELECT NOW()');
      client.release();
      logger.info('Database connection established successfully');
    } catch (error) {
      logger.error('Failed to connect to database', { error });
      throw error;
    }

    // Initialize Kafka event publisher
    const eventPublisher = new KafkaEventPublisher(config.kafka, logger);
    await eventPublisher.connect();

    // Initialize AI personalization service
    const aiPersonalizationService = new SageMakerAIPersonalizationService(
      config.aws,
      logger
    );

    // Initialize repositories
    const userRepository = new PostgreSQLUserRepository(dbPool, logger);

    // Initialize use cases
    const createUserUseCase = new CreateUserUseCase(
      userRepository,
      eventPublisher,
      logger,
      aiPersonalizationService
    );

    const getUserUseCase = new GetUserUseCase(
      userRepository,
      logger
    );

    const updateUserUseCase = new UpdateUserUseCase(
      userRepository,
      eventPublisher,
      logger
    );

    const listUsersUseCase = new ListUsersUseCase(
      userRepository,
      logger
    );

    // Initialize controllers
    const userController = new UserController(
      createUserUseCase,
      getUserUseCase,
      updateUserUseCase,
      listUsersUseCase,
      logger
    );
    
    const healthController = new HealthController(dbPool, eventPublisher, logger);
    const metricsController = new MetricsController(userRepository, logger);

    // Create Express application
    const app = createApp(userController, healthController, metricsController, config);

    // Start HTTP server
    const server = app.listen(config.port, () => {
      logger.info('User Service started successfully', {
        port: config.port,
        environment: config.nodeEnv,
        version: process.env.npm_package_version || '1.0.0'
      });
    });

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      logger.info(`Received ${signal}, starting graceful shutdown...`);
      
      // Stop accepting new connections
      server.close(async () => {
        try {
          // Close database connections
          await dbPool.end();
          logger.info('Database connections closed');

          // Disconnect Kafka producer
          await eventPublisher.disconnect();
          logger.info('Kafka producer disconnected');

          // Stop OpenTelemetry SDK
          await sdk.shutdown();
          logger.info('OpenTelemetry SDK stopped');

          logger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during graceful shutdown', { error });
          process.exit(1);
        }
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    // Register shutdown handlers
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.fatal('Uncaught exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal('Unhandled promise rejection', { reason, promise });
      process.exit(1);
    });

  } catch (error) {
    console.error('Failed to start User Service:', error);
    process.exit(1);
  }
}

// Start the application
if (require.main === module) {
  bootstrap();
}

export { bootstrap };
