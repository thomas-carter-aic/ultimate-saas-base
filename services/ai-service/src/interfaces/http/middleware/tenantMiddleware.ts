import { Request, Response, NextFunction } from 'express';
import { Logger } from '../../../../shared/infrastructure/logging/Logger';
import { MetricsCollector } from '../../../../shared/infrastructure/monitoring/MetricsCollector';

const logger = new Logger('TenantMiddleware');
const metrics = new MetricsCollector();

interface TenantRequest extends Request {
  tenant?: {
    id: string;
    name: string;
    plan: string;
    limits: {
      maxModels: number;
      maxTrainingJobs: number;
      maxDeployments: number;
      maxPredictionsPerMonth: number;
    };
    usage: {
      currentModels: number;
      currentTrainingJobs: number;
      currentDeployments: number;
      predictionsThisMonth: number;
    };
  };
}

export const tenantMiddleware = async (req: TenantRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skip for health check
    if (req.path === '/health') {
      return next();
    }

    const tenantId = req.headers['x-tenant-id'] as string;
    
    if (!tenantId) {
      res.status(400).json({
        success: false,
        error: 'Tenant ID is required'
      });
      return;
    }

    // Validate tenant ID format (UUID)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(tenantId)) {
      res.status(400).json({
        success: false,
        error: 'Invalid tenant ID format'
      });
      return;
    }

    // TODO: Fetch tenant information from tenant service
    // For now, we'll use a mock implementation
    const tenant = await fetchTenantInfo(tenantId);
    
    if (!tenant) {
      res.status(404).json({
        success: false,
        error: 'Tenant not found'
      });
      return;
    }

    // Check if tenant is active
    if (tenant.status !== 'active') {
      res.status(403).json({
        success: false,
        error: 'Tenant account is not active',
        status: tenant.status
      });
      return;
    }

    // Attach tenant info to request
    req.tenant = {
      id: tenant.id,
      name: tenant.name,
      plan: tenant.plan,
      limits: tenant.limits,
      usage: tenant.usage
    };

    // Record tenant activity metrics
    metrics.incrementCounter('ai_service_tenant_requests_total', {
      tenant_id: tenantId,
      tenant_plan: tenant.plan,
      path: req.path,
      method: req.method
    });

    next();

  } catch (error) {
    logger.error('Tenant middleware error', {
      tenantId: req.headers['x-tenant-id'],
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Tenant validation service error'
    });
  }
};

// Middleware to check tenant resource limits
export const checkTenantLimits = (resourceType: 'models' | 'training' | 'deployments' | 'predictions') => {
  return (req: TenantRequest, res: Response, next: NextFunction): void => {
    if (!req.tenant) {
      res.status(400).json({
        success: false,
        error: 'Tenant information not available'
      });
      return;
    }

    const { limits, usage } = req.tenant;
    let limitExceeded = false;
    let limitMessage = '';

    switch (resourceType) {
      case 'models':
        if (usage.currentModels >= limits.maxModels) {
          limitExceeded = true;
          limitMessage = `Model limit exceeded (${usage.currentModels}/${limits.maxModels})`;
        }
        break;

      case 'training':
        if (usage.currentTrainingJobs >= limits.maxTrainingJobs) {
          limitExceeded = true;
          limitMessage = `Training job limit exceeded (${usage.currentTrainingJobs}/${limits.maxTrainingJobs})`;
        }
        break;

      case 'deployments':
        if (usage.currentDeployments >= limits.maxDeployments) {
          limitExceeded = true;
          limitMessage = `Deployment limit exceeded (${usage.currentDeployments}/${limits.maxDeployments})`;
        }
        break;

      case 'predictions':
        if (usage.predictionsThisMonth >= limits.maxPredictionsPerMonth) {
          limitExceeded = true;
          limitMessage = `Monthly prediction limit exceeded (${usage.predictionsThisMonth}/${limits.maxPredictionsPerMonth})`;
        }
        break;
    }

    if (limitExceeded) {
      logger.warn('Tenant resource limit exceeded', {
        tenantId: req.tenant.id,
        resourceType,
        limits,
        usage
      });

      metrics.incrementCounter('ai_service_tenant_limit_exceeded_total', {
        tenant_id: req.tenant.id,
        tenant_plan: req.tenant.plan,
        resource_type: resourceType
      });

      res.status(429).json({
        success: false,
        error: limitMessage,
        limits,
        usage,
        upgradeUrl: `/billing/upgrade?tenant=${req.tenant.id}`
      });
      return;
    }

    next();
  };
};

// Mock function to fetch tenant information
// In production, this would call the tenant service
async function fetchTenantInfo(tenantId: string): Promise<any> {
  // Mock tenant data based on plan
  const mockTenants = {
    'starter': {
      limits: {
        maxModels: 5,
        maxTrainingJobs: 2,
        maxDeployments: 2,
        maxPredictionsPerMonth: 10000
      }
    },
    'professional': {
      limits: {
        maxModels: 25,
        maxTrainingJobs: 10,
        maxDeployments: 10,
        maxPredictionsPerMonth: 100000
      }
    },
    'enterprise': {
      limits: {
        maxModels: 100,
        maxTrainingJobs: 50,
        maxDeployments: 50,
        maxPredictionsPerMonth: 1000000
      }
    }
  };

  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 10));

  // Mock response - in production this would be a real API call
  const plan = 'professional'; // This would come from the tenant service
  
  return {
    id: tenantId,
    name: `Tenant ${tenantId.substring(0, 8)}`,
    status: 'active',
    plan,
    limits: mockTenants[plan].limits,
    usage: {
      currentModels: Math.floor(Math.random() * mockTenants[plan].limits.maxModels),
      currentTrainingJobs: Math.floor(Math.random() * mockTenants[plan].limits.maxTrainingJobs),
      currentDeployments: Math.floor(Math.random() * mockTenants[plan].limits.maxDeployments),
      predictionsThisMonth: Math.floor(Math.random() * mockTenants[plan].limits.maxPredictionsPerMonth)
    }
  };
}

// Middleware to log tenant activity
export const tenantActivityLogger = (req: TenantRequest, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Override res.end to capture response
  const originalEnd = res.end;
  res.end = function(chunk?: any, encoding?: any) {
    const duration = Date.now() - startTime;
    
    if (req.tenant) {
      logger.info('Tenant API activity', {
        tenantId: req.tenant.id,
        tenantPlan: req.tenant.plan,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: req.headers['user-agent']
      });

      metrics.recordHistogram('ai_service_tenant_request_duration_ms', duration, {
        tenant_id: req.tenant.id,
        tenant_plan: req.tenant.plan,
        method: req.method,
        status_code: res.statusCode.toString()
      });
    }

    originalEnd.call(this, chunk, encoding);
  };

  next();
};
