-- Create Tenants Table Migration
-- This migration creates the tenants table with JSONB columns for flexible data storage
-- and proper indexing for performance optimization

-- Enable UUID extension for generating UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tenants table
CREATE TABLE IF NOT EXISTS tenants (
    -- Primary key and identifiers
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    slug VARCHAR(50) NOT NULL UNIQUE,
    owner_id UUID NOT NULL,
    
    -- Tenant settings stored as JSONB for flexibility
    settings JSONB NOT NULL DEFAULT '{
        "branding": {
            "companyName": "",
            "primaryColor": "#007bff",
            "secondaryColor": "#6c757d"
        },
        "features": {
            "aiPersonalization": true,
            "advancedAnalytics": false,
            "customIntegrations": false,
            "whiteLabeling": false,
            "apiAccess": true,
            "ssoIntegration": false
        },
        "security": {
            "passwordPolicy": {
                "minLength": 8,
                "requireUppercase": true,
                "requireLowercase": true,
                "requireNumbers": true,
                "requireSpecialChars": false,
                "maxAge": 90
            },
            "sessionTimeout": 480,
            "mfaRequired": false,
            "ipWhitelist": [],
            "dataRetentionDays": 365
        },
        "compliance": {
            "gdprEnabled": true,
            "hipaaEnabled": false,
            "soc2Enabled": false,
            "dataResidency": "global",
            "auditLogRetention": 2555
        }
    }',
    
    -- Resource limits stored as JSONB
    resource_limits JSONB NOT NULL DEFAULT '{
        "users": {
            "max": 10,
            "current": 0
        },
        "storage": {
            "maxGB": 5,
            "currentGB": 0
        },
        "apiCalls": {
            "monthlyLimit": 10000,
            "currentMonth": 0,
            "resetDate": null
        },
        "aiInteractions": {
            "monthlyLimit": 1000,
            "currentMonth": 0,
            "resetDate": null
        },
        "customIntegrations": {
            "max": 2,
            "current": 0
        }
    }',
    
    -- Billing information stored as JSONB
    billing_info JSONB NOT NULL DEFAULT '{
        "plan": "starter",
        "billingCycle": "monthly",
        "currency": "USD",
        "amount": 2900,
        "nextBillingDate": null,
        "paymentMethod": {
            "type": "card"
        },
        "billingAddress": {
            "street": "",
            "city": "",
            "state": "",
            "postalCode": "",
            "country": "US"
        },
        "taxInfo": {
            "taxRate": 0,
            "taxExempt": false
        }
    }',
    
    -- Tenant metrics for analytics stored as JSONB
    metrics JSONB NOT NULL DEFAULT '{
        "users": {
            "total": 0,
            "active": 0,
            "lastWeekGrowth": 0
        },
        "usage": {
            "storageUsedGB": 0,
            "apiCallsThisMonth": 0,
            "aiInteractionsThisMonth": 0,
            "averageSessionDuration": 0
        },
        "performance": {
            "averageResponseTime": 0,
            "uptime": 100,
            "errorRate": 0
        },
        "billing": {
            "monthlyRevenue": 0,
            "outstandingAmount": 0
        }
    }',
    
    -- Status and lifecycle information
    status VARCHAR(20) NOT NULL DEFAULT 'trial' CHECK (status IN ('active', 'suspended', 'trial', 'cancelled', 'pending')),
    
    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    
    -- Trial and suspension information
    trial_ends_at TIMESTAMP WITH TIME ZONE,
    suspended_at TIMESTAMP WITH TIME ZONE,
    suspension_reason TEXT
);

-- Create indexes for performance optimization

-- Unique index on slug for tenant identification
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug_unique 
ON tenants (slug);

-- Index on owner_id for finding tenants by owner
CREATE INDEX IF NOT EXISTS idx_tenants_owner_id 
ON tenants (owner_id);

-- Index on status for filtering by tenant status
CREATE INDEX IF NOT EXISTS idx_tenants_status 
ON tenants (status);

-- Index on created_at for chronological queries
CREATE INDEX IF NOT EXISTS idx_tenants_created_at 
ON tenants (created_at DESC);

-- Index on updated_at for recently modified queries
CREATE INDEX IF NOT EXISTS idx_tenants_updated_at 
ON tenants (updated_at DESC);

-- Index on trial_ends_at for finding expiring trials
CREATE INDEX IF NOT EXISTS idx_tenants_trial_ends_at 
ON tenants (trial_ends_at) 
WHERE status = 'trial' AND trial_ends_at IS NOT NULL;

-- Index on suspended_at for suspension queries
CREATE INDEX IF NOT EXISTS idx_tenants_suspended_at 
ON tenants (suspended_at) 
WHERE status = 'suspended' AND suspended_at IS NOT NULL;

-- JSONB indexes for settings searches
CREATE INDEX IF NOT EXISTS idx_tenants_settings_branding 
ON tenants USING GIN ((settings->'branding'));

CREATE INDEX IF NOT EXISTS idx_tenants_settings_features 
ON tenants USING GIN ((settings->'features'));

-- JSONB indexes for billing information
CREATE INDEX IF NOT EXISTS idx_tenants_billing_plan 
ON tenants ((billing_info->>'plan'));

CREATE INDEX IF NOT EXISTS idx_tenants_billing_next_date 
ON tenants ((billing_info->>'nextBillingDate')) 
WHERE billing_info->>'nextBillingDate' IS NOT NULL;

