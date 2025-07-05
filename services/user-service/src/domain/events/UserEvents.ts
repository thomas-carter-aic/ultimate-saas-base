/**
 * User Domain Events
 * 
 * Domain events that are published when significant user-related actions occur.
 * These events enable event-driven architecture and allow other services to react
 * to user changes without tight coupling.
 */

export interface DomainEvent {
  eventId: string;
  eventType: string;
  aggregateId: string;
  aggregateType: string;
  eventVersion: number;
  occurredAt: Date;
  tenantId: string;
  userId?: string;
  metadata?: Record<string, any>;
}

/**
 * Published when a new user is created
 */
export interface UserCreatedEvent extends DomainEvent {
  eventType: 'UserCreated';
  aggregateType: 'User';
  data: {
    userId: string;
    email: string;
    tenantId: string;
    profile: {
      firstName: string;
      lastName: string;
      company?: string;
      jobTitle?: string;
    };
    roles: string[];
    createdAt: Date;
  };
}

/**
 * Published when user profile is updated
 */
export interface UserProfileUpdatedEvent extends DomainEvent {
  eventType: 'UserProfileUpdated';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    previousProfile: Record<string, any>;
    newProfile: Record<string, any>;
    updatedFields: string[];
    updatedAt: Date;
  };
}

/**
 * Published when user preferences are changed
 */
export interface UserPreferencesChangedEvent extends DomainEvent {
  eventType: 'UserPreferencesChanged';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    previousPreferences: Record<string, any>;
    newPreferences: Record<string, any>;
    changedSettings: string[];
    aiPersonalizationEnabled: boolean;
    updatedAt: Date;
  };
}

/**
 * Published when user logs in
 */
export interface UserLoggedInEvent extends DomainEvent {
  eventType: 'UserLoggedIn';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    email: string;
    loginCount: number;
    loginAt: Date;
    ipAddress?: string;
    userAgent?: string;
    location?: string;
  };
}

/**
 * Published when user logs out
 */
export interface UserLoggedOutEvent extends DomainEvent {
  eventType: 'UserLoggedOut';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    sessionDuration: number;
    logoutAt: Date;
    featuresUsedInSession: string[];
  };
}

/**
 * Published when user account is verified
 */
export interface UserVerifiedEvent extends DomainEvent {
  eventType: 'UserVerified';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    email: string;
    verifiedAt: Date;
    verificationMethod: 'email' | 'phone' | 'admin';
  };
}

/**
 * Published when user account is deactivated
 */
export interface UserDeactivatedEvent extends DomainEvent {
  eventType: 'UserDeactivated';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    email: string;
    deactivatedAt: Date;
    reason?: string;
    deactivatedBy?: string;
  };
}

/**
 * Published when user password is changed
 */
export interface UserPasswordChangedEvent extends DomainEvent {
  eventType: 'UserPasswordChanged';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    email: string;
    changedAt: Date;
    changedBy: 'user' | 'admin' | 'system';
    requiresReauth: boolean;
  };
}

/**
 * Published when user role is added
 */
export interface UserRoleAddedEvent extends DomainEvent {
  eventType: 'UserRoleAdded';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    email: string;
    role: string;
    addedBy: string;
    addedAt: Date;
    allRoles: string[];
  };
}

/**
 * Published when user role is removed
 */
export interface UserRoleRemovedEvent extends DomainEvent {
  eventType: 'UserRoleRemoved';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    email: string;
    role: string;
    removedBy: string;
    removedAt: Date;
    remainingRoles: string[];
  };
}

/**
 * Published when user uses a feature (for AI learning)
 */
export interface UserFeatureUsedEvent extends DomainEvent {
  eventType: 'UserFeatureUsed';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    feature: string;
    featureCategory: string;
    usedAt: Date;
    context?: Record<string, any>;
    sessionId?: string;
  };
}

/**
 * Published when user interacts with AI features
 */
