-- Plugin Service Database Schema
-- Creates tables for plugin management, execution tracking, and logging

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create plugins table
CREATE TABLE IF NOT EXISTS plugins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    manifest JSONB NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    tenant_id VARCHAR(255) NOT NULL,
    uploaded_by VARCHAR(255) NOT NULL,
    configuration JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    installed_at TIMESTAMP WITH TIME ZONE,
    last_executed_at TIMESTAMP WITH TIME ZONE,
    execution_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    average_execution_time FLOAT DEFAULT 0,
    
    -- Constraints
    CONSTRAINT plugins_status_check CHECK (status IN (
        'pending', 'validating', 'validated', 'installing', 
        'installed', 'active', 'inactive', 'error', 
        'deprecated', 'removed'
    ))
);

-- Create plugin executions table
CREATE TABLE IF NOT EXISTS plugin_executions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plugin_id UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    execution_id VARCHAR(255) NOT NULL,
    function_name VARCHAR(255) NOT NULL,
    parameters JSONB,
    context JSONB,
    trigger_type VARCHAR(50) NOT NULL,
    success BOOLEAN NOT NULL,
    result JSONB,
    error_message TEXT,
    execution_time INTEGER NOT NULL, -- milliseconds
    memory_used INTEGER, -- bytes
    cpu_used FLOAT, -- percentage
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT plugin_executions_trigger_check CHECK (trigger_type IN (
        'api', 'event', 'schedule', 'hook'
    ))
);

-- Create plugin logs table
CREATE TABLE IF NOT EXISTS plugin_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plugin_id UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    execution_id VARCHAR(255),
    tenant_id VARCHAR(255) NOT NULL,
    level VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    metadata JSONB,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Constraints
    CONSTRAINT plugin_logs_level_check CHECK (level IN (
        'error', 'warn', 'info', 'debug'
    ))
);

-- Create plugin dependencies table
CREATE TABLE IF NOT EXISTS plugin_dependencies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plugin_id UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    dependency_name VARCHAR(255) NOT NULL,
    dependency_version VARCHAR(50) NOT NULL,
    dependency_type VARCHAR(50) NOT NULL, -- 'plugin', 'service', 'module'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint to prevent duplicate dependencies
    UNIQUE(plugin_id, dependency_name, dependency_type)
);

-- Create plugin ratings table (for marketplace)
CREATE TABLE IF NOT EXISTS plugin_ratings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plugin_id UUID NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    tenant_id VARCHAR(255) NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    review TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint to prevent multiple ratings from same user
    UNIQUE(plugin_id, tenant_id, user_id)
);

-- Create indexes for performance

