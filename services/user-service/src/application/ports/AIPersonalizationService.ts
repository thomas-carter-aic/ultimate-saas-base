/**
 * AI Personalization Service Port
 * 
 * Interface for AI-driven user personalization and behavior analysis.
 * This port enables the application to leverage AI services for user
 * experience optimization and predictive analytics.
 */

import { UserPreferences, UserProfile } from '../../domain/entities/User';

export interface AIPersonalizationService {
  /**
   * Initialize AI personalization profile for a new user
   * 
   * @param request - User initialization data
   * @returns Promise that resolves when profile is initialized
   */
  initializeUserProfile(request: {
    userId: string;
    tenantId: string;
    profile: UserProfile;
    preferences: UserPreferences;
    initialContext?: Record<string, any>;
  }): Promise<void>;

  /**
   * Update user personalization data based on behavior
   * 
   * @param request - Behavior update data
   * @returns Promise that resolves when data is updated
   */
  updateUserBehavior(request: {
    userId: string;
    tenantId: string;
    behaviorData: {
      action: string;
      feature: string;
      context: Record<string, any>;
      timestamp: Date;
      sessionId?: string;
    };
  }): Promise<void>;

  /**
   * Get personalized recommendations for a user
   * 
   * @param request - Recommendation request
   * @returns Promise resolving to personalized recommendations
   */
  getPersonalizedRecommendations(request: {
    userId: string;
    tenantId: string;
    context?: Record<string, any>;
    limit?: number;
  }): Promise<{
    recommendations: Array<{
      type: 'feature' | 'content' | 'workflow' | 'integration';
      title: string;
      description: string;
      confidence: number;
      metadata?: Record<string, any>;
    }>;
    reasoning?: string;
  }>;

  /**
   * Analyze user patterns for system optimization
   * 
   * @param request - Pattern analysis request
   * @returns Promise resolving to pattern insights
   */
  analyzeUserPatterns(request: {
    userId?: string;
    tenantId: string;
    timeRange?: {
      start: Date;
      end: Date;
    };
    analysisType: 'usage' | 'performance' | 'satisfaction' | 'churn_risk';
  }): Promise<{
    insights: Array<{
      category: string;
      insight: string;
      confidence: number;
      impact: 'low' | 'medium' | 'high';
      actionable: boolean;
      recommendations?: string[];
    }>;
    metrics: Record<string, number>;
  }>;

  /**
   * Predict user behavior for proactive optimization
   * 
   * @param request - Prediction request
   * @returns Promise resolving to behavior predictions
   */
  predictUserBehavior(request: {
    userId: string;
    tenantId: string;
    predictionType: 'churn' | 'feature_adoption' | 'usage_growth' | 'satisfaction';
    timeHorizon: 'week' | 'month' | 'quarter';
  }): Promise<{
    prediction: {
      outcome: string;
      probability: number;
      confidence: number;
      factors: Array<{
        factor: string;
        influence: number;
        description: string;
      }>;
    };
    recommendations: string[];
  }>;

  /**
   * Generate adaptive UI/UX suggestions
   * 
   * @param request - UI adaptation request
   * @returns Promise resolving to UI suggestions
   */
  generateUIAdaptations(request: {
    userId: string;
    tenantId: string;
    currentInterface: Record<string, any>;
    userBehavior: Record<string, any>;
  }): Promise<{
    adaptations: Array<{
      component: string;
      adaptation: string;
      reason: string;
      priority: number;
      implementation: Record<string, any>;
    }>;
  }>;

  /**
   * Process user feedback for model improvement
   * 
   * @param request - Feedback processing request
   * @returns Promise that resolves when feedback is processed
   */
  processFeedback(request: {
    userId: string;
    tenantId: string;
    feedbackType: 'recommendation' | 'prediction' | 'ui_adaptation' | 'general';
    rating: number; // 1-5 scale
    feedback?: string;
    context: Record<string, any>;
  }): Promise<void>;

  /**
   * Get AI model performance metrics
   * 
   * @param request - Metrics request
   * @returns Promise resolving to performance metrics
   */
  getModelMetrics(request: {
    tenantId?: string;
    modelType?: string;
    timeRange?: {
      start: Date;
      end: Date;
    };
  }): Promise<{
    metrics: {
      accuracy: number;
      precision: number;
      recall: number;
      f1Score: number;
      userSatisfaction: number;
      adoptionRate: number;
    };
    trends: Array<{
      date: Date;
      metric: string;
      value: number;
    }>;
  }>;

  /**
   * Trigger model retraining based on new data
   * 
   * @param request - Retraining request
   * @returns Promise that resolves when retraining is initiated
   */
  triggerModelRetraining(request: {
    tenantId?: string;
    modelType: string;
    reason: string;
    priority: 'low' | 'medium' | 'high';
  }): Promise<{
    jobId: string;
    estimatedCompletion: Date;
  }>;
}
