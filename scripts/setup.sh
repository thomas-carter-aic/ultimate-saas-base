#!/bin/bash

# Ultimate AI-Native SaaS Platform Setup Script
# This script sets up the development environment and initializes all services

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if required tools are installed
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    local missing_tools=()
    
    # Check for Docker
    if ! command -v docker &> /dev/null; then
        missing_tools+=("docker")
    fi
    
    # Check for Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        missing_tools+=("docker-compose")
    fi
    
    # Check for Node.js
    if ! command -v node &> /dev/null; then
        missing_tools+=("node")
    fi
    
    # Check for npm
    if ! command -v npm &> /dev/null; then
        missing_tools+=("npm")
    fi
    
    # Check for Git
    if ! command -v git &> /dev/null; then
        missing_tools+=("git")
    fi
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        log_error "Please install the missing tools and run this script again."
        exit 1
    fi
    
    log_success "All prerequisites are installed"
}

# Create necessary directories
create_directories() {
    log_info "Creating project directories..."
    
    local directories=(
        "logs"
        "data/postgres"
        "data/redis"
        "data/prometheus"
        "data/grafana"
        "data/ollama"
        "config/grafana/provisioning/datasources"
        "config/grafana/provisioning/dashboards"
        "config/grafana/dashboards"
        "config/prometheus"
        "config/keycloak"
        "scripts/database"
        "scripts/kafka"
        "scripts/monitoring"
    )
    
    for dir in "${directories[@]}"; do
        mkdir -p "$dir"
        log_info "Created directory: $dir"
    done
    
    log_success "Project directories created"
}

# Generate environment configuration
generate_env_files() {
    log_info "Generating environment configuration files..."
    
    # Generate .env file for Docker Compose
    cat > .env << EOF
# AI-Native SaaS Platform Environment Configuration
# Generated on $(date)

# Application Configuration
NODE_ENV=development
LOG_LEVEL=debug
LOG_FORMAT=json

# Database Configuration
POSTGRES_DB=saas_platform
POSTGRES_USER=saas_user
POSTGRES_PASSWORD=saas_password_$(openssl rand -hex 8)

# Redis Configuration
REDIS_PASSWORD=redis_password_$(openssl rand -hex 8)

# Kafka Configuration
KAFKA_CLUSTER_ID=$(openssl rand -hex 16)

# Keycloak Configuration
KEYCLOAK_ADMIN=admin
KEYCLOAK_ADMIN_PASSWORD=admin_password_$(openssl rand -hex 8)

# AWS Configuration (set these if using AWS services)
# AWS_ACCESS_KEY_ID=your_access_key
# AWS_SECRET_ACCESS_KEY=your_secret_key
# AWS_REGION=us-east-1

# Security Configuration
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -base64 32)

# Monitoring Configuration
GRAFANA_ADMIN_PASSWORD=grafana_password_$(openssl rand -hex 8)

# Development Configuration
CORS_ORIGINS=http://localhost:3000,http://localhost:8080,http://localhost:8002
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
EOF

    # Generate service-specific environment files
    mkdir -p services/user-service
    cat > services/user-service/.env << EOF
# User Service Environment Configuration
NODE_ENV=development
PORT=3001
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=user_service
DATABASE_USER=saas_user
DATABASE_PASSWORD=saas_password
DATABASE_SSL=false
DATABASE_MAX_CONNECTIONS=20
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=user-service
KAFKA_SSL=false
AWS_REGION=us-east-1
LOG_LEVEL=debug
LOG_FORMAT=json
CORS_ORIGINS=http://localhost:3000,http://localhost:8080
EOF

    log_success "Environment configuration files generated"
    log_warning "Please update the AWS credentials in .env file if you plan to use AWS services"
}

