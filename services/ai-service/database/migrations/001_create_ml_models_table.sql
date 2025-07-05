-- AI Service Database Schema
-- ML Models and Training Infrastructure

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ML Models table - Core model metadata and configuration
CREATE TABLE ml_models (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    framework VARCHAR(50) NOT NULL, -- tensorflow, pytorch, scikit-learn, xgboost, onnx
    category VARCHAR(50) NOT NULL, -- classification, regression, nlp, computer_vision, etc.
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    artifact_path TEXT NOT NULL, -- S3 path to model artifacts
    
    -- Model configuration and schemas (JSONB for flexibility and performance)
    configuration JSONB NOT NULL DEFAULT '{}',
    input_schema JSONB NOT NULL DEFAULT '{}',
    output_schema JSONB NOT NULL DEFAULT '{}',
    
    -- Performance metrics and deployment configuration
    performance_metrics JSONB DEFAULT '{}', -- accuracy, precision, recall, f1, latency, etc.
    deployment_config JSONB DEFAULT '{}', -- resources, scaling, health checks
    
    -- Metadata and organization
    tags TEXT[] DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, training, trained, validated, deployed, retired
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CONSTRAINT ml_models_tenant_name_version_unique UNIQUE (tenant_id, name, version),
    CONSTRAINT ml_models_framework_check CHECK (framework IN ('tensorflow', 'pytorch', 'scikit-learn', 'xgboost', 'onnx')),
    CONSTRAINT ml_models_status_check CHECK (status IN ('draft', 'training', 'trained', 'validated', 'deployed', 'retired'))
);

-- Indexes for optimal query performance
CREATE INDEX idx_ml_models_tenant_id ON ml_models(tenant_id);
CREATE INDEX idx_ml_models_framework ON ml_models(framework);
CREATE INDEX idx_ml_models_category ON ml_models(category);
CREATE INDEX idx_ml_models_status ON ml_models(status);
CREATE INDEX idx_ml_models_created_at ON ml_models(created_at DESC);
CREATE INDEX idx_ml_models_updated_at ON ml_models(updated_at DESC);
CREATE INDEX idx_ml_models_tags ON ml_models USING GIN(tags);
CREATE INDEX idx_ml_models_name_trgm ON ml_models USING GIN(name gin_trgm_ops);

-- JSONB indexes for performance metrics queries
CREATE INDEX idx_ml_models_accuracy ON ml_models USING GIN((performance_metrics->'accuracy'));
CREATE INDEX idx_ml_models_latency ON ml_models USING GIN((performance_metrics->'latency'));
CREATE INDEX idx_ml_models_config ON ml_models USING GIN(configuration);

-- Training Jobs table - Track model training processes
CREATE TABLE ml_training_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES ml_models(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    
    -- Training configuration
    training_config JSONB NOT NULL DEFAULT '{}',
    dataset_config JSONB NOT NULL DEFAULT '{}',
    hyperparameters JSONB DEFAULT '{}',
    
    -- Resource allocation
    resource_config JSONB DEFAULT '{}', -- CPU, memory, GPU requirements
    distributed_config JSONB DEFAULT '{}', -- Multi-worker training setup
    
    -- Training progress and results
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, running, completed, failed, cancelled
    progress FLOAT DEFAULT 0.0, -- 0.0 to 1.0
    current_epoch INTEGER DEFAULT 0,
    total_epochs INTEGER,
    
    -- Training metrics and logs
    training_metrics JSONB DEFAULT '{}', -- loss, accuracy per epoch
    validation_metrics JSONB DEFAULT '{}', -- validation scores
    training_logs TEXT[], -- Training log messages
    
    -- Timing and resource usage
    started_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    estimated_completion TIMESTAMP WITH TIME ZONE,
    resource_usage JSONB DEFAULT '{}', -- CPU, memory, GPU utilization
    
    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    
    -- Constraints
    CONSTRAINT ml_training_jobs_status_check CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    CONSTRAINT ml_training_jobs_progress_check CHECK (progress >= 0.0 AND progress <= 1.0)
);

