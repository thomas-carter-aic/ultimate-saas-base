/**
 * User Event Factory Extensions
 * 
 * Additional factory methods for creating user domain events.
 * Extends the base UserEventFactory with more event types.
 */

import { 
  UserProfileUpdatedEvent,
  UserPreferencesChangedEvent,
  UserVerifiedEvent,
  UserDeactivatedEvent,
  UserRoleAddedEvent,
  UserRoleRemovedEvent
} from './UserEvents';

export class UserEventFactoryExtensions {
  /**
   * Create a UserProfileUpdated event
   */
  static createUserProfileUpdatedEvent(
    user: any,
    previousProfile: Record<string, any>,
    newProfile: Record<string, any>,
    metadata?: Record<string, any>
  ): UserProfileUpdatedEvent {
    const updatedFields = Object.keys(newProfile);
    
    return {
      eventId: this.generateEventId(),
      eventType: 'UserProfileUpdated',
      aggregateId: user.id,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: user.tenantId,
      userId: user.id,
      metadata,
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        previousProfile,
        newProfile,
        updatedFields,
        updatedAt: new Date()
      }
    };
  }

  /**
   * Create a UserPreferencesChanged event
   */
  static createUserPreferencesChangedEvent(
    user: any,
    previousPreferences: Record<string, any>,
    newPreferences: Record<string, any>,
    metadata?: Record<string, any>
  ): UserPreferencesChangedEvent {
    const changedSettings = Object.keys(newPreferences);
    
    return {
      eventId: this.generateEventId(),
      eventType: 'UserPreferencesChanged',
      aggregateId: user.id,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: user.tenantId,
      userId: user.id,
      metadata,
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        previousPreferences,
        newPreferences,
        changedSettings,
        aiPersonalizationEnabled: newPreferences.aiPersonalization?.enabled || 
                                  previousPreferences.aiPersonalization?.enabled || 
                                  false,
        updatedAt: new Date()
      }
    };
  }

  /**
   * Create a UserVerified event
   */
  static createUserVerifiedEvent(
    user: any,
    verificationMethod: 'email' | 'phone' | 'admin',
    metadata?: Record<string, any>
  ): UserVerifiedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'UserVerified',
      aggregateId: user.id,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: user.tenantId,
      userId: user.id,
      metadata,
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        verifiedAt: new Date(),
        verificationMethod
      }
    };
  }

  /**
   * Create a UserDeactivated event
   */
  static createUserDeactivatedEvent(
    user: any,
    deactivatedBy: string,
    reason?: string,
    metadata?: Record<string, any>
  ): UserDeactivatedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'UserDeactivated',
      aggregateId: user.id,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: user.tenantId,
      userId: user.id,
      metadata,
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        deactivatedAt: new Date(),
        reason,
        deactivatedBy
      }
    };
  }

  /**
   * Create a UserRoleAdded event
   */
  static createUserRoleAddedEvent(
    user: any,
    role: string,
    addedBy: string,
    metadata?: Record<string, any>
  ): UserRoleAddedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'UserRoleAdded',
      aggregateId: user.id,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: user.tenantId,
      userId: user.id,
      metadata,
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role,
        addedBy,
        addedAt: new Date(),
        allRoles: user.roles
      }
    };
  }

  /**
   * Create a UserRoleRemoved event
   */
  static createUserRoleRemovedEvent(
    user: any,
    role: string,
    removedBy: string,
    metadata?: Record<string, any>
  ): UserRoleRemovedEvent {
    return {
      eventId: this.generateEventId(),
      eventType: 'UserRoleRemoved',
      aggregateId: user.id,
      aggregateType: 'User',
      eventVersion: 1,
      occurredAt: new Date(),
      tenantId: user.tenantId,
      userId: user.id,
      metadata,
      data: {
        userId: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role,
        removedBy,
        removedAt: new Date(),
        remainingRoles: user.roles
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
