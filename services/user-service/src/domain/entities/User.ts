/**
 * User Domain Entity
 * 
 * Core business entity representing a user in the system.
 * This entity encapsulates all user-related business logic and rules,
 * following Domain-Driven Design principles.
 */

import { v4 as uuidv4 } from 'uuid';

export interface UserPreferences {
  theme: 'light' | 'dark' | 'auto';
  language: string;
  timezone: string;
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
  };
  aiPersonalization: {
    enabled: boolean;
    dataCollection: boolean;
    recommendations: boolean;
  };
}

export interface UserProfile {
  firstName: string;
  lastName: string;
  avatar?: string;
  bio?: string;
  company?: string;
  jobTitle?: string;
  location?: string;
}

export interface UserMetrics {
  loginCount: number;
  lastLoginAt?: Date;
  sessionDuration: number;
  featuresUsed: string[];
  aiInteractions: number;
  errorReports: number;
}

export class User {
  private constructor(
    public readonly id: string,
    public readonly email: string,
    private _passwordHash: string,
    public readonly tenantId: string,
    public profile: UserProfile,
    public preferences: UserPreferences,
    public metrics: UserMetrics,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public readonly isActive: boolean = true,
    public readonly isVerified: boolean = false,
    public readonly roles: string[] = ['user']
  ) {}

  /**
   * Factory method to create a new user
   * Ensures all business rules are applied during user creation
   */
  public static create(
    email: string,
    passwordHash: string,
    tenantId: string,
    profile: UserProfile
  ): User {
    // Business rule: Email must be valid format
    if (!this.isValidEmail(email)) {
      throw new Error('Invalid email format');
    }

    // Business rule: Password hash must be provided
    if (!passwordHash || passwordHash.length < 10) {
      throw new Error('Invalid password hash');
    }

    // Business rule: Tenant ID must be provided
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }

    // Default preferences for new users
    const defaultPreferences: UserPreferences = {
      theme: 'auto',
      language: 'en',
      timezone: 'UTC',
      notifications: {
        email: true,
        push: true,
        sms: false
      },
      aiPersonalization: {
        enabled: true,
        dataCollection: true,
        recommendations: true
      }
    };

    // Initialize user metrics
    const initialMetrics: UserMetrics = {
      loginCount: 0,
      sessionDuration: 0,
      featuresUsed: [],
      aiInteractions: 0,
      errorReports: 0
    };

    const now = new Date();
    