-- Plugins table indexes
CREATE INDEX IF NOT EXISTS idx_plugins_tenant_id ON plugins(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plugins_status ON plugins(status);
CREATE INDEX IF NOT EXISTS idx_plugins_uploaded_by ON plugins(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_plugins_created_at ON plugins(created_at);
CREATE INDEX IF NOT EXISTS idx_plugins_last_executed_at ON plugins(last_executed_at);

-- JSONB indexes for plugin manifest queries
CREATE INDEX IF NOT EXISTS idx_plugins_manifest_name ON plugins USING GIN ((manifest->'metadata'->>'name'));
CREATE INDEX IF NOT EXISTS idx_plugins_manifest_category ON plugins USING GIN ((manifest->'metadata'->>'category'));
CREATE INDEX IF NOT EXISTS idx_plugins_manifest_author ON plugins USING GIN ((manifest->'metadata'->>'author'));
CREATE INDEX IF NOT EXISTS idx_plugins_manifest_tags ON plugins USING GIN ((manifest->'metadata'->'tags'));
CREATE INDEX IF NOT EXISTS idx_plugins_manifest_permissions ON plugins USING GIN ((manifest->'security'->'permissions'));

-- Plugin executions table indexes
CREATE INDEX IF NOT EXISTS idx_plugin_executions_plugin_id ON plugin_executions(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_tenant_id ON plugin_executions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_user_id ON plugin_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_started_at ON plugin_executions(started_at);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_success ON plugin_executions(success);
CREATE INDEX IF NOT EXISTS idx_plugin_executions_trigger_type ON plugin_executions(trigger_type);

-- Plugin logs table indexes
CREATE INDEX IF NOT EXISTS idx_plugin_logs_plugin_id ON plugin_logs(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_tenant_id ON plugin_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_level ON plugin_logs(level);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_timestamp ON plugin_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_plugin_logs_execution_id ON plugin_logs(execution_id);

-- Plugin dependencies table indexes
CREATE INDEX IF NOT EXISTS idx_plugin_dependencies_plugin_id ON plugin_dependencies(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_dependencies_name ON plugin_dependencies(dependency_name);

-- Plugin ratings table indexes
CREATE INDEX IF NOT EXISTS idx_plugin_ratings_plugin_id ON plugin_ratings(plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_ratings_tenant_id ON plugin_ratings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_plugin_ratings_rating ON plugin_ratings(rating);

-- Create views for common queries

-- Plugin summary view
CREATE OR REPLACE VIEW plugin_summary AS
SELECT 
    p.id,
    p.manifest->'metadata'->>'name' as name,
    p.manifest->'metadata'->>'version' as version,
    p.manifest->'metadata'->>'description' as description,
    p.manifest->'metadata'->>'author' as author,
    p.manifest->'metadata'->>'category' as category,
    p.status,
    p.tenant_id,
    p.created_at,
    p.updated_at,
    p.execution_count,
    p.error_count,
    CASE 
        WHEN p.execution_count > 0 THEN (p.error_count::float / p.execution_count * 100)
        ELSE 0 
    END as error_rate,
    p.average_execution_time,
    COALESCE(r.avg_rating, 0) as average_rating,
    COALESCE(r.rating_count, 0) as rating_count
FROM plugins p
LEFT JOIN (
    SELECT 
        plugin_id,
        AVG(rating::float) as avg_rating,
        COUNT(*) as rating_count
    FROM plugin_ratings
    GROUP BY plugin_id
) r ON p.id = r.plugin_id;

-- Plugin execution stats view
CREATE OR REPLACE VIEW plugin_execution_stats AS
SELECT 
    plugin_id,
    COUNT(*) as total_executions,
    COUNT(*) FILTER (WHERE success = true) as successful_executions,
    COUNT(*) FILTER (WHERE success = false) as failed_executions,
    AVG(execution_time) as avg_execution_time,
    MIN(execution_time) as min_execution_time,
    MAX(execution_time) as max_execution_time,
    AVG(memory_used) as avg_memory_used,
    MAX(memory_used) as max_memory_used
FROM plugin_executions
GROUP BY plugin_id;

-- Tenant plugin usage view
CREATE OR REPLACE VIEW tenant_plugin_usage AS
SELECT 
    tenant_id,
    COUNT(*) as total_plugins,
    COUNT(*) FILTER (WHERE status = 'active') as active_plugins,
    COUNT(*) FILTER (WHERE status = 'inactive') as inactive_plugins,
    COUNT(*) FILTER (WHERE status = 'error') as error_plugins,
    SUM(execution_count) as total_executions,
    AVG(CASE WHEN execution_count > 0 THEN error_count::float / execution_count ELSE 0 END) as avg_error_rate
FROM plugins
GROUP BY tenant_id;

-- Create triggers for automatic timestamp updates

-- Update updated_at timestamp on plugins table
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_plugins_updated_at 
    BEFORE UPDATE ON plugins 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_plugin_ratings_updated_at 
    BEFORE UPDATE ON plugin_ratings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Create function to clean up old plugin data
CREATE OR REPLACE FUNCTION cleanup_plugin_data(
    days_to_keep INTEGER DEFAULT 90
) RETURNS TABLE(
    logs_deleted INTEGER,
    executions_deleted INTEGER
) AS $$
DECLARE
    logs_count INTEGER;
    executions_count INTEGER;
BEGIN
    -- Delete old plugin logs
    DELETE FROM plugin_logs 
    WHERE timestamp < NOW() - INTERVAL '1 day' * days_to_keep;
    
    GET DIAGNOSTICS logs_count = ROW_COUNT;
    
    -- Delete old plugin executions (keep more recent ones)
    DELETE FROM plugin_executions 
    WHERE started_at < NOW() - INTERVAL '1 day' * (days_to_keep * 2);
    
    GET DIAGNOSTICS executions_count = ROW_COUNT;
    
    RETURN QUERY SELECT logs_count, executions_count;
END;
$$ LANGUAGE plpgsql;

-- Create function to get plugin health score
CREATE OR REPLACE FUNCTION get_plugin_health_score(plugin_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    health_score INTEGER := 100;
    error_rate FLOAT;
    avg_exec_time FLOAT;
    last_execution TIMESTAMP;
BEGIN
    -- Get plugin stats
    SELECT 
        CASE WHEN execution_count > 0 THEN error_count::float / execution_count ELSE 0 END,
        average_execution_time,
        last_executed_at
    INTO error_rate, avg_exec_time, last_execution
    FROM plugins 
    WHERE id = plugin_uuid;
    
    -- Deduct points for high error rate
    IF error_rate > 0.1 THEN -- More than 10% error rate
        health_score := health_score - 30;
    ELSIF error_rate > 0.05 THEN -- More than 5% error rate
        health_score := health_score - 15;
    END IF;
    
    -- Deduct points for slow execution
    IF avg_exec_time > 10000 THEN -- More than 10 seconds
        health_score := health_score - 20;
    ELSIF avg_exec_time > 5000 THEN -- More than 5 seconds
        health_score := health_score - 10;
    END IF;
    
    -- Deduct points for inactivity
    IF last_execution IS NULL OR last_execution < NOW() - INTERVAL '30 days' THEN
        health_score := health_score - 25;
    ELSIF last_execution < NOW() - INTERVAL '7 days' THEN
        health_score := health_score - 10;
    END IF;
    
    -- Ensure score is between 0 and 100
    health_score := GREATEST(0, LEAST(100, health_score));
    
    RETURN health_score;
END;
$$ LANGUAGE plpgsql;

-- Insert initial data or configuration if needed
-- (This would be environment-specific)

COMMENT ON TABLE plugins IS 'Stores plugin metadata, configuration, and execution statistics';
COMMENT ON TABLE plugin_executions IS 'Tracks individual plugin execution instances';
COMMENT ON TABLE plugin_logs IS 'Stores plugin execution logs and debug information';
COMMENT ON TABLE plugin_dependencies IS 'Tracks plugin dependencies for conflict resolution';
COMMENT ON TABLE plugin_ratings IS 'Stores user ratings and reviews for plugins';

COMMENT ON VIEW plugin_summary IS 'Provides a summary view of plugins with ratings and statistics';
COMMENT ON VIEW plugin_execution_stats IS 'Aggregates plugin execution statistics';
COMMENT ON VIEW tenant_plugin_usage IS 'Summarizes plugin usage by tenant';

COMMENT ON FUNCTION cleanup_plugin_data IS 'Cleans up old plugin logs and execution records';
COMMENT ON FUNCTION get_plugin_health_score IS 'Calculates a health score for a plugin based on various metrics';