# Generate configuration files
generate_config_files() {
    log_info "Generating configuration files..."
    
    # Prometheus configuration
    cat > config/prometheus.yml << EOF
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  # - "first_rules.yml"
  # - "second_rules.yml"

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'user-service'
    static_configs:
      - targets: ['user-service:3001']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'tenant-service'
    static_configs:
      - targets: ['tenant-service:3002']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'plugin-service'
    static_configs:
      - targets: ['plugin-service:3003']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'ai-service'
    static_configs:
      - targets: ['ai-service:3004']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'notification-service'
    static_configs:
      - targets: ['notification-service:3005']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'kafka'
    static_configs:
      - targets: ['kafka:9092']

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres:5432']
EOF

    # Grafana datasource configuration
    cat > config/grafana/provisioning/datasources/prometheus.yml << EOF
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
EOF

    # Grafana dashboard configuration
    cat > config/grafana/provisioning/dashboards/dashboard.yml << EOF
apiVersion: 1

providers:
  - name: 'default'
    orgId: 1
    folder: ''
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards
EOF

    # Nginx placeholder configuration
    cat > config/nginx-placeholder.conf << EOF
server {
    listen 80;
    server_name localhost;

    location / {
        return 200 '{"status":"placeholder","message":"Service not yet implemented"}';
        add_header Content-Type application/json;
    }

    location /health {
        return 200 '{"status":"healthy","service":"placeholder"}';
        add_header Content-Type application/json;
    }
}
EOF

    log_success "Configuration files generated"
}

# Generate database initialization script
generate_database_scripts() {
    log_info "Generating database initialization scripts..."
    
    cat > scripts/init-databases.sh << EOF
#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "\$POSTGRES_USER" --dbname "\$POSTGRES_DB" <<-EOSQL
    -- Create databases for each service
    CREATE DATABASE user_service;
    CREATE DATABASE tenant_service;
    CREATE DATABASE plugin_service;
    CREATE DATABASE keycloak;
    
    -- Grant permissions
    GRANT ALL PRIVILEGES ON DATABASE user_service TO \$POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE tenant_service TO \$POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE plugin_service TO \$POSTGRES_USER;
    GRANT ALL PRIVILEGES ON DATABASE keycloak TO \$POSTGRES_USER;
    
    -- Create extensions
    \c user_service;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
    
    \c tenant_service;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
    
    \c plugin_service;
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
EOSQL
EOF

    chmod +x scripts/init-databases.sh
    
    log_success "Database initialization scripts generated"
}

# Install dependencies for services
install_dependencies() {
    log_info "Installing dependencies for services..."
    
    # Install User Service dependencies
    if [ -f "services/user-service/package.json" ]; then
        log_info "Installing User Service dependencies..."
        cd services/user-service
        npm install
        cd ../..
        log_success "User Service dependencies installed"
    fi
    
    # Add other services as they are implemented
    
    log_success "All service dependencies installed"
}

# Initialize Ollama models
initialize_ollama() {
    log_info "Initializing Ollama AI models..."
    
    # Wait for Ollama to be ready
    log_info "Waiting for Ollama service to be ready..."
    timeout=60
    while [ $timeout -gt 0 ]; do
        if curl -f http://localhost:11434/api/tags >/dev/null 2>&1; then
            break
        fi
        sleep 2
        timeout=$((timeout - 2))
    done
    
    if [ $timeout -le 0 ]; then
        log_warning "Ollama service not ready, skipping model initialization"
        return
    fi
    
    # Pull essential models for AI features
    log_info "Pulling Ollama models (this may take a while)..."
    
    # Pull a lightweight model for development
    docker exec saas-ollama ollama pull llama2:7b-chat || log_warning "Failed to pull llama2:7b-chat model"
    
    # Pull a code-focused model
    docker exec saas-ollama ollama pull codellama:7b || log_warning "Failed to pull codellama:7b model"
    
    log_success "Ollama models initialized"
}

