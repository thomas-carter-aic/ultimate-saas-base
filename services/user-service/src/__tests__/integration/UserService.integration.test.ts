/**
 * User Service Integration Tests
 * 
 * Integration tests for the complete User Service functionality.
 * Tests the interaction between all layers of the clean architecture.
 */

import { CreateUserUseCase } from '../../application/usecases/CreateUserUseCase';
import { GetUserUseCase } from '../../application/usecases/GetUserUseCase';
import { UpdateUserUseCase } from '../../application/usecases/UpdateUserUseCase';
import { ListUsersUseCase } from '../../application/usecases/ListUsersUseCase';
import { User } from '../../domain/entities/User';

describe('User Service Integration Tests', () => {
  let createUserUseCase: CreateUserUseCase;
  let getUserUseCase: GetUserUseCase;
  let updateUserUseCase: UpdateUserUseCase;
  let listUsersUseCase: ListUsersUseCase;
  
  let mockUserRepository: any;
  let mockEventPublisher: any;
  let mockLogger: any;
  let mockAIPersonalizationService: any;

  beforeEach(() => {
    // Create mocks using global test utilities
    mockUserRepository = global.testUtils.createMockUserRepository();
    mockEventPublisher = global.testUtils.createMockEventPublisher();
    mockLogger = global.testUtils.createMockLogger();
    mockAIPersonalizationService = global.testUtils.createMockAIPersonalizationService();

    // Initialize use cases
    createUserUseCase = new CreateUserUseCase(
      mockUserRepository,
      mockEventPublisher,
      mockLogger,
      mockAIPersonalizationService
    );

    getUserUseCase = new GetUserUseCase(
      mockUserRepository,
      mockLogger
    );

    updateUserUseCase = new UpdateUserUseCase(
      mockUserRepository,
      mockEventPublisher,
      mockLogger
    );

    listUsersUseCase = new ListUsersUseCase(
      mockUserRepository,
      mockLogger
    );
  });

  describe('User Creation Flow', () => {
    it('should create a user successfully with all integrations', async () => {
      // Arrange
      const createRequest = {
        email: 'john.doe@example.com',
        password: 'SecurePass123!',
        tenantId: 'tenant-123',
        profile: {
          firstName: 'John',
          lastName: 'Doe',
          company: 'Tech Corp',
          jobTitle: 'Software Engineer'
        },
        roles: ['user'],
        metadata: {
          source: 'integration_test'
        }
      };

      // Mock repository to return null for existing user check
      mockUserRepository.findByEmail.mockResolvedValue(null);
      
      // Mock repository to return saved user
      const savedUser = User.create(
        createRequest.email,
        'hashed_password',
        createRequest.tenantId,
        createRequest.profile
      );
      mockUserRepository.save.mockResolvedValue(savedUser);

      // Act
      const result = await createUserUseCase.execute(createRequest);

      // Assert
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user!.email).toBe(createRequest.email.toLowerCase());
      expect(result.user!.tenantId).toBe(createRequest.tenantId);
      expect(result.user!.profile.firstName).toBe(createRequest.profile.firstName);

      // Verify repository interactions
      expect(mockUserRepository.findByEmail).toHaveBeenCalledWith(createRequest.email);
      expect(mockUserRepository.save).toHaveBeenCalledWith(expect.any(User));

      // Verify event publishing
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'UserCreated',
          aggregateId: savedUser.id,
          data: expect.objectContaining({
            userId: savedUser.id,
            email: savedUser.email,
            tenantId: savedUser.tenantId
          })
        })
      );

      // Verify AI personalization initialization
      expect(mockAIPersonalizationService.initializeUserProfile).toHaveBeenCalledWith({
        userId: savedUser.id,
        tenantId: savedUser.tenantId,
        profile: savedUser.profile,
        preferences: savedUser.preferences,
        initialContext: expect.objectContaining({
          createdAt: savedUser.createdAt,
          roles: savedUser.roles,
          source: 'user_creation'
        })
      });

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User created successfully',
        expect.objectContaining({
          userId: savedUser.id,
          email: savedUser.email,
          tenantId: savedUser.tenantId
        })
      );
    });

    it('should handle duplicate email error', async () => {
      // Arrange
      const createRequest = {
        email: 'existing@example.com',
        password: 'SecurePass123!',
        tenantId: 'tenant-123',
        profile: {
          firstName: 'John',
          lastName: 'Doe'
        }
      };

      const existingUser = User.create(
        createRequest.email,
        'existing_hash',
        createRequest.tenantId,
        createRequest.profile
      );

      mockUserRepository.findByEmail.mockResolvedValue(existingUser);

      // Act
      const result = await createUserUseCase.execute(createRequest);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('User with this email already exists');
      expect(mockUserRepository.save).not.toHaveBeenCalled();
      expect(mockEventPublisher.publish).not.toHaveBeenCalled();
    });

    it('should handle validation errors', async () => {
      // Arrange
      const invalidRequest = {
        email: 'invalid-email',
        password: 'weak',
        tenantId: '',
        profile: {
          firstName: '',
          lastName: 'Doe'
        }
      };

      // Act
      const result = await createUserUseCase.execute(invalidRequest);

      // Assert
      expect(result.success).toBe(false);
      expect(result.validationErrors).toBeDefined();
      expect(result.validationErrors!.email).toContain('Valid email address is required');
      expect(result.validationErrors!.password).toContain('Password must be at least 8 characters');
      expect(result.validationErrors!.tenantId).toContain('Tenant ID is required');
      expect(result.validationErrors!.firstName).toContain('First name is required');
    });
  });

  describe('User Retrieval Flow', () => {
    it('should retrieve user successfully', async () => {
      // Arrange
      const userId = 'user-123';
      const tenantId = 'tenant-123';
      const requestedBy = 'user-123'; // Same user

      const user = User.create(
        'john.doe@example.com',
        'hashed_password',
        tenantId,
        {
          firstName: 'John',
          lastName: 'Doe',
          company: 'Tech Corp'
        }
      );

      mockUserRepository.findById.mockResolvedValue(user);

      // Act
      const result = await getUserUseCase.execute({
        userId,
        tenantId,
        requestedBy
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user!.id).toBe(user.id);
      expect(result.user!.email).toBe(user.email);

      // Verify repository interaction
      expect(mockUserRepository.findById).toHaveBeenCalledWith(userId);

      // Verify logging
      expect(mockLogger.info).toHaveBeenCalledWith(
        'User retrieved successfully',
        expect.objectContaining({
          userId,
          tenantId,
          requestedBy
        })
      );
    });

    it('should handle user not found', async () => {
      // Arrange
      const userId = 'non-existent-user';
      const tenantId = 'tenant-123';
      const requestedBy = 'user-123';

      mockUserRepository.findById.mockResolvedValue(null);

      // Act
      const result = await getUserUseCase.execute({
        userId,
        tenantId,
        requestedBy
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not found');
      expect(result.user).toBeUndefined();
    });

    it('should handle cross-tenant access attempt', async () => {
      // Arrange
      const userId = 'user-123';
      const tenantId = 'tenant-123';
      const requestedBy = 'user-456';

      const user = User.create(
        'john.doe@example.com',
        'hashed_password',
        'different-tenant-id', // Different tenant
        {
          firstName: 'John',
          lastName: 'Doe'
        }
      );

      mockUserRepository.findById.mockResolvedValue(user);

      // Act
      const result = await getUserUseCase.execute({
        userId,
        tenantId,
        requestedBy
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('User not found'); // Don't reveal cross-tenant info
      
      // Verify security logging
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Cross-tenant access attempt blocked',
        expect.objectContaining({
          userId,
          userTenantId: user.tenantId,
          requestTenantId: tenantId,
          requestedBy
        })
      );
    });
  });

  describe('User Update Flow', () => {
    it('should update user profile successfully', async () => {
      // Arrange
      const userId = 'user-123';
      const tenantId = 'tenant-123';
      const updatedBy = 'user-123'; // Same user

      const existingUser = User.create(
        'john.doe@example.com',
        'hashed_password',
        tenantId,
        {
          firstName: 'John',
          lastName: 'Doe',
          company: 'Old Corp'
        }
      );

      const profileUpdates = {
        profile: {
          company: 'New Corp',
          jobTitle: 'Senior Engineer'
        }
      };

      mockUserRepository.findById.mockResolvedValue(existingUser);
      
      // Mock the updated user
      const updatedUser = User.fromPersistence({
        ...existingUser.toPersistence(),
        profile: {
          ...existingUser.profile,
          ...profileUpdates.profile
        }
      });
      mockUserRepository.update.mockResolvedValue(updatedUser);

      // Act
      const result = await updateUserUseCase.execute({
        userId,
        tenantId,
        updates: profileUpdates,
        updatedBy
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.user).toBeDefined();
      expect(result.user!.profile.company).toBe('New Corp');
      expect(result.user!.profile.jobTitle).toBe('Senior Engineer');

      // Verify repository interactions
      expect(mockUserRepository.findById).toHaveBeenCalledWith(userId);
      expect(mockUserRepository.update).toHaveBeenCalledWith(expect.any(User));

      // Verify event publishing
      expect(mockEventPublisher.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'UserProfileUpdated',
          aggregateId: userId,
          data: expect.objectContaining({
            userId,
            tenantId,
            newProfile: profileUpdates.profile
          })
        })
      );
    });

    it('should handle unauthorized update attempt', async () => {
      // Arrange
      const userId = 'user-123';
      const tenantId = 'tenant-123';
      const updatedBy = 'user-456'; // Different user

      const existingUser = User.create(
        'john.doe@example.com',
        'hashed_password',
        tenantId,
        {
          firstName: 'John',
          lastName: 'Doe'
        }
      );

      const updates = {
        roles: ['admin'] // Trying to update roles
      };

      mockUserRepository.findById.mockResolvedValue(existingUser);

      // Act
      const result = await updateUserUseCase.execute({
        userId,
        tenantId,
        updates,
        updatedBy
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot modify administrative fields');
      expect(mockUserRepository.update).not.toHaveBeenCalled();
    });
  });

  describe('User Listing Flow', () => {
    it('should list users successfully for admin', async () => {
      // Arrange
      const tenantId = 'tenant-123';
      const requestedBy = 'admin-user-123';

      const adminUser = User.create(
        'admin@example.com',
        'hashed_password',
        tenantId,
        {
          firstName: 'Admin',
          lastName: 'User'
        }
      ).addRole('admin');

      const users = [
        User.create('user1@example.com', 'hash1', tenantId, { firstName: 'User', lastName: 'One' }),
        User.create('user2@example.com', 'hash2', tenantId, { firstName: 'User', lastName: 'Two' })
      ];

      mockUserRepository.findById.mockResolvedValue(adminUser);
      mockUserRepository.countByTenantId.mockResolvedValue(2);
      mockUserRepository.search.mockResolvedValue(users);

      // Act
      const result = await listUsersUseCase.execute({
        tenantId,
        requestedBy,
        pagination: {
          page: 1,
          limit: 20
        }
      });

      // Assert
      expect(result.success).toBe(true);
      expect(result.users).toHaveLength(2);
      expect(result.pagination).toBeDefined();
      expect(result.pagination!.total).toBe(2);
      expect(result.pagination!.page).toBe(1);
      expect(result.pagination!.limit).toBe(20);

      // Verify repository interactions
      expect(mockUserRepository.findById).toHaveBeenCalledWith(requestedBy);
      expect(mockUserRepository.countByTenantId).toHaveBeenCalledWith(tenantId);
      expect(mockUserRepository.search).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId,
          offset: 0,
          limit: 20
        })
      );
    });

    it('should deny access for non-admin users', async () => {
      // Arrange
      const tenantId = 'tenant-123';
      const requestedBy = 'regular-user-123';

      const regularUser = User.create(
        'user@example.com',
        'hashed_password',
        tenantId,
        {
          firstName: 'Regular',
          lastName: 'User'
        }
      );

      mockUserRepository.findById.mockResolvedValue(regularUser);

      // Act
      const result = await listUsersUseCase.execute({
        tenantId,
        requestedBy,
        pagination: {
          page: 1,
          limit: 20
        }
      });

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Admin role required to list users');
      expect(mockUserRepository.search).not.toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle repository errors gracefully', async () => {
      // Arrange
      const createRequest = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        tenantId: 'tenant-123',
        profile: {
          firstName: 'Test',
          lastName: 'User'
        }
      };

      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.save.mockRejectedValue(new Error('Database connection failed'));

      // Act
      const result = await createUserUseCase.execute(createRequest);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal server error occurred during user creation');

      // Verify error logging
      expect(mockLogger.error).toHaveBeenCalledWith(
        'User creation failed with unexpected error',
        expect.objectContaining({
          error: 'Database connection failed'
        })
      );
    });

    it('should handle event publishing errors gracefully', async () => {
      // Arrange
      const createRequest = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        tenantId: 'tenant-123',
        profile: {
          firstName: 'Test',
          lastName: 'User'
        }
      };

      const savedUser = User.create(
        createRequest.email,
        'hashed_password',
        createRequest.tenantId,
        createRequest.profile
      );

      mockUserRepository.findByEmail.mockResolvedValue(null);
      mockUserRepository.save.mockResolvedValue(savedUser);
      mockEventPublisher.publish.mockRejectedValue(new Error('Kafka connection failed'));

      // Act
      const result = await createUserUseCase.execute(createRequest);

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Internal server error occurred during user creation');

      // Verify that user was saved despite event publishing failure
      expect(mockUserRepository.save).toHaveBeenCalled();
    });
  });
});