-- Indexes for training jobs
CREATE INDEX idx_ml_training_jobs_model_id ON ml_training_jobs(model_id);
CREATE INDEX idx_ml_training_jobs_tenant_id ON ml_training_jobs(tenant_id);
CREATE INDEX idx_ml_training_jobs_status ON ml_training_jobs(status);
CREATE INDEX idx_ml_training_jobs_created_at ON ml_training_jobs(created_at DESC);
CREATE INDEX idx_ml_training_jobs_started_at ON ml_training_jobs(started_at DESC);

-- Model Usage Statistics table - Track prediction usage and performance
CREATE TABLE ml_model_usage (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES ml_models(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    
    -- Usage metrics
    prediction_count BIGINT DEFAULT 0,
    error_count BIGINT DEFAULT 0,
    total_latency BIGINT DEFAULT 0, -- Total latency in milliseconds
    
    -- Performance tracking
    average_latency FLOAT GENERATED ALWAYS AS (
        CASE WHEN prediction_count > 0 
        THEN total_latency::FLOAT / prediction_count 
        ELSE 0 END
    ) STORED,
    
    error_rate FLOAT GENERATED ALWAYS AS (
        CASE WHEN (prediction_count + error_count) > 0 
        THEN error_count::FLOAT / (prediction_count + error_count) 
        ELSE 0 END
    ) STORED,
    
    -- Time tracking
    last_used_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Unique constraint for daily aggregation
    CONSTRAINT ml_model_usage_unique UNIQUE (model_id, tenant_id, DATE(created_at))
);

-- Indexes for usage statistics
CREATE INDEX idx_ml_model_usage_model_id ON ml_model_usage(model_id);
CREATE INDEX idx_ml_model_usage_tenant_id ON ml_model_usage(tenant_id);
CREATE INDEX idx_ml_model_usage_created_at ON ml_model_usage(created_at DESC);
CREATE INDEX idx_ml_model_usage_last_used_at ON ml_model_usage(last_used_at DESC);

-- Model Deployments table - Track model deployment instances
CREATE TABLE ml_model_deployments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES ml_models(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    
    -- Deployment configuration
    deployment_name VARCHAR(255) NOT NULL,
    environment VARCHAR(50) NOT NULL DEFAULT 'production', -- development, staging, production
    endpoint_url TEXT,
    
    -- Scaling and resource configuration
    min_replicas INTEGER DEFAULT 1,
    max_replicas INTEGER DEFAULT 10,
    current_replicas INTEGER DEFAULT 1,
    resource_limits JSONB DEFAULT '{}', -- CPU, memory limits per replica
    
    -- Health and monitoring
    status VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending, deploying, healthy, unhealthy, failed
    health_check_url TEXT,
    last_health_check TIMESTAMP WITH TIME ZONE,
    health_score FLOAT DEFAULT 1.0, -- 0.0 to 1.0
    
    -- Performance metrics
    request_count BIGINT DEFAULT 0,
    error_count BIGINT DEFAULT 0,
    average_response_time FLOAT DEFAULT 0.0,
    
    -- Deployment lifecycle
    deployed_at TIMESTAMP WITH TIME ZONE,
    last_updated TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    
    -- Constraints
    CONSTRAINT ml_model_deployments_tenant_name_unique UNIQUE (tenant_id, deployment_name),
    CONSTRAINT ml_model_deployments_status_check CHECK (status IN ('pending', 'deploying', 'healthy', 'unhealthy', 'failed')),
    CONSTRAINT ml_model_deployments_environment_check CHECK (environment IN ('development', 'staging', 'production')),
    CONSTRAINT ml_model_deployments_health_score_check CHECK (health_score >= 0.0 AND health_score <= 1.0)
);

-- Indexes for deployments
CREATE INDEX idx_ml_model_deployments_model_id ON ml_model_deployments(model_id);
CREATE INDEX idx_ml_model_deployments_tenant_id ON ml_model_deployments(tenant_id);
CREATE INDEX idx_ml_model_deployments_status ON ml_model_deployments(status);
CREATE INDEX idx_ml_model_deployments_environment ON ml_model_deployments(environment);
CREATE INDEX idx_ml_model_deployments_deployed_at ON ml_model_deployments(deployed_at DESC);

-- Model Experiments table - Track A/B testing and model comparison
CREATE TABLE ml_model_experiments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id UUID NOT NULL,
    experiment_name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Experiment configuration
    experiment_type VARCHAR(50) NOT NULL DEFAULT 'ab_test', -- ab_test, champion_challenger, multi_armed_bandit
    traffic_split JSONB NOT NULL DEFAULT '{}', -- Model ID to traffic percentage mapping
    
    -- Experiment models
    control_model_id UUID REFERENCES ml_models(id),
    treatment_model_ids UUID[] DEFAULT '{}',
    
    -- Experiment status and lifecycle
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, running, paused, completed, cancelled
    start_date TIMESTAMP WITH TIME ZONE,
    end_date TIMESTAMP WITH TIME ZONE,
    
    -- Success criteria and metrics
    success_metrics JSONB DEFAULT '{}', -- Metrics to optimize for
    statistical_significance FLOAT DEFAULT 0.95,
    minimum_sample_size INTEGER DEFAULT 1000,
    
    -- Results and analysis
    results JSONB DEFAULT '{}',
    winner_model_id UUID,
    confidence_level FLOAT,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    
    -- Constraints
    CONSTRAINT ml_model_experiments_tenant_name_unique UNIQUE (tenant_id, experiment_name),
    CONSTRAINT ml_model_experiments_status_check CHECK (status IN ('draft', 'running', 'paused', 'completed', 'cancelled')),
    CONSTRAINT ml_model_experiments_experiment_type_check CHECK (experiment_type IN ('ab_test', 'champion_challenger', 'multi_armed_bandit'))
);

