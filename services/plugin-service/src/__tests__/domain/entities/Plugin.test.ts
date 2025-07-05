/**
 * Plugin Entity Unit Tests
 * 
 * Tests the Plugin domain entity business logic, validation rules,
 * and behavior methods.
 */

import { Plugin, PluginManifest } from '../../../domain/entities/Plugin';

describe('Plugin Entity', () => {
  const mockManifest: PluginManifest = {
    metadata: {
      name: 'test-plugin',
      version: '1.0.0',
      description: 'A test plugin for unit testing',
      author: 'Test Author',
      license: 'MIT',
      keywords: ['test', 'plugin'],
      category: 'utility',
      tags: ['testing', 'utility']
    },
    dependencies: {
      platform: '>=1.0.0',
      node: '>=18.0.0',
      plugins: {
        'base-plugin': '^1.0.0'
      },
      services: ['database', 'cache'],
      permissions: ['database', 'network']
    },
    configuration: {
      schema: {
        type: 'object',
        properties: {
          apiKey: { type: 'string' },
          timeout: { type: 'number', default: 5000 }
        },
        required: ['apiKey']
      },
      defaults: {
        timeout: 5000
      },
      required: ['apiKey'],
      sensitive: ['apiKey']
    },
    api: {
      endpoints: [
        {
          method: 'GET',
          path: '/test',
          handler: 'handleTest',
          auth: true,
          permissions: ['read']
        }
      ],
      events: [
        {
          name: 'test.event',
          handler: 'handleEvent',
          priority: 1
        }
      ],
      hooks: [
        {
          name: 'before.save',
          handler: 'beforeSave',
          phase: 'before'
        }
      ],
      scheduled: [
        {
          name: 'daily.cleanup',
          handler: 'dailyCleanup',
          cron: '0 0 * * *'
        }
      ]
    },
    security: {
      sandbox: true,
      permissions: ['database', 'network'],
      resourceLimits: {
        memory: 128,
        cpu: 50,
        timeout: 30000,
        fileSystem: false,
        network: true,
        database: true
      },
      trustedDomains: ['api.example.com'],
      allowedModules: ['crypto', 'util']
    },
    entryPoint: 'index.js',
    files: ['index.js', 'lib/helper.js', 'package.json'],
    checksum: 'sha256:abcd1234...'
  };

  describe('Plugin Creation', () => {
    it('should create a new plugin with valid data', () => {
      const plugin = Plugin.create(
        mockManifest,
        'tenant-123',
        'user-456',
        { apiKey: 'test-key' }
      );

      expect(plugin.id).toBeDefined();
      expect(plugin.manifest).toEqual(mockManifest);
      expect(plugin.status).toBe('pending');
      expect(plugin.tenantId).toBe('tenant-123');
      expect(plugin.uploadedBy).toBe('user-456');
      expect(plugin.configuration).toEqual({ apiKey: 'test-key' });
      expect(plugin.createdAt).toBeInstanceOf(Date);
      expect(plugin.updatedAt).toBeInstanceOf(Date);
      expect(plugin.executionCount).toBe(0);
      expect(plugin.errorCount).toBe(0);
      expect(plugin.averageExecutionTime).toBe(0);
    });

    it('should create plugin with default configuration when none provided', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');

      expect(plugin.configuration).toEqual({});
    });
  });

  describe('Plugin Validation', () => {
    it('should validate a correct plugin manifest', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const validation = plugin.validate();

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fail validation for missing plugin name', () => {
      const invalidManifest = {
        ...mockManifest,
        metadata: {
          ...mockManifest.metadata,
          name: ''
        }
      };

      const plugin = Plugin.create(invalidManifest, 'tenant-123', 'user-456');
      const validation = plugin.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Plugin name must be at least 3 characters long');
    });

    it('should fail validation for invalid version', () => {
      const invalidManifest = {
        ...mockManifest,
        metadata: {
          ...mockManifest.metadata,
          version: 'invalid-version'
        }
      };

      const plugin = Plugin.create(invalidManifest, 'tenant-123', 'user-456');
      const validation = plugin.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Plugin version must be a valid semantic version');
    });

    it('should fail validation for short description', () => {
      const invalidManifest = {
        ...mockManifest,
        metadata: {
          ...mockManifest.metadata,
          description: 'short'
        }
      };

      const plugin = Plugin.create(invalidManifest, 'tenant-123', 'user-456');
      const validation = plugin.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Plugin description must be at least 10 characters long');
    });

    it('should fail validation for invalid memory limit', () => {
      const invalidManifest = {
        ...mockManifest,
        security: {
          ...mockManifest.security,
          resourceLimits: {
            ...mockManifest.security.resourceLimits,
            memory: 2000 // Too high
          }
        }
      };

      const plugin = Plugin.create(invalidManifest, 'tenant-123', 'user-456');
      const validation = plugin.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Memory limit must be between 1 and 1024 MB');
    });

    it('should fail validation for invalid timeout', () => {
      const invalidManifest = {
        ...mockManifest,
        security: {
          ...mockManifest.security,
          resourceLimits: {
            ...mockManifest.security.resourceLimits,
            timeout: 500 // Too low
          }
        }
      };

      const plugin = Plugin.create(invalidManifest, 'tenant-123', 'user-456');
      const validation = plugin.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Timeout must be between 1 second and 5 minutes');
    });

    it('should fail validation when entry point not in files list', () => {
      const invalidManifest = {
        ...mockManifest,
        entryPoint: 'missing.js',
        files: ['index.js', 'lib/helper.js']
      };

      const plugin = Plugin.create(invalidManifest, 'tenant-123', 'user-456');
      const validation = plugin.validate();

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Entry point must be included in plugin files');
    });
  });

  describe('Plugin Compatibility', () => {
    it('should check platform compatibility correctly', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');

      expect(plugin.isCompatible('1.0.0')).toBe(true);
      expect(plugin.isCompatible('1.5.0')).toBe(true);
      expect(plugin.isCompatible('2.0.0')).toBe(true);
      expect(plugin.isCompatible('0.9.0')).toBe(false);
    });

    it('should check dependencies correctly', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');

      const availablePlugins = [
        Plugin.create({
          ...mockManifest,
          metadata: { ...mockManifest.metadata, name: 'base-plugin', version: '1.2.0' }
        }, 'tenant-123', 'user-456')
      ];

      const platformServices = ['database', 'cache', 'events'];

      const dependencyCheck = plugin.checkDependencies(availablePlugins, platformServices);

      expect(dependencyCheck.satisfied).toBe(true);
      expect(dependencyCheck.missing).toHaveLength(0);
    });

    it('should detect missing plugin dependencies', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');

      const availablePlugins: Plugin[] = []; // No plugins available
      const platformServices = ['database', 'cache'];

      const dependencyCheck = plugin.checkDependencies(availablePlugins, platformServices);

      expect(dependencyCheck.satisfied).toBe(false);
      expect(dependencyCheck.missing).toContain('Plugin dependency: base-plugin');
    });

    it('should detect missing service dependencies', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');

      const availablePlugins = [
        Plugin.create({
          ...mockManifest,
          metadata: { ...mockManifest.metadata, name: 'base-plugin', version: '1.2.0' }
        }, 'tenant-123', 'user-456')
      ];

      const platformServices = ['database']; // Missing cache service

      const dependencyCheck = plugin.checkDependencies(availablePlugins, platformServices);

      expect(dependencyCheck.satisfied).toBe(false);
      expect(dependencyCheck.missing).toContain('Service dependency: cache');
    });

    it('should detect incompatible plugin versions', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');

      const availablePlugins = [
        Plugin.create({
          ...mockManifest,
          metadata: { ...mockManifest.metadata, name: 'base-plugin', version: '0.9.0' } // Too old
        }, 'tenant-123', 'user-456')
      ];

      const platformServices = ['database', 'cache'];

      const dependencyCheck = plugin.checkDependencies(availablePlugins, platformServices);

      expect(dependencyCheck.satisfied).toBe(false);
      expect(dependencyCheck.missing).toContain('Plugin dependency: base-plugin@^1.0.0 (found 0.9.0)');
    });
  });

  describe('Configuration Validation', () => {
    it('should validate correct configuration', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const config = { apiKey: 'test-key', timeout: 10000 };

      const validation = plugin.validateConfiguration(config);

      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should fail validation for missing required fields', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const config = { timeout: 10000 }; // Missing apiKey

      const validation = plugin.validateConfiguration(config);

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('Required configuration field missing: apiKey');
    });
  });

  describe('Plugin Permissions', () => {
    it('should return correct permissions', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const permissions = plugin.getPermissions();

      expect(permissions).toEqual(['database', 'network']);
    });

    it('should check permissions correctly', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');

      expect(plugin.hasPermission('database')).toBe(true);
      expect(plugin.hasPermission('network')).toBe(true);
      expect(plugin.hasPermission('filesystem')).toBe(false);
    });

    it('should return resource limits', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const limits = plugin.getResourceLimits();

      expect(limits).toEqual({
        memory: 128,
        cpu: 50,
        timeout: 30000,
        fileSystem: false,
        network: true,
        database: true
      });
    });
  });

  describe('Plugin Status Management', () => {
    it('should update plugin status', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const updatedPlugin = plugin.updateStatus('active');

      expect(updatedPlugin.status).toBe('active');
      expect(updatedPlugin.updatedAt).not.toEqual(plugin.updatedAt);
      expect(updatedPlugin.id).toBe(plugin.id); // Should maintain same ID
    });

    it('should update configuration', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456', { apiKey: 'old-key' });
      const newConfig = { apiKey: 'new-key', timeout: 15000 };
      const updatedPlugin = plugin.updateConfiguration(newConfig);

      expect(updatedPlugin.configuration).toEqual({ apiKey: 'new-key', timeout: 15000 });
      expect(updatedPlugin.updatedAt).not.toEqual(plugin.updatedAt);
    });

    it('should check if plugin can execute', () => {
      const activePlugin = Plugin.create(mockManifest, 'tenant-123', 'user-456').updateStatus('active');
      const inactivePlugin = Plugin.create(mockManifest, 'tenant-123', 'user-456').updateStatus('inactive');

      expect(activePlugin.canExecute()).toBe(true);
      expect(inactivePlugin.canExecute()).toBe(false);
    });
  });

  describe('Plugin Execution Tracking', () => {
    it('should record successful execution', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const updatedPlugin = plugin.recordExecution(1500, true);

      expect(updatedPlugin.executionCount).toBe(1);
      expect(updatedPlugin.errorCount).toBe(0);
      expect(updatedPlugin.averageExecutionTime).toBe(1500);
      expect(updatedPlugin.lastExecutedAt).toBeInstanceOf(Date);
    });

    it('should record failed execution', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const updatedPlugin = plugin.recordExecution(2000, false);

      expect(updatedPlugin.executionCount).toBe(1);
      expect(updatedPlugin.errorCount).toBe(1);
      expect(updatedPlugin.averageExecutionTime).toBe(2000);
    });

    it('should calculate average execution time correctly', () => {
      let plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      
      // First execution: 1000ms
      plugin = plugin.recordExecution(1000, true);
      expect(plugin.averageExecutionTime).toBe(1000);
      
      // Second execution: 2000ms
      plugin = plugin.recordExecution(2000, true);
      expect(plugin.averageExecutionTime).toBe(1500); // (1000 + 2000) / 2
      
      // Third execution: 3000ms
      plugin = plugin.recordExecution(3000, true);
      expect(plugin.averageExecutionTime).toBe(2000); // (1000 + 2000 + 3000) / 3
    });
  });

  describe('Plugin Health Metrics', () => {
    it('should calculate health metrics for healthy plugin', () => {
      let plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      
      // Record some successful executions
      plugin = plugin.recordExecution(1000, true);
      plugin = plugin.recordExecution(1200, true);
      plugin = plugin.recordExecution(800, true);

      const health = plugin.getHealthMetrics();

      expect(health.executionCount).toBe(3);
      expect(health.errorCount).toBe(0);
      expect(health.errorRate).toBe(0);
      expect(health.averageExecutionTime).toBe(1000);
      expect(health.isHealthy).toBe(true);
    });

    it('should calculate health metrics for unhealthy plugin', () => {
      let plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      
      // Record executions with high error rate and slow execution
      plugin = plugin.recordExecution(8000, false); // Slow and failed
      plugin = plugin.recordExecution(7000, false); // Slow and failed
      plugin = plugin.recordExecution(6000, true);  // Slow but successful

      const health = plugin.getHealthMetrics();

      expect(health.executionCount).toBe(3);
      expect(health.errorCount).toBe(2);
      expect(health.errorRate).toBe(66.67); // 2/3 * 100, rounded
      expect(health.averageExecutionTime).toBe(7000);
      expect(health.isHealthy).toBe(false); // High error rate and slow execution
    });
  });

  describe('Plugin Serialization', () => {
    it('should return correct summary', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456');
      const summary = plugin.toSummary();

      expect(summary).toEqual({
        id: plugin.id,
        name: 'test-plugin',
        version: '1.0.0',
        description: 'A test plugin for unit testing',
        author: 'Test Author',
        category: 'utility',
        status: 'pending',
        createdAt: plugin.createdAt,
        updatedAt: plugin.updatedAt,
        health: plugin.getHealthMetrics()
      });
    });

    it('should return correct detail', () => {
      const plugin = Plugin.create(mockManifest, 'tenant-123', 'user-456', { apiKey: 'test' });
      const detail = plugin.toDetail();

      expect(detail).toEqual({
        id: plugin.id,
        manifest: mockManifest,
        status: 'pending',
        tenantId: 'tenant-123',
        uploadedBy: 'user-456',
        configuration: { apiKey: 'test' },
        createdAt: plugin.createdAt,
        updatedAt: plugin.updatedAt,
        installedAt: undefined,
        health: plugin.getHealthMetrics()
      });
    });
  });
});