    return new User(
      uuidv4(),
      email.toLowerCase().trim(),
      passwordHash,
      tenantId,
      profile,
      defaultPreferences,
      initialMetrics,
      now,
      now
    );
  }

  /**
   * Factory method to reconstruct user from persistence
   */
  public static fromPersistence(data: any): User {
    return new User(
      data.id,
      data.email,
      data.passwordHash,
      data.tenantId,
      data.profile,
      data.preferences,
      data.metrics,
      new Date(data.createdAt),
      new Date(data.updatedAt),
      data.isActive,
      data.isVerified,
      data.roles
    );
  }

  /**
   * Update user profile with business validation
   */
  public updateProfile(newProfile: Partial<UserProfile>): void {
    // Business rule: First name and last name are required
    if (newProfile.firstName !== undefined && !newProfile.firstName.trim()) {
      throw new Error('First name cannot be empty');
    }
    
    if (newProfile.lastName !== undefined && !newProfile.lastName.trim()) {
      throw new Error('Last name cannot be empty');
    }

    this.profile = { ...this.profile, ...newProfile };
    this.updatedAt = new Date();
  }

  /**
   * Update user preferences with validation
   */
  public updatePreferences(newPreferences: Partial<UserPreferences>): void {
    // Business rule: Language must be supported
    if (newPreferences.language && !this.isSupportedLanguage(newPreferences.language)) {
      throw new Error('Unsupported language');
    }

    // Business rule: Timezone must be valid
    if (newPreferences.timezone && !this.isValidTimezone(newPreferences.timezone)) {
      throw new Error('Invalid timezone');
    }

    this.preferences = { ...this.preferences, ...newPreferences };
    this.updatedAt = new Date();
  }

  /**
   * Record user login for analytics and AI personalization
   */
  public recordLogin(): void {
    this.metrics.loginCount += 1;
    this.metrics.lastLoginAt = new Date();
    this.updatedAt = new Date();
  }

  /**
   * Record feature usage for AI-driven recommendations
   */
  public recordFeatureUsage(feature: string): void {
    if (!this.metrics.featuresUsed.includes(feature)) {
      this.metrics.featuresUsed.push(feature);
    }
    this.updatedAt = new Date();
  }

  /**
   * Record AI interaction for learning and improvement
   */
  public recordAIInteraction(): void {
    if (this.preferences.aiPersonalization.enabled) {
      this.metrics.aiInteractions += 1;
      this.updatedAt = new Date();
    }
  }

  /**
   * Record error report for system learning
   */
  public recordErrorReport(): void {
    this.metrics.errorReports += 1;
    this.updatedAt = new Date();
  }

  /**
   * Update session duration for analytics
   */
  public updateSessionDuration(duration: number): void {
    this.metrics.sessionDuration += duration;
    this.updatedAt = new Date();
  }

  /**
   * Verify user account
   */
  public verify(): User {
    return new User(
      this.id,
      this.email,
      this._passwordHash,
      this.tenantId,
      this.profile,
      this.preferences,
      this.metrics,
      this.createdAt,
      new Date(),
      this.isActive,
      true, // Set verified to true
      this.roles
    );
  }

  /**
   * Deactivate user account
   */
  public deactivate(): User {
    return new User(
      this.id,
      this.email,
      this._passwordHash,
      this.tenantId,
      this.profile,
      this.preferences,
      this.metrics,
      this.createdAt,
      new Date(),
      false, // Set active to false
      this.isVerified,
      this.roles
    );
  }

  /**
   * Add role to user
   */
  public addRole(role: string): User {
    if (this.roles.includes(role)) {
      return this; // Role already exists
    }

    return new User(
      this.id,
      this.email,
      this._passwordHash,
      this.tenantId,
      this.profile,
      this.preferences,
      this.metrics,
      this.createdAt,
      new Date(),
      this.isActive,
      this.isVerified,
      [...this.roles, role]
    );
  }

  /**
   * Remove role from user
   */
  public removeRole(role: string): User {
    // Business rule: User must always have at least one role
    if (this.roles.length <= 1) {
      throw new Error('User must have at least one role');
    }

    return new User(
      this.id,
      this.email,
      this._passwordHash,
      this.tenantId,
      this.profile,
      this.preferences,
      this.metrics,
      this.createdAt,
      new Date(),
      this.isActive,
      this.isVerified,
      this.roles.filter(r => r !== role)
    );
  }

  /**
   * Check if user has specific role
   */
  public hasRole(role: string): boolean {
    return this.roles.includes(role);
  }

  /**
   * Get password hash (protected access)
   */
  public getPasswordHash(): string {
    return this._passwordHash;
  }

  /**
   * Update password hash
   */
  public updatePassword(newPasswordHash: string): void {
    if (!newPasswordHash || newPasswordHash.length < 10) {
      throw new Error('Invalid password hash');
    }
    
    this._passwordHash = newPasswordHash;
    this.updatedAt = new Date();
  }

  /**
   * Get user data for AI personalization (respects privacy settings)
   */
  public getAIPersonalizationData(): any {
    if (!this.preferences.aiPersonalization.enabled || 
        !this.preferences.aiPersonalization.dataCollection) {
      return null;
    }

    return {
      userId: this.id,
      tenantId: this.tenantId,
      preferences: this.preferences,
      metrics: {
        loginCount: this.metrics.loginCount,
        featuresUsed: this.metrics.featuresUsed,
        aiInteractions: this.metrics.aiInteractions
      },
      profile: {
        company: this.profile.company,
        jobTitle: this.profile.jobTitle,
        location: this.profile.location
      }
    };
  }

  /**
   * Convert to plain object for persistence
   */
  public toPersistence(): any {
    return {
      id: this.id,
      email: this.email,
      passwordHash: this._passwordHash,
      tenantId: this.tenantId,
      profile: this.profile,
      preferences: this.preferences,
      metrics: this.metrics,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString(),
      isActive: this.isActive,
      isVerified: this.isVerified,
      roles: this.roles
    };
  }

  // Private validation methods

  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  private isSupportedLanguage(language: string): boolean {
    const supportedLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh'];
    return supportedLanguages.includes(language);
  }

  private isValidTimezone(timezone: string): boolean {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
      return true;
    } catch {
      return false;
    }
  }
}