export interface UserAIInteractionEvent extends DomainEvent {
  eventType: 'UserAIInteraction';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    interactionType: 'query' | 'recommendation' | 'automation' | 'insight';
    aiService: string;
    interactionAt: Date;
    inputData?: Record<string, any>;
    outputData?: Record<string, any>;
    satisfaction?: number; // 1-5 rating
    feedback?: string;
  };
}

/**
 * Published when user reports an error
 */
export interface UserErrorReportedEvent extends DomainEvent {
  eventType: 'UserErrorReported';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    errorType: string;
    errorMessage: string;
    errorContext: Record<string, any>;
    reportedAt: Date;
    severity: 'low' | 'medium' | 'high' | 'critical';
    userAgent?: string;
    url?: string;
    stackTrace?: string;
  };
}

/**
 * Published when user session expires
 */
export interface UserSessionExpiredEvent extends DomainEvent {
  eventType: 'UserSessionExpired';
  aggregateType: 'User';
  data: {
    userId: string;
    tenantId: string;
    sessionId: string;
    sessionDuration: number;
    expiredAt: Date;
    reason: 'timeout' | 'inactivity' | 'security' | 'logout';
  };
}

/**
 * Union type for all user events
 */
export type UserEvent = 
  | UserCreatedEvent
  | UserProfileUpdatedEvent
  | UserPreferencesChangedEvent
  | UserLoggedInEvent
  | UserLoggedOutEvent
  | UserVerifiedEvent
  | UserDeactivatedEvent
  | UserPasswordChangedEvent
  | UserRoleAddedEvent
  | UserRoleRemovedEvent
  | UserFeatureUsedEvent
  | UserAIInteractionEvent
  | UserErrorReportedEvent
  | UserSessionExpiredEvent;

/**
 * Event factory for creating user events
 */
export class UserEventFactory {
  /**
   * Create a UserCreated event
   */
  static createUserCreatedEvent(
    user: any,
    metadata?: Record<string, any>
  ): UserCreatedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'UserCreated',
      aggregateId: user.id,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: user.tenantId,
      userId: user.id,
      metadata,
      data: {
        userId: user.id,
        email: user.email,
        tenantId: user.tenantId,
        profile: {
          firstName: user.profile.firstName,
          lastName: user.profile.lastName,
          company: user.profile.company,
          jobTitle: user.profile.jobTitle
        },
        roles: user.roles,
        createdAt: user.createdAt
      }
    };
  }

  /**
   * Create a UserLoggedIn event
   */
  static createUserLoggedInEvent(
    user: any,
    loginContext?: Record<string, any>
  ): UserLoggedInEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'UserLoggedIn',
      aggregateId: user.id,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: user.tenantId,
      userId: user.id,
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        loginCount: user.metrics.loginCount,
        loginAt: new Date(),
        ipAddress: loginContext?.ipAddress,
        userAgent: loginContext?.userAgent,
        location: loginContext?.location
      }
    };
  }

  /**
   * Create a UserFeatureUsed event
   */
  static createUserFeatureUsedEvent(
    userId: string,
    tenantId: string,
    feature: string,
    featureCategory: string,
    context?: Record<string, any>
  ): UserFeatureUsedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'UserFeatureUsed',
      aggregateId: userId,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId,
      userId,
      data: {
        userId,
        tenantId,
        feature,
        featureCategory,
        usedAt: new Date(),
        context,
        sessionId: context?.sessionId
      }
    };
  }

  /**
   * Create a UserAIInteraction event
   */
  static createUserAIInteractionEvent(
    userId: string,
    tenantId: string,
    interactionType: 'query' | 'recommendation' | 'automation' | 'insight',
    aiService: string,
    inputData?: Record<string, any>,
    outputData?: Record<string, any>
  ): UserAIInteractionEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'UserAIInteraction',
      aggregateId: userId,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId,
      userId,
      data: {
        userId,
        tenantId,
        interactionType,
        aiService,
        interactionAt: new Date(),
        inputData,
        outputData
      }
    };
  }

  /**
   * Generate unique event ID
   */
  private static generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
