import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Logger } from '../../../../shared/infrastructure/logging/Logger';

interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    tenantId: string;
    roles: string[];
  };
}

export const authMiddleware = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  try {
    // Skip auth for health check
    if (req.path === '/health') {
      return next();
    }

    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: 'Authorization token required'
      });
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET || 'your-secret-key';

    try {
      const decoded = jwt.verify(token, jwtSecret) as any;
      
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        tenantId: decoded.tenantId,
        roles: decoded.roles || []
      };

      // Set tenant ID header for downstream processing
      req.headers['x-tenant-id'] = decoded.tenantId;

      next();

    } catch (jwtError) {
      res.status(401).json({
        success: false,
        error: 'Invalid or expired token'
      });
      return;
    }

  } catch (error) {
    const logger = new Logger('AuthMiddleware');
    logger.error('Authentication middleware error', { error: error.message });
    
    res.status(500).json({
      success: false,
      error: 'Authentication service error'
    });
  }
};

// Role-based access control middleware
export const requireRole = (requiredRoles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Authentication required'
      });
      return;
    }

    const userRoles = req.user.roles || [];
    const hasRequiredRole = requiredRoles.some(role => userRoles.includes(role));

    if (!hasRequiredRole) {
      res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        required: requiredRoles,
        current: userRoles
      });
      return;
    }

    next();
  };
};

// Admin role middleware
export const requireAdmin = requireRole(['admin', 'super_admin']);

// ML Engineer role middleware
export const requireMLEngineer = requireRole(['ml_engineer', 'admin', 'super_admin']);

// Data Scientist role middleware
export const requireDataScientist = requireRole(['data_scientist', 'ml_engineer', 'admin', 'super_admin']);
