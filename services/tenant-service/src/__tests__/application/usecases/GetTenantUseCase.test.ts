import { GetTenantUseCase } from '../../../application/usecases/GetTenantUseCase';
import { TenantRepository } from '../../../domain/repositories/TenantRepository';
import { Logger } from '../../../application/ports/Logger';
import { Tenant } from '../../../domain/entities/Tenant';

describe('GetTenantUseCase', () => {
  let useCase: GetTenantUseCase;
  let mockTenantRepository: jest.Mocked<TenantRepository>;
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

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    };

    useCase = new GetTenantUseCase(mockTenantRepository, mockLogger);
  });

  describe('execute', () => {
    it('should successfully get tenant for owner', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        requesterRole: 'owner' as const
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tenant).toEqual(mockTenant);
      expect(result.error).toBeUndefined();

      expect(mockTenantRepository.findById).toHaveBeenCalledWith('tenant-123');
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Getting tenant',
        { tenantId: 'tenant-123', requesterId: 'owner-123' }
      );
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Tenant retrieved successfully',
        { tenantId: 'tenant-123', tenantName: 'Test Company' }
      );
    });

    it('should successfully get tenant for admin', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'admin-456',
        requesterRole: 'admin' as const
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tenant).toEqual(mockTenant);
    });

    it('should return error when tenant not found', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(null);

      const request = {
        tenantId: 'non-existent',
        requesterId: 'owner-123',
        requesterRole: 'owner' as const
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
        requesterRole: 'owner' as const
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized access to tenant');
      expect(result.tenant).toBeUndefined();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Unauthorized tenant access attempt',
        {
          tenantId: 'tenant-123',
          requesterId: 'different-owner',
          requesterRole: 'owner'
        }
      );
    });

    it('should validate required fields', async () => {
      // Test missing tenant ID
      const request1 = {
        tenantId: '',
        requesterId: 'owner-123',
        requesterRole: 'owner' as const
      };

      const result1 = await useCase.execute(request1);
      expect(result1.success).toBe(false);
      expect(result1.error).toBe('Tenant ID and requester ID are required');

      // Test missing requester ID
      const request2 = {
        tenantId: 'tenant-123',
        requesterId: '',
        requesterRole: 'owner' as const
      };

      const result2 = await useCase.execute(request2);
      expect(result2.success).toBe(false);
      expect(result2.error).toBe('Tenant ID and requester ID are required');
    });

    it('should handle repository errors', async () => {
      // Arrange
      const error = new Error('Database connection failed');
      mockTenantRepository.findById.mockRejectedValue(error);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'owner-123',
        requesterRole: 'owner' as const
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to get tenant');

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Error getting tenant',
        error,
        { tenantId: 'tenant-123', requesterId: 'owner-123' }
      );
    });

    it('should allow user access to active tenants', async () => {
      // Arrange
      mockTenantRepository.findById.mockResolvedValue(mockTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'user-789',
        requesterRole: 'user' as const
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(true);
      expect(result.tenant).toEqual(mockTenant);
    });

    it('should deny user access to suspended tenants', async () => {
      // Arrange
      const suspendedTenant = new Tenant(
        mockTenant.id,
        mockTenant.name,
        mockTenant.ownerId,
        mockTenant.plan,
        'suspended', // Different status
        mockTenant.resourceLimits,
        mockTenant.currentUsage,
        mockTenant.billingInfo,
        mockTenant.settings
      );

      mockTenantRepository.findById.mockResolvedValue(suspendedTenant);

      const request = {
        tenantId: 'tenant-123',
        requesterId: 'user-789',
        requesterRole: 'user' as const
      };

      // Act
      const result = await useCase.execute(request);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized access to tenant');
    });
  });
});