-- Indexes for experiments
CREATE INDEX idx_ml_model_experiments_tenant_id ON ml_model_experiments(tenant_id);
CREATE INDEX idx_ml_model_experiments_status ON ml_model_experiments(status);
CREATE INDEX idx_ml_model_experiments_start_date ON ml_model_experiments(start_date DESC);
CREATE INDEX idx_ml_model_experiments_control_model_id ON ml_model_experiments(control_model_id);

-- Model Artifacts table - Track model files and versions
CREATE TABLE ml_model_artifacts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    model_id UUID NOT NULL REFERENCES ml_models(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    
    -- Artifact information
    artifact_type VARCHAR(50) NOT NULL, -- model, weights, config, metadata, logs
    file_name VARCHAR(255) NOT NULL,
    file_path TEXT NOT NULL, -- S3 path
    file_size BIGINT NOT NULL,
    file_hash VARCHAR(64) NOT NULL, -- SHA-256 hash for integrity
    content_type VARCHAR(100),
    
    -- Versioning
    version VARCHAR(50) NOT NULL,
    is_primary BOOLEAN DEFAULT FALSE, -- Primary artifact for the model
    
    -- Metadata
    metadata JSONB DEFAULT '{}',
    tags TEXT[] DEFAULT '{}',
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    uploaded_by UUID,
    
    -- Constraints
    CONSTRAINT ml_model_artifacts_model_version_type_unique UNIQUE (model_id, version, artifact_type),
    CONSTRAINT ml_model_artifacts_artifact_type_check CHECK (artifact_type IN ('model', 'weights', 'config', 'metadata', 'logs', 'dataset'))
);

-- Indexes for artifacts
CREATE INDEX idx_ml_model_artifacts_model_id ON ml_model_artifacts(model_id);
CREATE INDEX idx_ml_model_artifacts_tenant_id ON ml_model_artifacts(tenant_id);
CREATE INDEX idx_ml_model_artifacts_artifact_type ON ml_model_artifacts(artifact_type);
CREATE INDEX idx_ml_model_artifacts_version ON ml_model_artifacts(version);
CREATE INDEX idx_ml_model_artifacts_created_at ON ml_model_artifacts(created_at DESC);
CREATE INDEX idx_ml_model_artifacts_file_hash ON ml_model_artifacts(file_hash);

