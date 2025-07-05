/**
 * Tenant Entity Tests
 * 
 * Comprehensive test suite for the Tenant domain entity.
 * Tests all business logic, validation rules, and entity behavior.
 */

import { Tenant } from '../../../domain/entities/Tenant';

describe('Tenant Entity', () => {
  const validName = 'Test Company';
  const validSlug = 'test-company';
  const validOwnerId = '123e4567-e89b-12d3-a456-426614174000';

  describe('Tenant Creation', () => {
    it('should create a tenant with valid data', () => {
      // Act
      const tenant = Tenant.create(validName, validSlug, validOwnerId);

      // Assert
      expect(tenant.id).toBeDefined();
      expect(tenant.name).toBe(validName);
      expect(tenant.slug).toBe(validSlug);
      expect(tenant.ownerId).toBe(validOwnerId);
      expect(tenant.status).toBe('trial');
      expect(tenant.isInTrial()).toBe(true);
      expect(tenant.createdAt).toBeInstanceOf(Date);
      expect(tenant.updatedAt).toBeInstanceOf(Date);
      expect(tenant.trialEndsAt).toBeInstanceOf(Date);
    });

    it('should create tenant with default settings', () => {
      // Act
      const tenant = Tenant.create(validName, validSlug, validOwnerId);

      // Assert
      expect(tenant.settings.branding.companyName).toBe(validName);
      expect(tenant.settings.branding.primaryColor).toBe('#007bff');
      expect(tenant.settings.features.aiPersonalization).toBe(true);
      expect(tenant.settings.features.advancedAnalytics).toBe(false);
      expect(tenant.settings.security.passwordPolicy.minLength).toBe(8);
      expect(tenant.settings.compliance.gdprEnabled).toBe(true);
    });

    it('should create tenant with default resource limits for starter plan', () => {
      // Act
      const tenant = Tenant.create(validName, validSlug, validOwnerId, 'starter');

      // Assert
      expect(tenant.resourceLimits.users.max).toBe(10);
      expect(tenant.resourceLimits.storage.maxGB).toBe(5);
      expect(tenant.resourceLimits.apiCalls.monthlyLimit).toBe(10000);
      expect(tenant.resourceLimits.aiInteractions.monthlyLimit).toBe(1000);
    });

    it('should create tenant with professional plan limits', () => {
      // Act
      const tenant = Tenant.create(validName, validSlug, validOwnerId, 'professional');

      // Assert
      expect(tenant.resourceLimits.users.max).toBe(100);
      expect(tenant.resourceLimits.storage.maxGB).toBe(50);
      expect(tenant.resourceLimits.apiCalls.monthlyLimit).toBe(100000);
      expect(tenant.resourceLimits.aiInteractions.monthlyLimit).toBe(10000);
    });

    it('should normalize slug to lowercase', () => {
      // Arrange
      const upperCaseSlug = 'TEST-COMPANY';

      // Act
      const tenant = Tenant.create(validName, upperCaseSlug, validOwnerId);

      // Assert
      expect(tenant.slug).toBe(upperCaseSlug.toLowerCase());
    });
  });

  describe('Tenant Creation Validation', () => {
    it('should throw error for empty name', () => {
      expect(() => {
        Tenant.create('', validSlug, validOwnerId);
      }).toThrow('Tenant name is required');
    });

    it('should throw error for name too long', () => {
      const longName = 'a'.repeat(101);
      expect(() => {
        Tenant.create(longName, validSlug, validOwnerId);
      }).toThrow('Tenant name must be less than 100 characters');
    });

    it('should throw error for invalid slug format', () => {
      expect(() => {
        Tenant.create(validName, 'Invalid Slug!', validOwnerId);
      }).toThrow('Invalid tenant slug');
    });

    it('should throw error for slug too short', () => {
      expect(() => {
        Tenant.create(validName, 'ab', validOwnerId);
      }).toThrow('Invalid tenant slug');
    });

    it('should throw error for empty owner ID', () => {
      expect(() => {
        Tenant.create(validName, validSlug, '');
      }).toThrow('Tenant owner ID is required');
    });
  });

  describe('Settings Updates', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = Tenant.create(validName, validSlug, validOwnerId);
    });

    it('should update branding settings successfully', () => {
      // Arrange
      const newBranding = {
        branding: {
          companyName: 'Updated Company',
          primaryColor: '#ff0000',
          customDomain: 'custom.example.com'
        }
      };

      // Act
      tenant.updateSettings(newBranding);

      // Assert
      expect(tenant.settings.branding.companyName).toBe('Updated Company');
      expect(tenant.settings.branding.primaryColor).toBe('#ff0000');
      expect(tenant.settings.branding.customDomain).toBe('custom.example.com');
    });

    it('should update feature settings successfully', () => {
      // Arrange
      const newFeatures = {
        features: {
          advancedAnalytics: true,
          customIntegrations: true,
          whiteLabeling: true
        }
      };

      // Act
      tenant.updateSettings(newFeatures);

      // Assert
      expect(tenant.settings.features.advancedAnalytics).toBe(true);
      expect(tenant.settings.features.customIntegrations).toBe(true);
      expect(tenant.settings.features.whiteLabeling).toBe(true);
      expect(tenant.settings.features.aiPersonalization).toBe(true); // Should remain unchanged
    });

    it('should throw error for empty company name', () => {
      expect(() => {
        tenant.updateSettings({
          branding: { companyName: '' }
        });
      }).toThrow('Company name cannot be empty');
    });

    it('should throw error for invalid custom domain', () => {
      expect(() => {
        tenant.updateSettings({
          branding: { customDomain: 'invalid-domain' }
        });
      }).toThrow('Invalid custom domain format');
    });

    it('should throw error for invalid password policy', () => {
      expect(() => {
        tenant.updateSettings({
          security: {
            passwordPolicy: { minLength: 5 }
          }
        });
      }).toThrow('Password minimum length must be between 8 and 128 characters');
    });
  });

  describe('Resource Limits', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = Tenant.create(validName, validSlug, validOwnerId);
    });

    it('should update resource limits successfully', () => {
      // Arrange
      const newLimits = {
        users: { max: 20, current: 5 },
        storage: { maxGB: 10, currentGB: 2 }
      };

      // Act
      tenant.updateResourceLimits(newLimits);

      // Assert
      expect(tenant.resourceLimits.users.max).toBe(20);
      expect(tenant.resourceLimits.users.current).toBe(5);
      expect(tenant.resourceLimits.storage.maxGB).toBe(10);
      expect(tenant.resourceLimits.storage.currentGB).toBe(2);
    });

    it('should throw error when setting limit below current usage', () => {
      // Arrange
      tenant.updateUsage({ userCount: 8 });

      // Act & Assert
      expect(() => {
        tenant.updateResourceLimits({
          users: { max: 5, current: 8 }
        });
      }).toThrow('Cannot set user limit below current usage');
    });

    it('should detect when limits are exceeded', () => {
      // Arrange
      tenant.updateUsage({
        userCount: 10, // At limit
        storageGB: 6,   // Over limit
        apiCalls: 9000  // Under limit
      });

      // Act
      const result = tenant.hasExceededLimits();

      // Assert
      expect(result.exceeded).toBe(true);
      expect(result.limits).toHaveLength(3);
      expect(result.limits[0].resource).toBe('users');
      expect(result.limits[0].percentage).toBe(100);
      expect(result.limits[1].resource).toBe('storage');
      expect(result.limits[1].percentage).toBe(120);
    });
  });

  describe('Tenant Status Management', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = Tenant.create(validName, validSlug, validOwnerId);
    });

    it('should activate tenant successfully', () => {
      // Act
      const activatedTenant = tenant.activate();

      // Assert
      expect(activatedTenant.status).toBe('active');
      expect(activatedTenant.suspendedAt).toBeUndefined();
      expect(activatedTenant.suspensionReason).toBeUndefined();
    });

    it('should suspend tenant with reason', () => {
      // Arrange
      const reason = 'Payment failed';

      // Act
      const suspendedTenant = tenant.suspend(reason);

      // Assert
      expect(suspendedTenant.status).toBe('suspended');
      expect(suspendedTenant.suspendedAt).toBeInstanceOf(Date);
      expect(suspendedTenant.suspensionReason).toBe(reason);
    });

    it('should throw error when suspending without reason', () => {
      expect(() => {
        tenant.suspend('');
      }).toThrow('Suspension reason is required');
    });

    it('should cancel tenant subscription', () => {
      // Act
      const cancelledTenant = tenant.cancel();

      // Assert
      expect(cancelledTenant.status).toBe('cancelled');
    });
  });

  describe('Trial Management', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = Tenant.create(validName, validSlug, validOwnerId);
    });

    it('should correctly identify trial status', () => {
      expect(tenant.isInTrial()).toBe(true);
      expect(tenant.isTrialExpired()).toBe(false);
    });

    it('should calculate trial days remaining', () => {
      const daysRemaining = tenant.getTrialDaysRemaining();
      expect(daysRemaining).toBeGreaterThan(0);
      expect(daysRemaining).toBeLessThanOrEqual(14);
    });

    it('should detect expired trial', () => {
      // Create tenant with past trial end date
      const expiredTenant = Tenant.fromPersistence({
        id: 'test-id',
        name: validName,
        slug: validSlug,
        ownerId: validOwnerId,
        settings: {},
        resourceLimits: {},
        billingInfo: {},
        metrics: {},
        status: 'trial',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Yesterday
      });

      expect(expiredTenant.isTrialExpired()).toBe(true);
      expect(expiredTenant.getTrialDaysRemaining()).toBe(0);
    });
  });

  describe('Usage Tracking', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = Tenant.create(validName, validSlug, validOwnerId);
    });

    it('should update usage metrics', () => {
      // Act
      tenant.updateUsage({
        userCount: 5,
        storageGB: 2.5,
        apiCalls: 1000,
        aiInteractions: 50
      });

      // Assert
      expect(tenant.resourceLimits.users.current).toBe(5);
      expect(tenant.resourceLimits.storage.currentGB).toBe(2.5);
      expect(tenant.resourceLimits.apiCalls.currentMonth).toBe(1000);
      expect(tenant.resourceLimits.aiInteractions.currentMonth).toBe(50);
    });

    it('should reset monthly usage counters', () => {
      // Arrange
      tenant.updateUsage({ apiCalls: 5000, aiInteractions: 200 });

      // Act
      tenant.resetMonthlyUsage();

      // Assert
      expect(tenant.resourceLimits.apiCalls.currentMonth).toBe(0);
      expect(tenant.resourceLimits.aiInteractions.currentMonth).toBe(0);
      expect(tenant.resourceLimits.apiCalls.resetDate).toBeInstanceOf(Date);
      expect(tenant.resourceLimits.aiInteractions.resetDate).toBeInstanceOf(Date);
    });
  });

  describe('Billing Information', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = Tenant.create(validName, validSlug, validOwnerId);
    });

    it('should update billing information successfully', () => {
      // Arrange
      const newBillingInfo = {
        plan: 'professional' as const,
        billingCycle: 'yearly' as const,
        amount: 99900,
        paymentMethod: {
          type: 'card' as const,
          last4: '1234',
          expiryMonth: 12,
          expiryYear: 2025
        }
      };

      // Act
      tenant.updateBillingInfo(newBillingInfo);

      // Assert
      expect(tenant.billingInfo.plan).toBe('professional');
      expect(tenant.billingInfo.billingCycle).toBe('yearly');
      expect(tenant.billingInfo.amount).toBe(99900);
      expect(tenant.billingInfo.paymentMethod.last4).toBe('1234');
    });

    it('should throw error for incomplete billing address', () => {
      expect(() => {
        tenant.updateBillingInfo({
          billingAddress: {
            street: 'Test Street',
            city: '', // Missing city
            state: 'CA',
            postalCode: '12345',
            country: 'US'
          }
        });
      }).toThrow('Billing address must include street, city, and country');
    });
  });

  describe('Persistence', () => {
    let tenant: Tenant;

    beforeEach(() => {
      tenant = Tenant.create(validName, validSlug, validOwnerId);
    });

    it('should convert to persistence format correctly', () => {
      // Act
      const persistenceData = tenant.toPersistence();

      // Assert
      expect(persistenceData.id).toBe(tenant.id);
      expect(persistenceData.name).toBe(tenant.name);
      expect(persistenceData.slug).toBe(tenant.slug);
      expect(persistenceData.ownerId).toBe(tenant.ownerId);
      expect(persistenceData.status).toBe(tenant.status);
      expect(typeof persistenceData.settings).toBe('object');
      expect(typeof persistenceData.resourceLimits).toBe('object');
      expect(typeof persistenceData.billingInfo).toBe('object');
      expect(typeof persistenceData.metrics).toBe('object');
    });

    it('should reconstruct from persistence correctly', () => {
      // Arrange
      const persistenceData = tenant.toPersistence();

      // Act
      const reconstructedTenant = Tenant.fromPersistence(persistenceData);

      // Assert
      expect(reconstructedTenant.id).toBe(tenant.id);
      expect(reconstructedTenant.name).toBe(tenant.name);
      expect(reconstructedTenant.slug).toBe(tenant.slug);
      expect(reconstructedTenant.ownerId).toBe(tenant.ownerId);
      expect(reconstructedTenant.status).toBe(tenant.status);
      expect(reconstructedTenant.settings).toEqual(tenant.settings);
      expect(reconstructedTenant.resourceLimits).toEqual(tenant.resourceLimits);
      expect(reconstructedTenant.billingInfo).toEqual(tenant.billingInfo);
    });
  });
});
