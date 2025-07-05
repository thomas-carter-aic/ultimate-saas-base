import { Router } from 'express';
import { MLModelController } from '../controllers/MLModelController';
import { authMiddleware } from '../middleware/authMiddleware';
import { rateLimitMiddleware } from '../middleware/rateLimitMiddleware';
import { tenantMiddleware } from '../middleware/tenantMiddleware';
import { uploadMiddleware } from '../middleware/uploadMiddleware';

export function createMLModelRoutes(controller: MLModelController): Router {
  const router = Router();

  // Apply common middleware
  router.use(authMiddleware);
  router.use(tenantMiddleware);
  router.use(rateLimitMiddleware);

  // Health check (no auth required)
  router.get('/health', controller.healthCheck.bind(controller));

  // Model CRUD operations
  router.post(
    '/models',
    MLModelController.validateCreateModel,
    controller.createModel.bind(controller)
  );

  router.get(
    '/models',
    MLModelController.validateSearch,
    controller.searchModels.bind(controller)
  );

  router.get(
    '/models/:modelId',
    MLModelController.validateModelId,
    controller.getModel.bind(controller)
  );

  router.put(
    '/models/:modelId',
    MLModelController.validateModelId,
    controller.updateModel.bind(controller)
  );

  router.delete(
    '/models/:modelId',
    MLModelController.validateModelId,
    controller.deleteModel.bind(controller)
  );

  // Model training
  router.post(
    '/models/:modelId/train',
    MLModelController.validateTrainModel,
    controller.trainModel.bind(controller)
  );

  // Model inference
  router.post(
    '/models/:modelId/predict',
    MLModelController.validatePredict,
    controller.predict.bind(controller)
  );

  router.post(
    '/models/:modelId/batch-predict',
    MLModelController.validateBatchPredict,
    controller.batchPredict.bind(controller)
  );

  // Model deployment
  router.post(
    '/models/:modelId/deploy',
    MLModelController.validateDeploy,
    controller.deployModel.bind(controller)
  );

  // Model statistics and analytics
  router.get(
    '/statistics',
    controller.getModelStatistics.bind(controller)
  );

  // Model artifact upload (with file handling)
  router.post(
    '/models/:modelId/artifacts',
    MLModelController.validateModelId,
    uploadMiddleware.single('artifact'),
    // TODO: Add artifact upload handler
  );

  return router;
}

// Additional routes for advanced features
export function createAdvancedMLRoutes(controller: MLModelController): Router {
  const router = Router();

  // Apply common middleware
  router.use(authMiddleware);
  router.use(tenantMiddleware);
  router.use(rateLimitMiddleware);

  // Model versioning
  router.get('/models/:modelId/versions', /* TODO: Add version controller */);
  router.post('/models/:modelId/versions', /* TODO: Add version controller */);

  // Model experiments and A/B testing
  router.get('/experiments', /* TODO: Add experiment controller */);
  router.post('/experiments', /* TODO: Add experiment controller */);
  router.get('/experiments/:experimentId', /* TODO: Add experiment controller */);
  router.put('/experiments/:experimentId', /* TODO: Add experiment controller */);
  router.delete('/experiments/:experimentId', /* TODO: Add experiment controller */);

  // Model monitoring and metrics
  router.get('/models/:modelId/metrics', /* TODO: Add metrics controller */);
  router.get('/models/:modelId/health', /* TODO: Add health controller */);
  router.get('/models/:modelId/logs', /* TODO: Add logs controller */);

  // Model deployment management
  router.get('/deployments', /* TODO: Add deployment controller */);
  router.get('/deployments/:deploymentId', /* TODO: Add deployment controller */);
  router.put('/deployments/:deploymentId/scale', /* TODO: Add deployment controller */);
  router.delete('/deployments/:deploymentId', /* TODO: Add deployment controller */);

  // Training job management
  router.get('/training-jobs', /* TODO: Add training job controller */);
  router.get('/training-jobs/:jobId', /* TODO: Add training job controller */);
  router.post('/training-jobs/:jobId/cancel', /* TODO: Add training job controller */);
  router.get('/training-jobs/:jobId/logs', /* TODO: Add training job controller */);

  return router;
}