# Create Kafka topics
create_kafka_topics() {
    log_info "Creating Kafka topics..."
    
    # Wait for Kafka to be ready
    log_info "Waiting for Kafka service to be ready..."
    timeout=60
    while [ $timeout -gt 0 ]; do
        if docker exec saas-kafka kafka-broker-api-versions --bootstrap-server localhost:9092 >/dev/null 2>&1; then
            break
        fi
        sleep 2
        timeout=$((timeout - 2))
    done
    
    if [ $timeout -le 0 ]; then
        log_warning "Kafka service not ready, skipping topic creation"
        return
    fi
    
    # Create topics for different event types
    local topics=(
        "user-events:3:1"
        "user-lifecycle-events:3:1"
        "user-activity-events:3:1"
        "user-profile-events:3:1"
        "user-security-events:3:1"
        "ai-interaction-events:3:1"
        "error-events:3:1"
        "tenant-events:3:1"
        "plugin-events:3:1"
        "notification-events:3:1"
    )
    
    for topic_config in "${topics[@]}"; do
        IFS=':' read -r topic partitions replication <<< "$topic_config"
        log_info "Creating topic: $topic"
        docker exec saas-kafka kafka-topics --create \
            --bootstrap-server localhost:9092 \
            --topic "$topic" \
            --partitions "$partitions" \
            --replication-factor "$replication" \
            --if-not-exists || log_warning "Failed to create topic: $topic"
    done
    
    log_success "Kafka topics created"
}

# Run database migrations
run_migrations() {
    log_info "Running database migrations..."
    
    # Wait for database to be ready
    log_info "Waiting for database to be ready..."
    timeout=60
    while [ $timeout -gt 0 ]; do
        if docker exec saas-postgres pg_isready -U saas_user -d saas_platform >/dev/null 2>&1; then
            break
        fi
        sleep 2
        timeout=$((timeout - 2))
    done
    
    if [ $timeout -le 0 ]; then
        log_error "Database not ready, cannot run migrations"
        return 1
    fi
    
    # Run User Service migrations
    log_info "Running User Service migrations..."
    if [ -f "services/user-service/src/infrastructure/database/migrations/001_create_users_table.sql" ]; then
        docker exec saas-postgres psql -U saas_user -d user_service -f /docker-entrypoint-initdb.d/001_create_users_table.sql || log_warning "User Service migration failed"
    fi
    
    log_success "Database migrations completed"
}

# Main setup function
main() {
    log_info "Starting Ultimate AI-Native SaaS Platform setup..."
    
    # Check prerequisites
    check_prerequisites
    
    # Create directories
    create_directories
    
    # Generate configuration files
    generate_env_files
    generate_config_files
    generate_database_scripts
    
    # Install dependencies
    install_dependencies
    
    # Start infrastructure services
    log_info "Starting infrastructure services..."
    docker-compose up -d postgres redis zookeeper kafka keycloak prometheus grafana jaeger ollama kong-database kong-migration kong
    
    # Wait for services to be ready
    log_info "Waiting for services to initialize..."
    sleep 30
    
    # Initialize services
    create_kafka_topics
    run_migrations
    initialize_ollama
    
    # Start application services
    log_info "Starting application services..."
    docker-compose up -d user-service tenant-service plugin-service ai-service notification-service kafka-ui
    
    log_success "Setup completed successfully!"
    
    # Display service URLs
    echo ""
    log_info "Service URLs:"
    echo "  🌐 API Gateway (Kong): http://localhost:8000"
    echo "  👤 User Service: http://localhost:3001"
    echo "  🏢 Tenant Service: http://localhost:3002"
    echo "  🔌 Plugin Service: http://localhost:3003"
    echo "  🤖 AI Service: http://localhost:3004"
    echo "  📧 Notification Service: http://localhost:3005"
    echo "  🔐 Keycloak: http://localhost:8090"
    echo "  📊 Grafana: http://localhost:3000 (admin/admin)"
    echo "  📈 Prometheus: http://localhost:9090"
    echo "  🔍 Jaeger: http://localhost:16686"
    echo "  📨 Kafka UI: http://localhost:8080"
    echo "  🧠 Ollama: http://localhost:11434"
    echo ""
    log_info "Check service health with: docker-compose ps"
    log_info "View logs with: docker-compose logs -f [service-name]"
    log_info "Stop all services with: docker-compose down"
    
    echo ""
    log_success "🚀 Ultimate AI-Native SaaS Platform is ready for development!"
}

# Run main function
main "$@"
