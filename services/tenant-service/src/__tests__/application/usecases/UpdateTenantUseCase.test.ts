import { UpdateTenantUseCase } from '../../../application/usecases/UpdateTenantUseCase';
import { TenantRepository } from '../../../domain/repositories/TenantRepository';
import { EventPublisher } from '../../../application/ports/EventPublisher';
import { Logger } from '../../../application/ports/Logger';
import { Tenant } from '../../../domain/entities/Tenant';

describe('UpdateTenantUseCase', () => {
  let useCase: UpdateTenantUseCase;
  let mockTenantRepository: jest.Mocked<TenantRepository>;
  let mockEventPublisher: jest.Mocked<EventPublisher>;
  let mockLogger: jest.Mocked<Logger>;

  const mockTenant = new Tenant(
    'tenant-123',
    'Test Company',
    'owner-123',
    'professional',
    'active',
    {
      users: 100,
      storageGB: 50,
      apiCallsPerMonth: 100000,
      aiInteractionsPerMonth: 10000
    },
    {
      users: 25,
      storageGB: 12.5,
      apiCallsThisMonth: 25000,
      aiInteractionsThisMonth: 2500
    },
    {
      plan: 'professional',
      billingCycle: 'monthly',
      paymentMethodId: 'pm_123',
      billingEmail: 'billing@test.com'
    },
    {
      branding: {
        logoUrl: 'https://example.com/logo.png',
        primaryColor: '#FF5733',
        customDomain: 'test.example.com'
      },
      features: {
        aiEnabled: true,
        analyticsEnabled: true,
        customIntegrations: false
      },
      security: {
        passwordPolicy: {
          minLength: 8,
          requireSpecialChars: true,
          requireNumbers: true
        },
        sessionTimeout: 3600,
        mfaRequired: false
      },
      compliance: {
        gdprEnabled: true,
        hipaaEnabled: false,
        soc2Enabled: false
      }
    }
  );

  beforeEach(() => {
    mockTenantRepository = {
      save: jest.fn(),
      findById: jest.fn(),
      findByOwnerId: jest.fn(),
      findWithFilters: jest.fn(),
      countWithFilters: jest.fn(),
      update: jest.fn(),
      delete: jest.fn()
    };

    mockEventPublisher = {
      publish: jest.fn()
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    useCase = new UpdateTenantUseCase(mockTenantRepository, mockEventPublisher, mockLogger);
  });

  describe('execute', () => {
    it('should successfully update tenant name', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);
      
      const updatedTenant = new Tenant(
        mockTenant.id,
        'Updated Company Name',
        mockTenant.ownerId,
        mockTenant.plan,
        mockTenant.status,
        mockTenant.resourceLimits,
        mockTenant.currentUsage,
        mockTenant.billingInfo,
        mockTenant.settings,
        mockTenant.createdAt,
        new Date()
      );
      
      mockTenantRepository.update.mockResolvedValue(updatedTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {
          name: 'Updated Company Name'
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tenant?.name).toBe('Updated Company Name');
      expect(result.error).toBeUndefined();

      expect(mockTenantRepository.findById).toHaveBeenCalledWith('tenant-123');
      expect(mockTenantRepository.update).toHaveBeenCalled();
      expect(mockEventPublisher.publish).toHaveBeenCalled();
    });

    it('should successfully update tenant settings', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);
      
      const updatedTenant = { ...mockTenant };
      mockTenantRepository.update.mockResolvedValue(updatedTenant as Tenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {
          settings: {
            branding: {
              logoUrl: 'https://newlogo.com/logo.png',
              primaryColor: '#00FF00'
            },
            features: {
              aiEnabled: false,
              analyticsEnabled: true
            }
          }
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockTenantRepository.update).toHaveBeenCalled();
      expect(mockEventPublisher.publish).toHaveBeenCalled();
    });

    it('should successfully update billing info', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);
      
      const updatedTenant = { ...mockTenant };
      mockTenantRepository.update.mockResolvedValue(updatedTenant as Tenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {
          billingInfo: {
            paymentMethodId: 'pm_new_456',
            billingEmail: 'newbilling@test.com'
          }
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockTenantRepository.update).toHaveBeenCalled();
    });

    it('should return error when tenant not found', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(null);

      const request = {
        tenantId: 'non-existent',
        requesterId: 'owner-123',
        updates: {
          name: 'New Name'
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Tenant not found');
      expect(result.tenant).toBeUndefined();
    });

    it('should return error for unauthorized access', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'different-owner',
        updates: {
          name: 'New Name'
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Only tenant owner can update tenant settings');
      expect(result.tenant).toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unauthorized tenant update attempt',
        {
          tenantId: 'tenant-123',
          requesterId: 'different-owner',
          ownerId: 'owner-123'
        }
      );
    });

    it('should return error for cancelled tenant', async () => {
      // Arrange
      const cancelledTenant = new Tenant(
        mockTenant.id,
        mockTenant.name,
        mockTenant.ownerId,
        mockTenant.plan,
        'cancelled',
        mockTenant.resourceLimits,
        mockTenant.currentUsage,
        mockTenant.billingInfo,
        mockTenant.settings
      );

      mockTenantRepository.findById.mockResolvedValue(cancelledTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {
          name: 'New Name'
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot update cancelled tenant');
    });

    it('should validate required fields', async () => {
      // Test missing tenant ID
      const request1 = {
        tenantId: '',
        requesterId: 'owner-123',
        updates: { name: 'New Name' }
      };

      const result1 = await useCase.execute(request1);
      expect(result1.success).toBe(false);
      expect(result1.error).toBe('Tenant ID and requester ID are required');

      // Test missing updates
      const request2 = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {}
      };

      const result2 = await useCase.execute(request2);
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('No updates provided');
    });

    it('should handle validation errors', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {
          name: '' // Invalid: empty name
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Validation failed');
    });

    it('should publish events for significant changes', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);
      
      const updatedTenant = new Tenant(
        mockTenant.id,
        'Updated Company Name',
        mockTenant.ownerId,
        'enterprise', // Changed plan
        mockTenant.status,
        mockTenant.resourceLimits,
        mockTenant.currentUsage,
        mockTenant.billingInfo,
        mockTenant.settings,
        mockTenant.createdAt,
        new Date()
      );
      
      mockTenantRepository.update.mockResolvedValue(updatedTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {
          name: 'Updated Company Name'
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(mockEventPublisher.publish).toHaveBeenCalledTimes(2); // Name change + plan change events
    });

    it('should handle repository errors', async () => {
      // Arrange
      const error = new Error('Database connection failed');
      mockTenantRepository.findById.mockRejectedValue(error);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {
          name: 'New Name'
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to update tenant');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error updating tenant',
        error,
        { tenantId: 'tenant-123', requesterId: 'owner-123' }
      );
    });

    it('should handle event publishing errors gracefully', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);
      
      const updatedTenant = new Tenant(
        mockTenant.id,
        'Updated Company Name',
        mockTenant.ownerId,
        mockTenant.plan,
        mockTenant.status,
        mockTenant.resourceLimits,
        mockTenant.currentUsage,
        mockTenant.billingInfo,
        mockTenant.settings,
        mockTenant.createdAt,
        new Date()
      );
      
      mockTenantRepository.update.mockResolvedValue(updatedTenant);
      mockEventPublisher.publish.mockRejectedValue(new Error('Event publishing failed'));

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        updates: {
          name: 'Updated Company Name'
        }
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true); // Should still succeed even if event publishing fails
      expect(mockLogger.error).toHaveBeenCalledWith(
        'Failed to publish tenant update event',
        expect.any(Error),
        expect.objectContaining({
          tenantId: 'tenant-123'
        })
      );
    });
  });
});