-- Materialized Views for Analytics and Reporting

-- Model Performance Summary View
CREATE MATERIALIZED VIEW ml_model_performance_summary AS
SELECT 
    m.id as model_id,
    m.tenant_id,
    m.name,
    m.framework,
    m.category,
    m.status,
    
    -- Performance metrics from model
    (m.performance_metrics->>'accuracy')::FLOAT as accuracy,
    (m.performance_metrics->>'precision')::FLOAT as precision,
    (m.performance_metrics->>'recall')::FLOAT as recall,
    (m.performance_metrics->>'f1_score')::FLOAT as f1_score,
    (m.performance_metrics->>'latency')::FLOAT as latency,
    
    -- Usage statistics
    COALESCE(SUM(u.prediction_count), 0) as total_predictions,
    COALESCE(SUM(u.error_count), 0) as total_errors,
    COALESCE(AVG(u.average_latency), 0) as avg_latency,
    COALESCE(AVG(u.error_rate), 0) as avg_error_rate,
    
    -- Deployment information
    COUNT(d.id) as deployment_count,
    COUNT(CASE WHEN d.status = 'healthy' THEN 1 END) as healthy_deployments,
    
    -- Training information
    COUNT(t.id) as training_job_count,
    COUNT(CASE WHEN t.status = 'completed' THEN 1 END) as successful_trainings,
    
    -- Timestamps
    m.created_at,
    m.updated_at,
    MAX(u.last_used_at) as last_used_at
    
FROM ml_models m
LEFT JOIN ml_model_usage u ON m.id = u.model_id
LEFT JOIN ml_model_deployments d ON m.id = d.model_id
LEFT JOIN ml_training_jobs t ON m.id = t.model_id
GROUP BY m.id, m.tenant_id, m.name, m.framework, m.category, m.status, 
         m.performance_metrics, m.created_at, m.updated_at;

-- Create unique index for materialized view
CREATE UNIQUE INDEX idx_ml_model_performance_summary_model_id 
ON ml_model_performance_summary(model_id);

-- Tenant ML Statistics View
CREATE MATERIALIZED VIEW ml_tenant_statistics AS
SELECT 
    tenant_id,
    
    -- Model counts
    COUNT(*) as total_models,
    COUNT(CASE WHEN status = 'deployed' THEN 1 END) as deployed_models,
    COUNT(CASE WHEN status = 'training' THEN 1 END) as training_models,
    
    -- Framework distribution
    COUNT(CASE WHEN framework = 'tensorflow' THEN 1 END) as tensorflow_models,
    COUNT(CASE WHEN framework = 'pytorch' THEN 1 END) as pytorch_models,
    COUNT(CASE WHEN framework = 'scikit-learn' THEN 1 END) as sklearn_models,
    COUNT(CASE WHEN framework = 'xgboost' THEN 1 END) as xgboost_models,
    COUNT(CASE WHEN framework = 'onnx' THEN 1 END) as onnx_models,
    
    -- Category distribution
    COUNT(CASE WHEN category = 'classification' THEN 1 END) as classification_models,
    COUNT(CASE WHEN category = 'regression' THEN 1 END) as regression_models,
    COUNT(CASE WHEN category = 'nlp' THEN 1 END) as nlp_models,
    COUNT(CASE WHEN category = 'computer_vision' THEN 1 END) as cv_models,
    
    -- Performance averages
    AVG((performance_metrics->>'accuracy')::FLOAT) as avg_accuracy,
    AVG((performance_metrics->>'latency')::FLOAT) as avg_latency,
    
    -- Usage statistics
    COALESCE(SUM(u.prediction_count), 0) as total_predictions,
    COALESCE(SUM(u.error_count), 0) as total_errors,
    COALESCE(AVG(u.error_rate), 0) as avg_error_rate,
    
    -- Timestamps
    MIN(m.created_at) as first_model_created,
    MAX(m.updated_at) as last_model_updated,
    MAX(u.last_used_at) as last_prediction_at
    
