-- Create Users Table Migration
-- This migration creates the users table with JSONB columns for flexible data storage
-- and proper indexing for performance optimization

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table
CREATE TABLE IF NOT EXISTS users (
    -- Primary key and identifiers
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    tenant_id UUID NOT NULL,
    
    -- User profile data stored as JSONB for flexibility
    profile JSONB NOT NULL DEFAULT '{}',
    
    -- User preferences stored as JSONB
    preferences JSONB NOT NULL DEFAULT '{
        "theme": "auto",
        "language": "en",
        "timezone": "UTC",
        "notifications": {
            "email": true,
            "push": true,
            "sms": false
        },
        "aiPersonalization": {
            "enabled": true,
            "dataCollection": true,
            "recommendations": true
        }
    }',
    
    -- User metrics for AI analysis stored as JSONB
    metrics JSONB NOT NULL DEFAULT '{
        "loginCount": 0,
        "sessionDuration": 0,
        "featuresUsed": [],
        "aiInteractions": 0,
        "errorReports": 0
    }',
    
    -- Status and role information
    is_active BOOLEAN NOT NULL DEFAULT true,
    is_verified BOOLEAN NOT NULL DEFAULT false,
    roles TEXT[] NOT NULL DEFAULT ARRAY['user'],
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for performance optimization

-- Unique index on email (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique 
ON users (LOWER(email)) 
WHERE is_active = true;

-- Index on tenant_id for multi-tenant queries
CREATE INDEX IF NOT EXISTS idx_users_tenant_id 
ON users (tenant_id) 
WHERE is_active = true;

-- Index on tenant_id and is_active for common queries
CREATE INDEX IF NOT EXISTS idx_users_tenant_active 
ON users (tenant_id, is_active);

-- Index on tenant_id and is_verified for active user queries
CREATE INDEX IF NOT EXISTS idx_users_tenant_verified 
ON users (tenant_id, is_verified) 
WHERE is_active = true;

-- Index on roles array for role-based queries
CREATE INDEX IF NOT EXISTS idx_users_roles 
ON users USING GIN (roles);

-- Index on created_at for chronological queries
CREATE INDEX IF NOT EXISTS idx_users_created_at 
ON users (created_at DESC);

-- Index on updated_at for recently modified queries
CREATE INDEX IF NOT EXISTS idx_users_updated_at 
ON users (updated_at DESC);

-- JSONB indexes for profile searches
CREATE INDEX IF NOT EXISTS idx_users_profile_company 
ON users USING GIN ((profile->'company'));

CREATE INDEX IF NOT EXISTS idx_users_profile_name 
ON users USING GIN ((profile->'firstName'), (profile->'lastName'));

-- JSONB indexes for preferences
CREATE INDEX IF NOT EXISTS idx_users_ai_personalization 
ON users USING GIN ((preferences->'aiPersonalization'));

-- JSONB indexes for metrics (for AI analytics)
CREATE INDEX IF NOT EXISTS idx_users_metrics_features 
ON users USING GIN ((metrics->'featuresUsed'));

CREATE INDEX IF NOT EXISTS idx_users_metrics_login 
ON users ((metrics->>'lastLoginAt')) 
WHERE metrics->>'lastLoginAt' IS NOT NULL;

-- Partial index for AI-enabled users
CREATE INDEX IF NOT EXISTS idx_users_ai_enabled 
ON users (tenant_id, updated_at) 
WHERE is_active = true 
AND (preferences->'aiPersonalization'->>'enabled')::boolean = true 
AND (preferences->'aiPersonalization'->>'dataCollection')::boolean = true;

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at on row changes
CREATE TRIGGER update_users_updated_at 
    BEFORE UPDATE ON users 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE users IS 'User accounts with profile, preferences, and metrics data';
COMMENT ON COLUMN users.id IS 'Unique user identifier (UUID)';
COMMENT ON COLUMN users.email IS 'User email address (unique per tenant)';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt hashed password';
COMMENT ON COLUMN users.tenant_id IS 'Tenant identifier for multi-tenancy';
COMMENT ON COLUMN users.profile IS 'User profile data (JSONB): firstName, lastName, company, etc.';
COMMENT ON COLUMN users.preferences IS 'User preferences (JSONB): theme, language, notifications, AI settings';
COMMENT ON COLUMN users.metrics IS 'User behavior metrics (JSONB): login count, features used, AI interactions';
COMMENT ON COLUMN users.is_active IS 'Whether the user account is active (soft delete flag)';
COMMENT ON COLUMN users.is_verified IS 'Whether the user email has been verified';
COMMENT ON COLUMN users.roles IS 'Array of user roles for RBAC';
COMMENT ON COLUMN users.created_at IS 'Account creation timestamp';
COMMENT ON COLUMN users.updated_at IS 'Last modification timestamp (auto-updated)';

-- Create view for active users (commonly used)
CREATE OR REPLACE VIEW active_users AS
SELECT 
    id,
    email,
    tenant_id,
    profile,
    preferences,
    metrics,
    roles,
    is_verified,
    created_at,
    updated_at
FROM users 
WHERE is_active = true;

COMMENT ON VIEW active_users IS 'View of active users (excludes soft-deleted accounts)';

-- Create view for AI analytics (users with AI personalization enabled)
CREATE OR REPLACE VIEW ai_enabled_users AS
SELECT 
    id,
    email,
    tenant_id,
    profile,
    preferences,
    metrics,
    roles,
    created_at,
    updated_at
FROM users 
WHERE is_active = true 
AND (preferences->'aiPersonalization'->>'enabled')::boolean = true 
AND (preferences->'aiPersonalization'->>'dataCollection')::boolean = true;

COMMENT ON VIEW ai_enabled_users IS 'View of users with AI personalization and data collection enabled';

-- Grant appropriate permissions (adjust based on your security model)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON users TO user_service_role;
-- GRANT SELECT ON active_users TO user_service_role;
-- GRANT SELECT ON ai_enabled_users TO ai_service_role;
