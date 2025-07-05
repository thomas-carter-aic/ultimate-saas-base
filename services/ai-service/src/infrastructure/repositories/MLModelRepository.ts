import { MLModel } from '../../domain/entities/MLModel';
import { Logger } from '../../../shared/infrastructure/logging/Logger';
import { DatabaseConnection } from '../../../shared/infrastructure/database/DatabaseConnection';
import { CacheManager } from '../../../shared/infrastructure/cache/CacheManager';
import { EventPublisher } from '../../../shared/infrastructure/events/EventPublisher';
import { MLModelEvents } from '../../domain/events/MLModelEvents';

export interface MLModelFilter {
  tenantId?: string;
  framework?: string;
  category?: string;
  status?: string;
  tags?: string[];
  createdAfter?: Date;
  createdBefore?: Date;
  minAccuracy?: number;
  maxLatency?: number;
}

export interface MLModelSearchOptions {
  filter?: MLModelFilter;
  sortBy?: 'created_at' | 'updated_at' | 'accuracy' | 'usage_count' | 'health_score';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface MLModelStats {
  totalModels: number;
  modelsByFramework: Record<string, number>;
  modelsByCategory: Record<string, number>;
  modelsByStatus: Record<string, number>;
  averageAccuracy: number;
  averageLatency: number;
  totalPredictions: number;
}

export class MLModelRepository {
  private readonly db: DatabaseConnection;
  private readonly cache: CacheManager;
  private readonly logger: Logger;
  private readonly eventPublisher: EventPublisher;
  private readonly cachePrefix = 'ml_model:';
  private readonly cacheTTL = 3600; // 1 hour

  constructor(
    db: DatabaseConnection,
    cache: CacheManager,
    logger: Logger,
    eventPublisher: EventPublisher
  ) {
    this.db = db;
    this.cache = cache;
    this.logger = logger;
    this.eventPublisher = eventPublisher;
  }