FROM ml_models m
LEFT JOIN ml_model_usage u ON m.id = u.model_id
GROUP BY tenant_id;

-- Create unique index for tenant statistics
CREATE UNIQUE INDEX idx_ml_tenant_statistics_tenant_id 
ON ml_tenant_statistics(tenant_id);

-- Functions for automatic updates

-- Function to update model updated_at timestamp
CREATE OR REPLACE FUNCTION update_ml_model_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for ml_models updated_at
CREATE TRIGGER trigger_ml_models_updated_at
    BEFORE UPDATE ON ml_models
    FOR EACH ROW
    EXECUTE FUNCTION update_ml_model_updated_at();

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_ml_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY ml_model_performance_summary;
    REFRESH MATERIALIZED VIEW CONCURRENTLY ml_tenant_statistics;
END;
$$ LANGUAGE plpgsql;

-- Function to calculate model health score
CREATE OR REPLACE FUNCTION calculate_model_health_score(
    p_model_id UUID,
    p_tenant_id UUID
) RETURNS FLOAT AS $$
DECLARE
    v_accuracy FLOAT;
    v_error_rate FLOAT;
    v_avg_latency FLOAT;
    v_usage_count BIGINT;
    v_health_score FLOAT;
BEGIN
    -- Get model performance metrics
    SELECT 
        (performance_metrics->>'accuracy')::FLOAT,
        COALESCE(AVG(u.error_rate), 0),
        COALESCE(AVG(u.average_latency), 0),
        COALESCE(SUM(u.prediction_count), 0)
    INTO v_accuracy, v_error_rate, v_avg_latency, v_usage_count
    FROM ml_models m
    LEFT JOIN ml_model_usage u ON m.id = u.model_id
    WHERE m.id = p_model_id AND m.tenant_id = p_tenant_id
    GROUP BY m.id, m.performance_metrics;
    
    -- Calculate health score (0.0 to 1.0)
    v_health_score := COALESCE(v_accuracy, 0.5) * 0.4 +  -- 40% weight on accuracy
                      (1.0 - COALESCE(v_error_rate, 0.5)) * 0.3 +  -- 30% weight on low error rate
                      CASE 
                          WHEN v_avg_latency > 0 THEN LEAST(1.0, 1000.0 / v_avg_latency) 
                          ELSE 0.5 
                      END * 0.2 +  -- 20% weight on low latency
                      CASE 
                          WHEN v_usage_count > 100 THEN 1.0 
                          WHEN v_usage_count > 10 THEN 0.8 
                          WHEN v_usage_count > 0 THEN 0.6 
                          ELSE 0.3 
                      END * 0.1;  -- 10% weight on usage
    
    RETURN GREATEST(0.0, LEAST(1.0, v_health_score));
END;
$$ LANGUAGE plpgsql;

-- Comments for documentation
COMMENT ON TABLE ml_models IS 'Core ML model metadata and configuration';
COMMENT ON TABLE ml_training_jobs IS 'Training job tracking and progress monitoring';
COMMENT ON TABLE ml_model_usage IS 'Model usage statistics and performance metrics';
COMMENT ON TABLE ml_model_deployments IS 'Model deployment instances and health monitoring';
COMMENT ON TABLE ml_model_experiments IS 'A/B testing and model comparison experiments';
COMMENT ON TABLE ml_model_artifacts IS 'Model files and artifact version management';

COMMENT ON MATERIALIZED VIEW ml_model_performance_summary IS 'Aggregated model performance and usage statistics';
COMMENT ON MATERIALIZED VIEW ml_tenant_statistics IS 'Tenant-level ML usage and model statistics';

COMMENT ON FUNCTION calculate_model_health_score IS 'Calculate composite health score for ML models based on performance and usage metrics';
