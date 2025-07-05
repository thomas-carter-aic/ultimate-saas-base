/**
 * Jest Test Setup
 * 
 * Global test configuration and setup for the User Service test suite.
 * Configures test environment, mocks, and utilities.
 */

import { jest } from '@jest/globals';

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests
process.env.DATABASE_HOST = 'localhost';
process.env.DATABASE_PORT = '5432';
process.env.DATABASE_NAME = 'user_service_test';
process.env.DATABASE_USER = 'test_user';
process.env.DATABASE_PASSWORD = 'test_password';
process.env.KAFKA_BROKERS = 'localhost:9092';
process.env.AWS_REGION = 'us-east-1';

// Mock external dependencies
jest.mock('kafkajs', () => ({
  Kafka: jest.fn().mockImplementation(() => ({
    producer: jest.fn().mockReturnValue({
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockResolvedValue([{ partition: 0, offset: '1' }]),
      on: jest.fn()
    })
  }))
}));

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: jest.fn()
    }),
    query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    end: jest.fn().mockResolvedValue(undefined)
  }))
}));

jest.mock('@aws-sdk/client-sagemaker', () => ({
  SageMakerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({})
  })),
  InvokeEndpointCommand: jest.fn(),
  DescribeEndpointCommand: jest.fn(),
  CreateEndpointCommand: jest.fn(),
  CreateEndpointConfigCommand: jest.fn(),
  CreateModelCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-comprehend', () => ({
  ComprehendClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Sentiment: 'POSITIVE',
      SentimentScore: {
        Positive: 0.8,
        Negative: 0.1,
        Neutral: 0.1,
        Mixed: 0.0
      }
    })
  })),
  DetectSentimentCommand: jest.fn(),
  DetectKeyPhrasesCommand: jest.fn(),
  DetectEntitiesCommand: jest.fn()
}));

// Global test utilities
global.testUtils = {
  createMockUser: () => ({
    id: 'test-user-id',
    email: 'test@example.com',
    tenantId: 'test-tenant-id',
    profile: {
      firstName: 'Test',
      lastName: 'User',
      company: 'Test Corp',
      jobTitle: 'Tester'
    },
    roles: ['user'],
    isActive: true,
    isVerified: false,
    createdAt: new Date(),
    updatedAt: new Date()
  }),
  
  createMockLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn().mockReturnThis()
  }),
  
  createMockEventPublisher: () => ({
    publish: jest.fn().mockResolvedValue(undefined),
    publishBatch: jest.fn().mockResolvedValue(undefined),
    publishWithRetry: jest.fn().mockResolvedValue(undefined)
  }),
  
  createMockUserRepository: () => ({
    save: jest.fn(),
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findByTenantId: jest.fn(),
    findByRole: jest.fn(),
    findActiveByTenantId: jest.fn(),
    countByTenantId: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findUsersForAIAnalytics: jest.fn(),
    findInactiveUsers: jest.fn(),
    getUserMetricsByTenant: jest.fn(),
    search: jest.fn()
  }),
  
  createMockAIPersonalizationService: () => ({
    initializeUserProfile: jest.fn().mockResolvedValue(undefined),
    updateUserBehavior: jest.fn().mockResolvedValue(undefined),
    getPersonalizedRecommendations: jest.fn().mockResolvedValue({
      recommendations: [],
      reasoning: 'Test reasoning'
    }),
    analyzeUserPatterns: jest.fn().mockResolvedValue({
      insights: [],
      metrics: {}
    }),
    predictUserBehavior: jest.fn().mockResolvedValue({
      prediction: {
        outcome: 'positive',
        probability: 0.8,
        confidence: 0.9,
        factors: []
      },
      recommendations: []
    }),
    generateUIAdaptations: jest.fn().mockResolvedValue({
      adaptations: []
    }),
    processFeedback: jest.fn().mockResolvedValue(undefined),
    getModelMetrics: jest.fn().mockResolvedValue({
      metrics: {
        accuracy: 0.85,
        precision: 0.82,
        recall: 0.78,
        f1Score: 0.80,
        userSatisfaction: 0.88,
        adoptionRate: 0.65
      },
      trends: []
    }),
    triggerModelRetraining: jest.fn().mockResolvedValue({
      jobId: 'test-job-id',
      estimatedCompletion: new Date()
    })
  })
};

// Extend Jest matchers if needed
declare global {
  namespace jest {
    interface Matchers<R> {
      // Add custom matchers here if needed
    }
  }
  
  var testUtils: {
    createMockUser: () => any;
    createMockLogger: () => any;
    createMockEventPublisher: () => any;
    createMockUserRepository: () => any;
    createMockAIPersonalizationService: () => any;
  };
}

// Setup and teardown
beforeEach(() => {
  jest.clearAllMocks();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Handle unhandled promise rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

export {};
