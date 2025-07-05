/**
 * User Entity Tests
 * 
 * Comprehensive test suite for the User domain entity.
 * Tests all business logic, validation rules, and entity behavior.
 */

import { User, UserProfile, UserPreferences } from '../../../domain/entities/User';

describe('User Entity', () => {
  // Test data setup
  const validProfile: UserProfile = {
    firstName: 'John',
    lastName: 'Doe',
    company: 'Tech Corp',
    jobTitle: 'Software Engineer',
    location: 'San Francisco, CA'
  };

  const validEmail = 'john.doe@example.com';
  const validPasswordHash = 'hashedpassword123456';
  const validTenantId = 'tenant-123';

  describe('User Creation', () => {
    it('should create a user with valid data', () => {
      // Act
      const user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);

      // Assert
      expect(user.id).toBeDefined();
      expect(user.email).toBe(validEmail.toLowerCase());
      expect(user.tenantId).toBe(validTenantId);
      expect(user.profile).toEqual(validProfile);
      expect(user.isActive).toBe(true);
      expect(user.isVerified).toBe(false);
      expect(user.roles).toEqual(['user']);
      expect(user.createdAt).toBeInstanceOf(Date);
      expect(user.updatedAt).toBeInstanceOf(Date);
    });

    it('should create user with default preferences', () => {
      // Act
      const user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);

      // Assert
      expect(user.preferences.theme).toBe('auto');
      expect(user.preferences.language).toBe('en');
      expect(user.preferences.timezone).toBe('UTC');
      expect(user.preferences.notifications.email).toBe(true);
      expect(user.preferences.notifications.push).toBe(true);
      expect(user.preferences.notifications.sms).toBe(false);
      expect(user.preferences.aiPersonalization.enabled).toBe(true);
      expect(user.preferences.aiPersonalization.dataCollection).toBe(true);
      expect(user.preferences.aiPersonalization.recommendations).toBe(true);
    });

    it('should create user with initial metrics', () => {
      // Act
      const user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);

      // Assert
      expect(user.metrics.loginCount).toBe(0);
      expect(user.metrics.sessionDuration).toBe(0);
      expect(user.metrics.featuresUsed).toEqual([]);
      expect(user.metrics.aiInteractions).toBe(0);
      expect(user.metrics.errorReports).toBe(0);
    });

    it('should normalize email to lowercase', () => {
      // Arrange
      const upperCaseEmail = 'JOHN.DOE@EXAMPLE.COM';

      // Act
      const user = User.create(upperCaseEmail, validPasswordHash, validTenantId, validProfile);

      // Assert
      expect(user.email).toBe(upperCaseEmail.toLowerCase());
    });

    it('should trim email whitespace', () => {
      // Arrange
      const emailWithSpaces = '  john.doe@example.com  ';

      // Act
      const user = User.create(emailWithSpaces, validPasswordHash, validTenantId, validProfile);

      // Assert
      expect(user.email).toBe('john.doe@example.com');
    });
  });

  describe('User Creation Validation', () => {
    it('should throw error for invalid email format', () => {
      // Arrange
      const invalidEmail = 'invalid-email';

      // Act & Assert
      expect(() => {
        User.create(invalidEmail, validPasswordHash, validTenantId, validProfile);
      }).toThrow('Invalid email format');
    });

    it('should throw error for empty email', () => {
      // Arrange
      const emptyEmail = '';

      // Act & Assert
      expect(() => {
        User.create(emptyEmail, validPasswordHash, validTenantId, validProfile);
      }).toThrow('Invalid email format');
    });

    it('should throw error for invalid password hash', () => {
      // Arrange
      const shortPasswordHash = 'short';

      // Act & Assert
      expect(() => {
        User.create(validEmail, shortPasswordHash, validTenantId, validProfile);
      }).toThrow('Invalid password hash');
    });

    it('should throw error for empty password hash', () => {
      // Arrange
      const emptyPasswordHash = '';

      // Act & Assert
      expect(() => {
        User.create(validEmail, emptyPasswordHash, validTenantId, validProfile);
      }).toThrow('Invalid password hash');
    });

    it('should throw error for empty tenant ID', () => {
      // Arrange
      const emptyTenantId = '';

      // Act & Assert
      expect(() => {
        User.create(validEmail, validPasswordHash, emptyTenantId, validProfile);
      }).toThrow('Tenant ID is required');
    });
  });

  describe('Profile Updates', () => {
    let user: User;

    beforeEach(() => {
      user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);
    });

    it('should update profile successfully', () => {
      // Arrange
      const newProfile = {
        firstName: 'Jane',
        company: 'New Corp'
      };
      const originalUpdatedAt = user.updatedAt;

      // Act
      user.updateProfile(newProfile);

      // Assert
      expect(user.profile.firstName).toBe('Jane');
      expect(user.profile.lastName).toBe('Doe'); // Should remain unchanged
      expect(user.profile.company).toBe('New Corp');
      expect(user.updatedAt).not.toEqual(originalUpdatedAt);
    });

    it('should throw error for empty first name', () => {
      // Arrange
      const invalidProfile = { firstName: '' };

      // Act & Assert
      expect(() => {
        user.updateProfile(invalidProfile);
      }).toThrow('First name cannot be empty');
    });

    it('should throw error for empty last name', () => {
      // Arrange
      const invalidProfile = { lastName: '   ' };

      // Act & Assert
      expect(() => {
        user.updateProfile(invalidProfile);
      }).toThrow('Last name cannot be empty');
    });
  });

  describe('Preferences Updates', () => {
    let user: User;

    beforeEach(() => {
      user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);
    });

    it('should update preferences successfully', () => {
      // Arrange
      const newPreferences = {
        theme: 'dark' as const,
        language: 'es',
        notifications: {
          email: false,
          push: true,
          sms: true
        }
      };
      const originalUpdatedAt = user.updatedAt;

      // Act
      user.updatePreferences(newPreferences);

      // Assert
      expect(user.preferences.theme).toBe('dark');
      expect(user.preferences.language).toBe('es');
      expect(user.preferences.notifications.email).toBe(false);
      expect(user.preferences.notifications.push).toBe(true);
      expect(user.preferences.notifications.sms).toBe(true);
      expect(user.updatedAt).not.toEqual(originalUpdatedAt);
    });

    it('should throw error for unsupported language', () => {
      // Arrange
      const invalidPreferences = { language: 'invalid-lang' };

      // Act & Assert
      expect(() => {
        user.updatePreferences(invalidPreferences);
      }).toThrow('Unsupported language');
    });

    it('should throw error for invalid timezone', () => {
      // Arrange
      const invalidPreferences = { timezone: 'Invalid/Timezone' };

      // Act & Assert
      expect(() => {
        user.updatePreferences(invalidPreferences);
      }).toThrow('Invalid timezone');
    });

    it('should accept valid timezone', () => {
      // Arrange
      const validPreferences = { timezone: 'America/New_York' };

      // Act & Assert
      expect(() => {
        user.updatePreferences(validPreferences);
      }).not.toThrow();
      expect(user.preferences.timezone).toBe('America/New_York');
    });
  });

  describe('User Metrics', () => {
    let user: User;

    beforeEach(() => {
      user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);
    });

    it('should record login correctly', () => {
      // Arrange
      const originalLoginCount = user.metrics.loginCount;
      const originalUpdatedAt = user.updatedAt;

      // Act
      user.recordLogin();

      // Assert
      expect(user.metrics.loginCount).toBe(originalLoginCount + 1);
      expect(user.metrics.lastLoginAt).toBeInstanceOf(Date);
      expect(user.updatedAt).not.toEqual(originalUpdatedAt);
    });

    it('should record feature usage correctly', () => {
      // Arrange
      const feature = 'dashboard';
      const originalUpdatedAt = user.updatedAt;

      // Act
      user.recordFeatureUsage(feature);

      // Assert
      expect(user.metrics.featuresUsed).toContain(feature);
      expect(user.updatedAt).not.toEqual(originalUpdatedAt);
    });

    it('should not duplicate feature usage', () => {
      // Arrange
      const feature = 'dashboard';

      // Act
      user.recordFeatureUsage(feature);
      user.recordFeatureUsage(feature);

      // Assert
      expect(user.metrics.featuresUsed.filter(f => f === feature)).toHaveLength(1);
    });

    it('should record AI interaction when enabled', () => {
      // Arrange
      const originalAIInteractions = user.metrics.aiInteractions;
      const originalUpdatedAt = user.updatedAt;

      // Act
      user.recordAIInteraction();

      // Assert
      expect(user.metrics.aiInteractions).toBe(originalAIInteractions + 1);
      expect(user.updatedAt).not.toEqual(originalUpdatedAt);
    });

    it('should not record AI interaction when disabled', () => {
      // Arrange
      user.updatePreferences({
        aiPersonalization: {
          enabled: false,
          dataCollection: false,
          recommendations: false
        }
      });
      const originalAIInteractions = user.metrics.aiInteractions;

      // Act
      user.recordAIInteraction();

      // Assert
      expect(user.metrics.aiInteractions).toBe(originalAIInteractions);
    });

    it('should record error report correctly', () => {
      // Arrange
      const originalErrorReports = user.metrics.errorReports;
      const originalUpdatedAt = user.updatedAt;

      // Act
      user.recordErrorReport();

      // Assert
      expect(user.metrics.errorReports).toBe(originalErrorReports + 1);
      expect(user.updatedAt).not.toEqual(originalUpdatedAt);
    });

    it('should update session duration correctly', () => {
      // Arrange
      const duration = 3600; // 1 hour in seconds
      const originalSessionDuration = user.metrics.sessionDuration;
      const originalUpdatedAt = user.updatedAt;

      // Act
      user.updateSessionDuration(duration);

      // Assert
      expect(user.metrics.sessionDuration).toBe(originalSessionDuration + duration);
      expect(user.updatedAt).not.toEqual(originalUpdatedAt);
    });
  });

  describe('User Status Management', () => {
    let user: User;

    beforeEach(() => {
      user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);
    });

    it('should verify user correctly', () => {
      // Act
      const verifiedUser = user.verify();

      // Assert
      expect(verifiedUser.isVerified).toBe(true);
      expect(verifiedUser.id).toBe(user.id);
      expect(verifiedUser.email).toBe(user.email);
    });

    it('should deactivate user correctly', () => {
      // Act
      const deactivatedUser = user.deactivate();

      // Assert
      expect(deactivatedUser.isActive).toBe(false);
      expect(deactivatedUser.id).toBe(user.id);
      expect(deactivatedUser.email).toBe(user.email);
    });
  });

  describe('Role Management', () => {
    let user: User;

    beforeEach(() => {
      user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);
    });

    it('should add role correctly', () => {
      // Arrange
      const newRole = 'admin';

      // Act
      const userWithRole = user.addRole(newRole);

      // Assert
      expect(userWithRole.roles).toContain(newRole);
      expect(userWithRole.roles).toContain('user'); // Original role should remain
      expect(userWithRole.hasRole(newRole)).toBe(true);
    });

    it('should not duplicate existing role', () => {
      // Arrange
      const existingRole = 'user';

      // Act
      const userWithRole = user.addRole(existingRole);

      // Assert
      expect(userWithRole.roles.filter(r => r === existingRole)).toHaveLength(1);
    });

    it('should remove role correctly', () => {
      // Arrange
      const userWithMultipleRoles = user.addRole('admin').addRole('manager');
      const roleToRemove = 'admin';

      // Act
      const userWithoutRole = userWithMultipleRoles.removeRole(roleToRemove);

      // Assert
      expect(userWithoutRole.roles).not.toContain(roleToRemove);
      expect(userWithoutRole.roles).toContain('user');
      expect(userWithoutRole.roles).toContain('manager');
      expect(userWithoutRole.hasRole(roleToRemove)).toBe(false);
    });

    it('should throw error when removing last role', () => {
      // Act & Assert
      expect(() => {
        user.removeRole('user');
      }).toThrow('User must have at least one role');
    });

    it('should check role existence correctly', () => {
      // Arrange
      const userWithAdmin = user.addRole('admin');

      // Assert
      expect(userWithAdmin.hasRole('admin')).toBe(true);
      expect(userWithAdmin.hasRole('user')).toBe(true);
      expect(userWithAdmin.hasRole('manager')).toBe(false);
    });
  });

  describe('Password Management', () => {
    let user: User;

    beforeEach(() => {
      user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);
    });

    it('should update password correctly', () => {
      // Arrange
      const newPasswordHash = 'newhashpassword123456';
      const originalUpdatedAt = user.updatedAt;

      // Act
      user.updatePassword(newPasswordHash);

      // Assert
      expect(user.getPasswordHash()).toBe(newPasswordHash);
      expect(user.updatedAt).not.toEqual(originalUpdatedAt);
    });

    it('should throw error for invalid password hash', () => {
      // Arrange
      const invalidPasswordHash = 'short';

      // Act & Assert
      expect(() => {
        user.updatePassword(invalidPasswordHash);
      }).toThrow('Invalid password hash');
    });
  });

  describe('AI Personalization Data', () => {
    let user: User;

    beforeEach(() => {
      user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);
    });

    it('should return AI data when personalization is enabled', () => {
      // Act
      const aiData = user.getAIPersonalizationData();

      // Assert
      expect(aiData).not.toBeNull();
      expect(aiData.userId).toBe(user.id);
      expect(aiData.tenantId).toBe(user.tenantId);
      expect(aiData.preferences).toBeDefined();
      expect(aiData.metrics).toBeDefined();
      expect(aiData.profile).toBeDefined();
    });

    it('should return null when personalization is disabled', () => {
      // Arrange
      user.updatePreferences({
        aiPersonalization: {
          enabled: false,
          dataCollection: false,
          recommendations: false
        }
      });

      // Act
      const aiData = user.getAIPersonalizationData();

      // Assert
      expect(aiData).toBeNull();
    });

    it('should return null when data collection is disabled', () => {
      // Arrange
      user.updatePreferences({
        aiPersonalization: {
          enabled: true,
          dataCollection: false,
          recommendations: true
        }
      });

      // Act
      const aiData = user.getAIPersonalizationData();

      // Assert
      expect(aiData).toBeNull();
    });
  });

  describe('Persistence', () => {
    let user: User;

    beforeEach(() => {
      user = User.create(validEmail, validPasswordHash, validTenantId, validProfile);
    });

    it('should convert to persistence format correctly', () => {
      // Act
      const persistenceData = user.toPersistence();

      // Assert
      expect(persistenceData.id).toBe(user.id);
      expect(persistenceData.email).toBe(user.email);
      expect(persistenceData.passwordHash).toBe(validPasswordHash);
      expect(persistenceData.tenantId).toBe(user.tenantId);
      expect(persistenceData.profile).toEqual(user.profile);
      expect(persistenceData.preferences).toEqual(user.preferences);
      expect(persistenceData.metrics).toEqual(user.metrics);
      expect(persistenceData.isActive).toBe(user.isActive);
      expect(persistenceData.isVerified).toBe(user.isVerified);
      expect(persistenceData.roles).toEqual(user.roles);
      expect(persistenceData.createdAt).toBe(user.createdAt.toISOString());
      expect(persistenceData.updatedAt).toBe(user.updatedAt.toISOString());
    });

    it('should reconstruct from persistence correctly', () => {
      // Arrange
      const persistenceData = user.toPersistence();

      // Act
      const reconstructedUser = User.fromPersistence(persistenceData);

      // Assert
      expect(reconstructedUser.id).toBe(user.id);
      expect(reconstructedUser.email).toBe(user.email);
      expect(reconstructedUser.getPasswordHash()).toBe(user.getPasswordHash());
      expect(reconstructedUser.tenantId).toBe(user.tenantId);
      expect(reconstructedUser.profile).toEqual(user.profile);
      expect(reconstructedUser.preferences).toEqual(user.preferences);
      expect(reconstructedUser.metrics).toEqual(user.metrics);
      expect(reconstructedUser.isActive).toBe(user.isActive);
      expect(reconstructedUser.isVerified).toBe(user.isVerified);
      expect(reconstructedUser.roles).toEqual(user.roles);
      expect(reconstructedUser.createdAt).toEqual(user.createdAt);
      expect(reconstructedUser.updatedAt).toEqual(user.updatedAt);
    });
  });
});
