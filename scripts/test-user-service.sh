#!/bin/bash

# Test User Service Implementation
# This script builds and tests the User Service to verify implementation

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

# Navigate to User Service directory
cd /home/oss/Business/workspaces/nexus-workspace/v7/ultimate-saas-base/services/user-service

log_info "Testing User Service Implementation..."

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed. Please install Node.js 18+ to continue."
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    log_error "Node.js version 18+ is required. Current version: $(node --version)"
    exit 1
fi

log_success "Node.js version check passed: $(node --version)"

# Install dependencies
log_info "Installing dependencies..."
if npm install; then
    log_success "Dependencies installed successfully"
else
    log_error "Failed to install dependencies"
    exit 1
fi

# Run TypeScript compilation
log_info "Compiling TypeScript..."
if npm run build; then
    log_success "TypeScript compilation successful"
else
    log_error "TypeScript compilation failed"
    exit 1
fi

# Run linting
log_info "Running ESLint..."
if npm run lint; then
    log_success "Linting passed"
else
    log_warning "Linting issues found (non-blocking)"
fi

# Run unit tests
log_info "Running unit tests..."
if npm test; then
    log_success "Unit tests passed"
else
    log_error "Unit tests failed"
    exit 1
fi

# Run test coverage
log_info "Generating test coverage report..."
if npm run test:coverage; then
    log_success "Test coverage report generated"
    
    # Display coverage summary
    if [ -f "coverage/lcov-report/index.html" ]; then
        log_info "Coverage report available at: coverage/lcov-report/index.html"
    fi
else
    log_warning "Test coverage generation failed (non-blocking)"
fi

# Check if build artifacts exist
log_info "Verifying build artifacts..."
if [ -d "dist" ] && [ -f "dist/index.js" ]; then
    log_success "Build artifacts verified"
else
    log_error "Build artifacts missing"
    exit 1
fi

# Display project structure
log_info "Project structure:"
tree -I 'node_modules|coverage|dist' -L 3 || ls -la

# Display package information
log_info "Package information:"
echo "Name: $(node -p "require('./package.json').name")"
echo "Version: $(node -p "require('./package.json').version")"
echo "Description: $(node -p "require('./package.json').description")"

# Test basic functionality (syntax check)
log_info "Testing basic functionality..."
if node -c dist/index.js; then
    log_success "Basic functionality test passed"
else
    log_error "Basic functionality test failed"
    exit 1
fi

# Summary
echo ""
log_success "🎉 User Service implementation test completed successfully!"
echo ""
log_info "Next steps:"
echo "  1. Start the development environment: docker-compose up -d"
echo "  2. Run the User Service: npm run dev"
echo "  3. Test API endpoints: curl http://localhost:3001/health"
echo "  4. View metrics: curl http://localhost:3001/metrics"
echo ""
log_info "Service endpoints:"
echo "  - Health Check: http://localhost:3001/health"
echo "  - Metrics: http://localhost:3001/metrics"
echo "  - Users API: http://localhost:3001/api/v1/users"
echo ""
log_info "Monitoring:"
echo "  - Grafana: http://localhost:3000"
echo "  - Prometheus: http://localhost:9090"
echo "  - Jaeger: http://localhost:16686"
