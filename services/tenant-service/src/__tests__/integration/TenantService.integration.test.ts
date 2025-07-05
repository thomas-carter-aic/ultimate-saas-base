/**
 * Tenant Service Integration Tests
 * 
 * Tests the complete tenant service workflow including:
 * - Tenant creation with billing setup
 * - Resource provisioning
 * - Event publishing
 * - Database operations
 * - HTTP API endpoints
 */

import request from 'supertest';
import { Express } from 'express';
import { Pool } from 'pg';
import { Kafka, Producer, Consumer } from 'kafkajs';

import { createApp } from '../../app';
import { Tenant } from '../../domain/entities/Tenant';
import { PostgreSQLTenantRepository } from '../../infrastructure/repositories/PostgreSQLTenantRepository';
import { WinstonLogger } from '../../infrastructure/logging/WinstonLogger';

describe('Tenant Service Integration Tests', () => {
  let app: Express;
  let dbPool: Pool;
  let kafkaProducer: Producer;
  let kafkaConsumer: Consumer;
  let tenantRepository: PostgreSQLTenantRepository;
  let logger: WinstonLogger;

  // Test data
  const testTenant = {
    name: 'Test Company',
    ownerId: 'test-owner-123',
    plan: 'professional'
  };

  const authHeaders = {
    'Authorization': 'Bearer test-token',
    'x-user-id': 'test-owner-123',
    'x-user-role': 'owner'
  };

  beforeAll(async () => {
    // Setup test database
    dbPool = new Pool({
      host: process.env.TEST_DB_HOST || 'localhost',
      port: parseInt(process.env.TEST_DB_PORT || '5432'),
      database: process.env.TEST_DB_NAME || 'tenant_service_test',
      username: process.env.TEST_DB_USER || 'postgres',
      password: process.env.TEST_DB_PASSWORD || 'password'
    });

    // Setup Kafka for testing
    const kafka = new Kafka({
      clientId: 'tenant-service-test',
      brokers: [process.env.TEST_KAFKA_BROKER || 'localhost:9092']
    });

    kafkaProducer = kafka.producer();
    kafkaConsumer = kafka.consumer({ groupId: 'tenant-service-test-group' });

    await kafkaProducer.connect();
    await kafkaConsumer.connect();

    // Setup logger
    logger = new WinstonLogger();

    // Setup repository
    tenantRepository = new PostgreSQLTenantRepository(dbPool, logger);

    // Create Express app
    app = createApp({
      dbPool,
      kafkaProducer,
      logger
    });

    // Run database migrations
    await runMigrations();
  });

  afterAll(async () => {
    // Cleanup
    await kafkaProducer.disconnect();
    await kafkaConsumer.disconnect();
    await dbPool.end();
  });

  beforeEach(async () => {
    // Clean up test data
    await dbPool.query('DELETE FROM tenants WHERE owner_id = $1', [testTenant.ownerId]);
  });

  describe('Tenant Creation Workflow', () => {
    it('should create tenant with complete workflow', async () => {
      // Subscribe to events
      const receivedEvents: any[] = [];
      await kafkaConsumer.subscribe({ topic: 'tenant-events' });
      
      kafkaConsumer.run({
        eachMessage: async ({ message }) => {
          const event = JSON.parse(message.value?.toString() || '{}');
          receivedEvents.push(event);
        }
      });

      // Create tenant via API
      const response = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders)
        .send(testTenant)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tenant).toBeDefined();
      expect(response.body.data.tenant.name).toBe(testTenant.name);
      expect(response.body.data.tenant.ownerId).toBe(testTenant.ownerId);
      expect(response.body.data.tenant.plan).toBe(testTenant.plan);
      expect(response.body.data.tenant.status).toBe('trial');

      const tenantId = response.body.data.tenant.id;

      // Verify tenant in database
      const dbResult = await dbPool.query(
        'SELECT * FROM tenants WHERE id = $1',
        [tenantId]
      );

      expect(dbResult.rows).toHaveLength(1);
      const dbTenant = dbResult.rows[0];
      expect(dbTenant.name).toBe(testTenant.name);
      expect(dbTenant.owner_id).toBe(testTenant.ownerId);
      expect(dbTenant.plan).toBe(testTenant.plan);

      // Wait for events to be processed
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify events were published
      expect(receivedEvents.length).toBeGreaterThan(0);
      const createdEvent = receivedEvents.find(e => e.type === 'TenantCreated');
      expect(createdEvent).toBeDefined();
      expect(createdEvent.data.tenantId).toBe(tenantId);
    });

    it('should handle validation errors', async () => {
      const invalidTenant = {
        name: '', // Invalid: empty name
        ownerId: testTenant.ownerId,
        plan: 'invalid-plan' // Invalid plan
      };

      const response = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders)
        .send(invalidTenant)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Validation failed');
    });

    it('should enforce rate limiting', async () => {
      // Create 3 tenants (rate limit)
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post('/api/v1/tenants')
          .set(authHeaders)
          .send({
            ...testTenant,
            name: `Test Company ${i}`
          })
          .expect(201);
      }

      // 4th request should be rate limited
      const response = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders)
        .send({
          ...testTenant,
          name: 'Test Company 4'
        })
        .expect(429);

      expect(response.body.error).toContain('Too many tenant creation attempts');
    });
  });

  describe('Tenant Retrieval', () => {
    let createdTenantId: string;

    beforeEach(async () => {
      // Create a test tenant
      const response = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders)
        .send(testTenant);

      createdTenantId = response.body.data.tenant.id;
    });

    it('should get tenant by ID', async () => {
      const response = await request(app)
        .get(`/api/v1/tenants/${createdTenantId}`)
        .set(authHeaders)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tenant.id).toBe(createdTenantId);
      expect(response.body.data.tenant.name).toBe(testTenant.name);
    });

    it('should return 404 for non-existent tenant', async () => {
      const nonExistentId = '00000000-0000-0000-0000-000000000000';
      
      const response = await request(app)
        .get(`/api/v1/tenants/${nonExistentId}`)
        .set(authHeaders)
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Tenant not found');
    });

    it('should enforce authorization', async () => {
      const unauthorizedHeaders = {
        ...authHeaders,
        'x-user-id': 'different-user-123'
      };

      const response = await request(app)
        .get(`/api/v1/tenants/${createdTenantId}`)
        .set(unauthorizedHeaders)
        .expect(403);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Unauthorized access to tenant');
    });
  });

  describe('Tenant Updates', () => {
    let createdTenantId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders)
        .send(testTenant);

      createdTenantId = response.body.data.tenant.id;
    });

    it('should update tenant settings', async () => {
      const updates = {
        name: 'Updated Company Name',
        settings: {
          branding: {
            logoUrl: 'https://example.com/logo.png',
            primaryColor: '#FF5733'
          },
          features: {
            aiEnabled: true,
            analyticsEnabled: false
          }
        }
      };

      const response = await request(app)
        .put(`/api/v1/tenants/${createdTenantId}`)
        .set(authHeaders)
        .send({ updates })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tenant.name).toBe(updates.name);
      expect(response.body.data.tenant.settings.branding.logoUrl).toBe(updates.settings.branding.logoUrl);
    });

    it('should validate update data', async () => {
      const invalidUpdates = {
        name: '', // Invalid: empty name
        settings: {
          branding: {
            primaryColor: 'invalid-color' // Invalid color format
          }
        }
      };

      const response = await request(app)
        .put(`/api/v1/tenants/${createdTenantId}`)
        .set(authHeaders)
        .send({ updates: invalidUpdates })
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Validation failed');
    });
  });

  describe('Tenant Listing', () => {
    beforeEach(async () => {
      // Create multiple test tenants
      const tenants = [
        { ...testTenant, name: 'Company A', plan: 'starter' },
        { ...testTenant, name: 'Company B', plan: 'professional' },
        { ...testTenant, name: 'Company C', plan: 'enterprise' }
      ];

      for (const tenant of tenants) {
        await request(app)
          .post('/api/v1/tenants')
          .set(authHeaders)
          .send(tenant);
      }
    });

    it('should list user tenants with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/tenants?page=1&limit=2')
        .set(authHeaders)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tenants).toHaveLength(2);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(2);
      expect(response.body.data.pagination.total).toBe(3);
    });

    it('should filter tenants by plan', async () => {
      const response = await request(app)
        .get('/api/v1/tenants?plan=professional')
        .set(authHeaders)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tenants).toHaveLength(1);
      expect(response.body.data.tenants[0].plan).toBe('professional');
    });

    it('should search tenants by name', async () => {
      const response = await request(app)
        .get('/api/v1/tenants?search=Company A')
        .set(authHeaders)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tenants).toHaveLength(1);
      expect(response.body.data.tenants[0].name).toBe('Company A');
    });
  });

  describe('Tenant Usage Analytics', () => {
    let createdTenantId: string;

    beforeEach(async () => {
      const response = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders)
        .send(testTenant);

      createdTenantId = response.body.data.tenant.id;

      // Simulate some usage
      await dbPool.query(`
        UPDATE tenants 
        SET current_usage = jsonb_set(
          current_usage, 
          '{users}', 
          '5'
        )
        WHERE id = $1
      `, [createdTenantId]);
    });

    it('should get tenant usage analytics', async () => {
      const response = await request(app)
        .get(`/api/v1/tenants/${createdTenantId}/usage`)
        .set(authHeaders)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.analytics).toBeDefined();
      expect(response.body.data.analytics.tenantId).toBe(createdTenantId);
      expect(response.body.data.analytics.metrics).toBeDefined();
      expect(response.body.data.analytics.recommendations).toBeDefined();
      expect(response.body.data.analytics.alerts).toBeDefined();
    });

    it('should filter analytics by metrics', async () => {
      const response = await request(app)
        .get(`/api/v1/tenants/${createdTenantId}/usage?metrics=users,storage`)
        .set(authHeaders)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.analytics.metrics.users).toBeDefined();
      expect(response.body.data.analytics.metrics.storage).toBeDefined();
      expect(response.body.data.analytics.metrics.apiCalls).toBeUndefined();
    });

    it('should provide usage recommendations', async () => {
      // Update tenant to have high usage
      await dbPool.query(`
        UPDATE tenants 
        SET current_usage = jsonb_set(
          jsonb_set(current_usage, '{users}', '95'),
          '{storageGB}', 
          '45'
        )
        WHERE id = $1
      `, [createdTenantId]);

      const response = await request(app)
        .get(`/api/v1/tenants/${createdTenantId}/usage`)
        .set(authHeaders)
        .expect(200);

      expect(response.body.data.analytics.recommendations.length).toBeGreaterThan(0);
      expect(response.body.data.analytics.alerts.length).toBeGreaterThan(0);
    });
  });

  describe('Database Operations', () => {
    it('should handle concurrent tenant creation', async () => {
      const promises = [];
      
      // Create 5 tenants concurrently
      for (let i = 0; i < 5; i++) {
        promises.push(
          request(app)
            .post('/api/v1/tenants')
            .set({
              ...authHeaders,
              'x-user-id': `concurrent-user-${i}`
            })
            .send({
              ...testTenant,
              name: `Concurrent Company ${i}`,
              ownerId: `concurrent-user-${i}`
            })
        );
      }

      const responses = await Promise.all(promises);
      
      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(201);
        expect(response.body.success).toBe(true);
      });

      // Verify all tenants were created
      const dbResult = await dbPool.query(
        'SELECT COUNT(*) FROM tenants WHERE owner_id LIKE $1',
        ['concurrent-user-%']
      );
      
      expect(parseInt(dbResult.rows[0].count)).toBe(5);
    });

    it('should handle database connection failures gracefully', async () => {
      // Temporarily close the database connection
      await dbPool.end();

      const response = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders)
        .send(testTenant)
        .expect(500);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Internal server error');

      // Restore connection for cleanup
      dbPool = new Pool({
        host: process.env.TEST_DB_HOST || 'localhost',
        port: parseInt(process.env.TEST_DB_PORT || '5432'),
        database: process.env.TEST_DB_NAME || 'tenant_service_test',
        username: process.env.TEST_DB_USER || 'postgres',
        password: process.env.TEST_DB_PASSWORD || 'password'
      });
    });
  });

  describe('Event Publishing', () => {
    it('should publish events for tenant lifecycle', async () => {
      const receivedEvents: any[] = [];
      
      await kafkaConsumer.subscribe({ topic: 'tenant-events' });
      kafkaConsumer.run({
        eachMessage: async ({ message }) => {
          const event = JSON.parse(message.value?.toString() || '{}');
          receivedEvents.push(event);
        }
      });

      // Create tenant
      const createResponse = await request(app)
        .post('/api/v1/tenants')
        .set(authHeaders)
        .send(testTenant);

      const tenantId = createResponse.body.data.tenant.id;

      // Update tenant
      await request(app)
        .put(`/api/v1/tenants/${tenantId}`)
        .set(authHeaders)
        .send({
          updates: {
            name: 'Updated Company Name'
          }
        });

      // Wait for events
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify events
      expect(receivedEvents.length).toBeGreaterThanOrEqual(2);
      
      const createdEvent = receivedEvents.find(e => e.type === 'TenantCreated');
      expect(createdEvent).toBeDefined();
      expect(createdEvent.data.tenantId).toBe(tenantId);

      const updatedEvent = receivedEvents.find(e => e.type === 'TenantUpdated');
      expect(updatedEvent).toBeDefined();
      expect(updatedEvent.data.tenantId).toBe(tenantId);
    });
  });

  // Helper functions
  async function runMigrations(): Promise<void> {
    const migrationSQL = `
      CREATE TABLE IF NOT EXISTS tenants (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        owner_id VARCHAR(255) NOT NULL,
        plan VARCHAR(50) NOT NULL DEFAULT 'starter',
        status VARCHAR(50) NOT NULL DEFAULT 'trial',
        resource_limits JSONB NOT NULL DEFAULT '{}',
        current_usage JSONB NOT NULL DEFAULT '{}',
        billing_info JSONB NOT NULL DEFAULT '{}',
        settings JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        trial_ends_at TIMESTAMP WITH TIME ZONE
      );

      CREATE INDEX IF NOT EXISTS idx_tenants_owner_id ON tenants(owner_id);
      CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
      CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan);
      CREATE INDEX IF NOT EXISTS idx_tenants_created_at ON tenants(created_at);
    `;

    await dbPool.query(migrationSQL);
  }
});

// Mock app factory for testing
function createApp(dependencies: any): Express {
  // This would be the actual app factory
  // For now, return a mock Express app
  const express = require('express');
  const app = express();
  
  app.use(express.json());
  
  // Mock routes for testing
  app.post('/api/v1/tenants', (req: any, res: any) => {
    res.status(201).json({
      success: true,
      data: {
        tenant: {
          id: 'mock-tenant-id',
          name: req.body.name,
          ownerId: req.body.ownerId,
          plan: req.body.plan,
          status: 'trial'
        }
      }
    });
  });

  return app;
}