  async save(model: MLModel): Promise<MLModel> {
    const client = await this.db.getClient();
    
    try {
      await client.query('BEGIN');

      const isUpdate = !!model.id;
      let savedModel: MLModel;

      if (isUpdate) {
        savedModel = await this.updateModel(client, model);
        
        // Publish model updated event
        await this.eventPublisher.publish(
          MLModelEvents.MODEL_UPDATED,
          {
            modelId: model.id,
            tenantId: model.tenantId,
            version: model.version,
            changes: this.detectChanges(model),
            timestamp: new Date()
          }
        );
      } else {
        savedModel = await this.createModel(client, model);
        
        // Publish model created event
        await this.eventPublisher.publish(
          MLModelEvents.MODEL_CREATED,
          {
            modelId: savedModel.id,
            tenantId: savedModel.tenantId,
            name: savedModel.name,
            framework: savedModel.framework,
            category: savedModel.category,
            timestamp: new Date()
          }
        );
      }

      await client.query('COMMIT');

      // Update cache
      await this.updateCache(savedModel);

      this.logger.info(`ML model ${isUpdate ? 'updated' : 'created'}`, {
        modelId: savedModel.id,
        tenantId: savedModel.tenantId,
        name: savedModel.name
      });

      return savedModel;

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to save ML model', {
        modelId: model.id,
        error: error.message
      });
      throw error;
    } finally {
      client.release();
    }
  }

  private async createModel(client: any, model: MLModel): Promise<MLModel> {
    const query = `
      INSERT INTO ml_models (
        id, tenant_id, name, description, framework, category, version,
        artifact_path, configuration, input_schema, output_schema,
        performance_metrics, deployment_config, tags, status,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
      ) RETURNING *
    `;

    const values = [
      model.id,
      model.tenantId,
      model.name,
      model.description,
      model.framework,
      model.category,
      model.version,
      model.artifactPath,
      JSON.stringify(model.configuration),
      JSON.stringify(model.inputSchema),
      JSON.stringify(model.outputSchema),
      JSON.stringify(model.performanceMetrics),
      JSON.stringify(model.deploymentConfig),
      model.tags,
      model.status,
      model.createdAt,
      model.updatedAt
    ];

    const result = await client.query(query, values);
    return this.mapRowToModel(result.rows[0]);
  }

  private async updateModel(client: any, model: MLModel): Promise<MLModel> {
    const query = `
      UPDATE ml_models SET
        name = $2,
        description = $3,
        framework = $4,
        category = $5,
        version = $6,
        artifact_path = $7,
        configuration = $8,
        input_schema = $9,
        output_schema = $10,
        performance_metrics = $11,
        deployment_config = $12,
        tags = $13,
        status = $14,
        updated_at = $15
      WHERE id = $1 AND tenant_id = $16
      RETURNING *
    `;

    const values = [
      model.id,
      model.name,
      model.description,
      model.framework,
      model.category,
      model.version,
      model.artifactPath,
      JSON.stringify(model.configuration),
      JSON.stringify(model.inputSchema),
      JSON.stringify(model.outputSchema),
      JSON.stringify(model.performanceMetrics),
      JSON.stringify(model.deploymentConfig),
      model.tags,
      model.status,
      model.updatedAt,
      model.tenantId
    ];

    const result = await client.query(query, values);
    
    if (result.rows.length === 0) {
      throw new Error(`ML model not found: ${model.id}`);
    }

    return this.mapRowToModel(result.rows[0]);
  }

  async findById(id: string, tenantId: string): Promise<MLModel | null> {
    // Check cache first
    const cacheKey = `${this.cachePrefix}${id}:${tenantId}`;
    const cached = await this.cache.get(cacheKey);
    
    if (cached) {
      this.logger.debug('ML model found in cache', { modelId: id });
      return JSON.parse(cached);
    }

    // Query database
    const query = `
      SELECT * FROM ml_models 
      WHERE id = $1 AND tenant_id = $2
    `;

    try {
      const result = await this.db.query(query, [id, tenantId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      const model = this.mapRowToModel(result.rows[0]);
      
      // Cache the result
      await this.cache.set(cacheKey, JSON.stringify(model), this.cacheTTL);
      
      return model;

    } catch (error) {
      this.logger.error('Failed to find ML model by ID', {
        modelId: id,
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  async findByName(name: string, tenantId: string): Promise<MLModel | null> {
    const query = `
      SELECT * FROM ml_models 
      WHERE name = $1 AND tenant_id = $2
      ORDER BY created_at DESC
      LIMIT 1
    `;

    try {
      const result = await this.db.query(query, [name, tenantId]);
      
      if (result.rows.length === 0) {
        return null;
      }

      return this.mapRowToModel(result.rows[0]);

    } catch (error) {
      this.logger.error('Failed to find ML model by name', {
        name,
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  async search(tenantId: string, options: MLModelSearchOptions = {}): Promise<{
    models: MLModel[];
    total: number;
    hasMore: boolean;
  }> {
    try {
      const {
        filter = {},
        sortBy = 'created_at',
        sortOrder = 'desc',
        limit = 50,
        offset = 0
      } = options;

      // Build WHERE clause
      const conditions = ['tenant_id = $1'];
      const values: any[] = [tenantId];
      let paramIndex = 2;

      if (filter.framework) {
        conditions.push(`framework = $${paramIndex}`);
        values.push(filter.framework);
        paramIndex++;
      }

      if (filter.category) {
        conditions.push(`category = $${paramIndex}`);
        values.push(filter.category);
        paramIndex++;
      }

      if (filter.status) {
        conditions.push(`status = $${paramIndex}`);
        values.push(filter.status);
        paramIndex++;
      }

      if (filter.tags && filter.tags.length > 0) {
        conditions.push(`tags && $${paramIndex}`);
        values.push(filter.tags);
        paramIndex++;
      }

      if (filter.createdAfter) {
        conditions.push(`created_at >= $${paramIndex}`);
        values.push(filter.createdAfter);
        paramIndex++;
      }

      if (filter.createdBefore) {
        conditions.push(`created_at <= $${paramIndex}`);
        values.push(filter.createdBefore);
        paramIndex++;
      }

      if (filter.minAccuracy) {
        conditions.push(`(performance_metrics->>'accuracy')::float >= $${paramIndex}`);
        values.push(filter.minAccuracy);
        paramIndex++;
      }

      if (filter.maxLatency) {
        conditions.push(`(performance_metrics->>'latency')::float <= $${paramIndex}`);
        values.push(filter.maxLatency);
        paramIndex++;
      }

      const whereClause = conditions.join(' AND ');

      // Count total results
      const countQuery = `SELECT COUNT(*) FROM ml_models WHERE ${whereClause}`;
      const countResult = await this.db.query(countQuery, values);
      const total = parseInt(countResult.rows[0].count);

      // Get paginated results
      const dataQuery = `
        SELECT * FROM ml_models 
        WHERE ${whereClause}
        ORDER BY ${sortBy} ${sortOrder.toUpperCase()}
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `;
      
      values.push(limit, offset);
      const dataResult = await this.db.query(dataQuery, values);

      const models = dataResult.rows.map(row => this.mapRowToModel(row));
      const hasMore = offset + limit < total;

      this.logger.debug('ML model search completed', {
        tenantId,
        total,
        returned: models.length,
        hasMore
      });

      return { models, total, hasMore };

    } catch (error) {
      this.logger.error('Failed to search ML models', {
        tenantId,
        options,
        error: error.message
      });
      throw error;
    }
  }

  async delete(id: string, tenantId: string): Promise<boolean> {
    const client = await this.db.getClient();
    
    try {
      await client.query('BEGIN');

      // Get model before deletion for event
      const model = await this.findById(id, tenantId);
      if (!model) {
        return false;
      }

      // Delete model
      const deleteQuery = `
        DELETE FROM ml_models 
        WHERE id = $1 AND tenant_id = $2
      `;
      
      const result = await client.query(deleteQuery, [id, tenantId]);
      
      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        return false;
      }

      // Delete related usage statistics
      await client.query(
        'DELETE FROM ml_model_usage WHERE model_id = $1',
        [id]
      );

      await client.query('COMMIT');

      // Remove from cache
      const cacheKey = `${this.cachePrefix}${id}:${tenantId}`;
      await this.cache.delete(cacheKey);

      // Publish model deleted event
      await this.eventPublisher.publish(
        MLModelEvents.MODEL_DELETED,
        {
          modelId: id,
          tenantId,
          name: model.name,
          timestamp: new Date()
        }
      );

      this.logger.info('ML model deleted', { modelId: id, tenantId });
      return true;

    } catch (error) {
      await client.query('ROLLBACK');
      this.logger.error('Failed to delete ML model', {
        modelId: id,
        tenantId,
        error: error.message
      });
      throw error;
    } finally {
      client.release();
    }
  }

  async updateUsageStatistics(
    modelId: string,
    tenantId: string,
    predictionCount: number,
    errorCount: number,
    totalLatency: number
  ): Promise<void> {
    const query = `
      INSERT INTO ml_model_usage (
        model_id, tenant_id, prediction_count, error_count, 
        total_latency, last_used_at, created_at
      ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
      ON CONFLICT (model_id, tenant_id, DATE(created_at))
      DO UPDATE SET
        prediction_count = ml_model_usage.prediction_count + $3,
        error_count = ml_model_usage.error_count + $4,
        total_latency = ml_model_usage.total_latency + $5,
        last_used_at = NOW()
    `;

    try {
      await this.db.query(query, [
        modelId,
        tenantId,
        predictionCount,
        errorCount,
        totalLatency
      ]);

      // Invalidate cache to force refresh
      const cacheKey = `${this.cachePrefix}${modelId}:${tenantId}`;
      await this.cache.delete(cacheKey);

    } catch (error) {
      this.logger.error('Failed to update model usage statistics', {
        modelId,
        tenantId,
        error: error.message
      });
      // Don't throw - usage statistics are not critical
    }
  }

  async getModelStatistics(tenantId: string): Promise<MLModelStats> {
    try {
      const queries = [
        // Total models
        `SELECT COUNT(*) as total FROM ml_models WHERE tenant_id = $1`,
        
        // Models by framework
        `SELECT framework, COUNT(*) as count 
         FROM ml_models WHERE tenant_id = $1 
         GROUP BY framework`,
        
        // Models by category
        `SELECT category, COUNT(*) as count 
         FROM ml_models WHERE tenant_id = $1 
         GROUP BY category`,
        
        // Models by status
        `SELECT status, COUNT(*) as count 
         FROM ml_models WHERE tenant_id = $1 
         GROUP BY status`,
        
        // Average performance metrics
        `SELECT 
           AVG((performance_metrics->>'accuracy')::float) as avg_accuracy,
           AVG((performance_metrics->>'latency')::float) as avg_latency
         FROM ml_models 
         WHERE tenant_id = $1 AND performance_metrics IS NOT NULL`,
        
        // Total predictions
        `SELECT COALESCE(SUM(prediction_count), 0) as total_predictions
         FROM ml_model_usage u
         JOIN ml_models m ON u.model_id = m.id
         WHERE m.tenant_id = $1`
      ];

      const results = await Promise.all(
        queries.map(query => this.db.query(query, [tenantId]))
      );

      const stats: MLModelStats = {
        totalModels: parseInt(results[0].rows[0].total),
        modelsByFramework: {},
        modelsByCategory: {},
        modelsByStatus: {},
        averageAccuracy: parseFloat(results[4].rows[0].avg_accuracy) || 0,
        averageLatency: parseFloat(results[4].rows[0].avg_latency) || 0,
        totalPredictions: parseInt(results[5].rows[0].total_predictions)
      };

      // Process grouped results
      results[1].rows.forEach(row => {
        stats.modelsByFramework[row.framework] = parseInt(row.count);
      });

      results[2].rows.forEach(row => {
        stats.modelsByCategory[row.category] = parseInt(row.count);
      });

      results[3].rows.forEach(row => {
        stats.modelsByStatus[row.status] = parseInt(row.count);
      });

      return stats;

    } catch (error) {
      this.logger.error('Failed to get model statistics', {
        tenantId,
        error: error.message
      });
      throw error;
    }
  }

  private mapRowToModel(row: any): MLModel {
    return new MLModel(
      row.id,
      row.tenant_id,
      row.name,
      row.description,
      row.framework,
      row.category,
      row.version,
      row.artifact_path,
      JSON.parse(row.configuration || '{}'),
      JSON.parse(row.input_schema || '{}'),
      JSON.parse(row.output_schema || '{}'),
      JSON.parse(row.performance_metrics || '{}'),
      JSON.parse(row.deployment_config || '{}'),
      row.tags || [],
      row.status,
      row.created_at,
      row.updated_at
    );
  }

  private async updateCache(model: MLModel): Promise<void> {
    const cacheKey = `${this.cachePrefix}${model.id}:${model.tenantId}`;
    await this.cache.set(cacheKey, JSON.stringify(model), this.cacheTTL);
  }

  private detectChanges(model: MLModel): string[] {
    // This would compare with the existing model to detect changes
    // For now, return a placeholder
    return ['configuration', 'performance_metrics'];
  }
}
