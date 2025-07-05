import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { Logger } from '../../../../shared/infrastructure/logging/Logger';
import { MetricsCollector } from '../../../../shared/infrastructure/monitoring/MetricsCollector';

const logger = new Logger('RateLimitMiddleware');
const metrics = new MetricsCollector();

// General API rate limiting
export const rateLimitMiddleware = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    success: false,
    error: 'Too many requests from this IP, please try again later',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    
    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      tenantId,
      path: req.path,
      method: req.method
    });

    metrics.incrementCounter('ai_service_rate_limit_exceeded_total', {
      tenant_id: tenantId || 'unknown',
      path: req.path,
      method: req.method
    });

    res.status(429).json({
      success: false,
      error: 'Too many requests from this IP, please try again later',
      retryAfter: '15 minutes'
    });
  }
});

// Stricter rate limiting for inference endpoints
export const inferenceRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100, // Limit each IP to 100 inference requests per minute
  message: {
    success: false,
    error: 'Too many inference requests, please try again later',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Rate limit by tenant ID instead of IP for inference
    return req.headers['x-tenant-id'] as string || req.ip;
  },
  handler: (req: Request, res: Response) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    
    logger.warn('Inference rate limit exceeded', {
      tenantId,
      path: req.path,
      method: req.method
    });

    metrics.incrementCounter('ai_service_inference_rate_limit_exceeded_total', {
      tenant_id: tenantId || 'unknown'
    });

    res.status(429).json({
      success: false,
      error: 'Too many inference requests, please try again later',
      retryAfter: '1 minute'
    });
  }
});

// Rate limiting for training endpoints (more restrictive)
export const trainingRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit each tenant to 10 training jobs per hour
  message: {
    success: false,
    error: 'Too many training requests, please try again later',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.headers['x-tenant-id'] as string || req.ip;
  },
  handler: (req: Request, res: Response) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    
    logger.warn('Training rate limit exceeded', {
      tenantId,
      path: req.path,
      method: req.method
    });

    metrics.incrementCounter('ai_service_training_rate_limit_exceeded_total', {
      tenant_id: tenantId || 'unknown'
    });

    res.status(429).json({
      success: false,
      error: 'Too many training requests, please try again later',
      retryAfter: '1 hour'
    });
  }
});

// Rate limiting for deployment endpoints
export const deploymentRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // Limit each tenant to 5 deployments per hour
  message: {
    success: false,
    error: 'Too many deployment requests, please try again later',
    retryAfter: '1 hour'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.headers['x-tenant-id'] as string || req.ip;
  },
  handler: (req: Request, res: Response) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    
    logger.warn('Deployment rate limit exceeded', {
      tenantId,
      path: req.path,
      method: req.method
    });

    metrics.incrementCounter('ai_service_deployment_rate_limit_exceeded_total', {
      tenant_id: tenantId || 'unknown'
    });

    res.status(429).json({
      success: false,
      error: 'Too many deployment requests, please try again later',
      retryAfter: '1 hour'
    });
  }
});

// Burst rate limiting for batch operations
export const batchRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Limit each tenant to 20 batch operations per 5 minutes
  message: {
    success: false,
    error: 'Too many batch requests, please try again later',
    retryAfter: '5 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    return req.headers['x-tenant-id'] as string || req.ip;
  },
  handler: (req: Request, res: Response) => {
    const tenantId = req.headers['x-tenant-id'] as string;
    
    logger.warn('Batch rate limit exceeded', {
      tenantId,
      path: req.path,
      method: req.method
    });

    metrics.incrementCounter('ai_service_batch_rate_limit_exceeded_total', {
      tenant_id: tenantId || 'unknown'
    });

    res.status(429).json({
      success: false,
      error: 'Too many batch requests, please try again later',
      retryAfter: '5 minutes'
    });
  }
});