-- JSONB indexes for resource limits (for finding tenants exceeding limits)
CREATE INDEX IF NOT EXISTS idx_tenants_resource_usage 
ON tenants USING GIN (resource_limits);

-- Composite index for common queries
CREATE INDEX IF NOT EXISTS idx_tenants_status_created 
ON tenants (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tenants_owner_status 
ON tenants (owner_id, status);

-- Function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at on row changes
CREATE TRIGGER update_tenants_updated_at 
    BEFORE UPDATE ON tenants 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON TABLE tenants IS 'Multi-tenant SaaS platform tenants with settings, limits, and billing';
COMMENT ON COLUMN tenants.id IS 'Unique tenant identifier (UUID)';
COMMENT ON COLUMN tenants.name IS 'Human-readable tenant name';
COMMENT ON COLUMN tenants.slug IS 'URL-safe tenant identifier (unique)';
COMMENT ON COLUMN tenants.owner_id IS 'User ID of the tenant owner';
COMMENT ON COLUMN tenants.settings IS 'Tenant configuration (JSONB): branding, features, security, compliance';
COMMENT ON COLUMN tenants.resource_limits IS 'Resource usage limits (JSONB): users, storage, API calls, AI interactions';
COMMENT ON COLUMN tenants.billing_info IS 'Billing and payment information (JSONB): plan, payment method, address';
COMMENT ON COLUMN tenants.metrics IS 'Tenant usage and performance metrics (JSONB)';
COMMENT ON COLUMN tenants.status IS 'Tenant lifecycle status: active, suspended, trial, cancelled, pending';
COMMENT ON COLUMN tenants.created_at IS 'Tenant creation timestamp';
COMMENT ON COLUMN tenants.updated_at IS 'Last modification timestamp (auto-updated)';
COMMENT ON COLUMN tenants.trial_ends_at IS 'Trial expiration timestamp (null for non-trial tenants)';
COMMENT ON COLUMN tenants.suspended_at IS 'Suspension timestamp (null for non-suspended tenants)';
COMMENT ON COLUMN tenants.suspension_reason IS 'Reason for suspension (null for non-suspended tenants)';

-- Create view for active tenants (commonly used)
CREATE OR REPLACE VIEW active_tenants AS
SELECT 
    id,
    name,
    slug,
    owner_id,
    settings,
    resource_limits,
    billing_info,
    metrics,
    created_at,
    updated_at,
    trial_ends_at
FROM tenants 
WHERE status = 'active';

COMMENT ON VIEW active_tenants IS 'View of active tenants (excludes suspended, cancelled, etc.)';

-- Create view for trial tenants
CREATE OR REPLACE VIEW trial_tenants AS
SELECT 
    id,
    name,
    slug,
    owner_id,
    settings,
    resource_limits,
    billing_info,
    metrics,
    created_at,
    updated_at,
    trial_ends_at,
    CASE 
        WHEN trial_ends_at IS NULL THEN NULL
        ELSE EXTRACT(DAYS FROM (trial_ends_at - NOW()))
    END as days_remaining
FROM tenants 
WHERE status = 'trial';

COMMENT ON VIEW trial_tenants IS 'View of trial tenants with days remaining calculation';

-- Create view for tenants exceeding resource limits
CREATE OR REPLACE VIEW tenants_exceeding_limits AS
SELECT 
    id,
    name,
    slug,
    status,
    resource_limits,
    CASE 
        WHEN (resource_limits->'users'->>'current')::int >= (resource_limits->'users'->>'max')::int * 0.9 
        THEN 'users'
        WHEN (resource_limits->'storage'->>'currentGB')::float >= (resource_limits->'storage'->>'maxGB')::float * 0.9 
        THEN 'storage'
        WHEN (resource_limits->'apiCalls'->>'currentMonth')::int >= (resource_limits->'apiCalls'->>'monthlyLimit')::int * 0.9 
        THEN 'apiCalls'
        WHEN (resource_limits->'aiInteractions'->>'currentMonth')::int >= (resource_limits->'aiInteractions'->>'monthlyLimit')::int * 0.9 
        THEN 'aiInteractions'
        ELSE 'none'
    END as exceeding_resource,
    updated_at
FROM tenants 
WHERE status IN ('active', 'trial')
AND (
    (resource_limits->'users'->>'current')::int >= (resource_limits->'users'->>'max')::int * 0.9
    OR (resource_limits->'storage'->>'currentGB')::float >= (resource_limits->'storage'->>'maxGB')::float * 0.9
    OR (resource_limits->'apiCalls'->>'currentMonth')::int >= (resource_limits->'apiCalls'->>'monthlyLimit')::int * 0.9
    OR (resource_limits->'aiInteractions'->>'currentMonth')::int >= (resource_limits->'aiInteractions'->>'monthlyLimit')::int * 0.9
);

COMMENT ON VIEW tenants_exceeding_limits IS 'View of tenants approaching or exceeding resource limits (90% threshold)';

-- Grant appropriate permissions (adjust based on your security model)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON tenants TO tenant_service_role;
-- GRANT SELECT ON active_tenants TO tenant_service_role;
-- GRANT SELECT ON trial_tenants TO tenant_service_role;
-- GRANT SELECT ON tenants_exceeding_limits TO monitoring_role;
