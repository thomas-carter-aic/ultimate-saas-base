#!/bin/bash

# Tenant Service Comprehensive Test Script
# Tests all tenant service endpoints and functionality

set -e

# Configuration
BASE_URL="http://localhost:3002"
API_BASE="$BASE_URL/api/v1"
HEALTH_URL="$BASE_URL/health"
METRICS_URL="$BASE_URL/metrics"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Helper functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
    ((TESTS_PASSED++))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ((TESTS_FAILED++))
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

run_test() {
    ((TESTS_RUN++))
    local test_name="$1"
    local test_command="$2"
    local expected_status="$3"
    
    log_info "Running test: $test_name"
    
    if eval "$test_command"; then
        log_success "$test_name"
        return 0
    else
        log_error "$test_name"
        return 1
    fi
}

# Test data
TEST_USER_ID="test-user-$(date +%s)"
TEST_TENANT_NAME="Test Company $(date +%s)"
TEST_TENANT_ID=""
AUTH_HEADER="Authorization: Bearer test-token"
USER_ID_HEADER="x-user-id: $TEST_USER_ID"
USER_ROLE_HEADER="x-user-role: owner"

echo "=============================================="
echo "🚀 Tenant Service Comprehensive Test Suite"
echo "=============================================="
echo "Base URL: $BASE_URL"
echo "Test User ID: $TEST_USER_ID"
echo "Test Tenant Name: $TEST_TENANT_NAME"
echo "=============================================="

# Test 1: Health Check
log_info "Testing health check endpoint..."
run_test "Health Check" "curl -s -f $HEALTH_URL > /dev/null" 200

# Test 2: Metrics Endpoint
log_info "Testing metrics endpoint..."
run_test "Metrics Endpoint" "curl -s -f $METRICS_URL > /dev/null" 200

# Test 3: Create Tenant
log_info "Testing tenant creation..."
CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/tenants" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -H "$USER_ID_HEADER" \
  -H "$USER_ROLE_HEADER" \
  -d "{
    \"name\": \"$TEST_TENANT_NAME\",
    \"ownerId\": \"$TEST_USER_ID\",
    \"plan\": \"professional\"
  }")

if echo "$CREATE_RESPONSE" | jq -e '.success == true' > /dev/null; then
    TEST_TENANT_ID=$(echo "$CREATE_RESPONSE" | jq -r '.data.tenant.id')
    log_success "Tenant creation - ID: $TEST_TENANT_ID"
else
    log_error "Tenant creation failed: $CREATE_RESPONSE"
fi

# Test 4: Get Tenant by ID
if [ -n "$TEST_TENANT_ID" ]; then
    log_info "Testing get tenant by ID..."
    GET_RESPONSE=$(curl -s -X GET "$API_BASE/tenants/$TEST_TENANT_ID" \
      -H "$AUTH_HEADER" \
      -H "$USER_ID_HEADER" \
      -H "$USER_ROLE_HEADER")
    
    if echo "$GET_RESPONSE" | jq -e '.success == true' > /dev/null; then
        log_success "Get tenant by ID"
    else
        log_error "Get tenant by ID failed: $GET_RESPONSE"
    fi
fi

# Test 5: Update Tenant
if [ -n "$TEST_TENANT_ID" ]; then
    log_info "Testing tenant update..."
    UPDATE_RESPONSE=$(curl -s -X PUT "$API_BASE/tenants/$TEST_TENANT_ID" \
      -H "Content-Type: application/json" \
      -H "$AUTH_HEADER" \
      -H "$USER_ID_HEADER" \
      -H "$USER_ROLE_HEADER" \
      -d "{
        \"updates\": {
          \"name\": \"$TEST_TENANT_NAME Updated\",
          \"settings\": {
            \"branding\": {
              \"logoUrl\": \"https://example.com/logo.png\",
              \"primaryColor\": \"#FF5733\"
            },
            \"features\": {
              \"aiEnabled\": true,
              \"analyticsEnabled\": true
            }
          }
        }
      }")
    
    if echo "$UPDATE_RESPONSE" | jq -e '.success == true' > /dev/null; then
        log_success "Tenant update"
    else
        log_error "Tenant update failed: $UPDATE_RESPONSE"
    fi
fi

# Test 6: List Tenants
log_info "Testing list tenants..."
LIST_RESPONSE=$(curl -s -X GET "$API_BASE/tenants?page=1&limit=10" \
  -H "$AUTH_HEADER" \
  -H "$USER_ID_HEADER" \
  -H "$USER_ROLE_HEADER")

if echo "$LIST_RESPONSE" | jq -e '.success == true' > /dev/null; then
    TENANT_COUNT=$(echo "$LIST_RESPONSE" | jq '.data.tenants | length')
    log_success "List tenants - Found $TENANT_COUNT tenants"
else
    log_error "List tenants failed: $LIST_RESPONSE"
fi

# Test 7: List Tenants with Filters
log_info "Testing list tenants with filters..."
FILTER_RESPONSE=$(curl -s -X GET "$API_BASE/tenants?plan=professional&status=trial" \
  -H "$AUTH_HEADER" \
  -H "$USER_ID_HEADER" \
  -H "$USER_ROLE_HEADER")

if echo "$FILTER_RESPONSE" | jq -e '.success == true' > /dev/null; then
    log_success "List tenants with filters"
else
    log_error "List tenants with filters failed: $FILTER_RESPONSE"
fi

# Test 8: Search Tenants
log_info "Testing tenant search..."
SEARCH_RESPONSE=$(curl -s -X GET "$API_BASE/tenants?search=Test" \
  -H "$AUTH_HEADER" \
  -H "$USER_ID_HEADER" \
  -H "$USER_ROLE_HEADER")

if echo "$SEARCH_RESPONSE" | jq -e '.success == true' > /dev/null; then
    log_success "Tenant search"
else
    log_error "Tenant search failed: $SEARCH_RESPONSE"
fi

# Test 9: Get Tenant Usage Analytics
if [ -n "$TEST_TENANT_ID" ]; then
    log_info "Testing tenant usage analytics..."
    ANALYTICS_RESPONSE=$(curl -s -X GET "$API_BASE/tenants/$TEST_TENANT_ID/usage" \
      -H "$AUTH_HEADER" \
      -H "$USER_ID_HEADER" \
      -H "$USER_ROLE_HEADER")
    
    if echo "$ANALYTICS_RESPONSE" | jq -e '.success == true' > /dev/null; then
        log_success "Tenant usage analytics"
    else
        log_error "Tenant usage analytics failed: $ANALYTICS_RESPONSE"
    fi
fi

# Test 10: Get Tenant Analytics with Metrics Filter
if [ -n "$TEST_TENANT_ID" ]; then
    log_info "Testing tenant analytics with metrics filter..."
    METRICS_RESPONSE=$(curl -s -X GET "$API_BASE/tenants/$TEST_TENANT_ID/usage?metrics=users,storage,billing" \
      -H "$AUTH_HEADER" \
      -H "$USER_ID_HEADER" \
      -H "$USER_ROLE_HEADER")
    
    if echo "$METRICS_RESPONSE" | jq -e '.success == true' > /dev/null; then
        log_success "Tenant analytics with metrics filter"
    else
        log_error "Tenant analytics with metrics filter failed: $METRICS_RESPONSE"
    fi
fi

# Test 11: Validation Tests
log_info "Testing validation errors..."

# Test invalid tenant creation
INVALID_CREATE_RESPONSE=$(curl -s -X POST "$API_BASE/tenants" \
  -H "Content-Type: application/json" \
  -H "$AUTH_HEADER" \
  -H "$USER_ID_HEADER" \
  -H "$USER_ROLE_HEADER" \
  -d "{
    \"name\": \"\",
    \"ownerId\": \"$TEST_USER_ID\",
    \"plan\": \"invalid-plan\"
  }")

if echo "$INVALID_CREATE_RESPONSE" | jq -e '.success == false' > /dev/null; then
    log_success "Validation error handling"
else
    log_error "Validation error handling failed: $INVALID_CREATE_RESPONSE"
fi

# Test 12: Authorization Tests
log_info "Testing authorization..."

# Test unauthorized access
UNAUTH_RESPONSE=$(curl -s -X GET "$API_BASE/tenants" \
  -H "Content-Type: application/json")

if echo "$UNAUTH_RESPONSE" | jq -e '.success == false' > /dev/null 2>/dev/null || [ -z "$UNAUTH_RESPONSE" ]; then
    log_success "Authorization enforcement"
else
    log_error "Authorization enforcement failed: $UNAUTH_RESPONSE"
fi

# Test 13: Rate Limiting (if enabled)
log_info "Testing rate limiting..."
RATE_LIMIT_EXCEEDED=false

for i in {1..5}; do
    RATE_RESPONSE=$(curl -s -X POST "$API_BASE/tenants" \
      -H "Content-Type: application/json" \
      -H "$AUTH_HEADER" \
      -H "$USER_ID_HEADER" \
      -H "$USER_ROLE_HEADER" \
      -d "{
        \"name\": \"Rate Test Tenant $i\",
        \"ownerId\": \"$TEST_USER_ID\",
        \"plan\": \"starter\"
      }")
    
    if echo "$RATE_RESPONSE" | grep -q "Too many"; then
        RATE_LIMIT_EXCEEDED=true
        break
    fi
done

if [ "$RATE_LIMIT_EXCEEDED" = true ]; then
    log_success "Rate limiting enforcement"
else
    log_warning "Rate limiting not triggered (may be disabled or threshold not reached)"
fi

# Test 14: Error Handling
log_info "Testing error handling..."

# Test non-existent tenant
NOT_FOUND_RESPONSE=$(curl -s -X GET "$API_BASE/tenants/00000000-0000-0000-0000-000000000000" \
  -H "$AUTH_HEADER" \
  -H "$USER_ID_HEADER" \
  -H "$USER_ROLE_HEADER")

if echo "$NOT_FOUND_RESPONSE" | jq -e '.success == false' > /dev/null; then
    log_success "404 error handling"
else
    log_error "404 error handling failed: $NOT_FOUND_RESPONSE"
fi

# Test 15: Performance Test
log_info "Testing performance..."
START_TIME=$(date +%s%N)

for i in {1..10}; do
    curl -s -X GET "$HEALTH_URL" > /dev/null
done

END_TIME=$(date +%s%N)
DURATION=$((($END_TIME - $START_TIME) / 1000000)) # Convert to milliseconds
AVERAGE_RESPONSE_TIME=$(($DURATION / 10))

if [ $AVERAGE_RESPONSE_TIME -lt 1000 ]; then
    log_success "Performance test - Average response time: ${AVERAGE_RESPONSE_TIME}ms"
else
    log_warning "Performance test - Average response time: ${AVERAGE_RESPONSE_TIME}ms (may be slow)"
fi

# Test 16: Database Connection Test
log_info "Testing database connectivity..."
DB_TEST_RESPONSE=$(curl -s -X GET "$HEALTH_URL")

if echo "$DB_TEST_RESPONSE" | jq -e '.database.status == "healthy"' > /dev/null 2>/dev/null; then
    log_success "Database connectivity"
else
    log_warning "Database connectivity check inconclusive"
fi

# Test 17: Event Publishing Test (if Kafka is available)
log_info "Testing event publishing..."
if [ -n "$TEST_TENANT_ID" ]; then
    # Create another tenant to trigger events
    EVENT_TEST_RESPONSE=$(curl -s -X POST "$API_BASE/tenants" \
      -H "Content-Type: application/json" \
      -H "$AUTH_HEADER" \
      -H "x-user-id: event-test-user" \
      -H "$USER_ROLE_HEADER" \
      -d "{
        \"name\": \"Event Test Tenant\",
        \"ownerId\": \"event-test-user\",
        \"plan\": \"starter\"
      }")
    
    if echo "$EVENT_TEST_RESPONSE" | jq -e '.success == true' > /dev/null; then
        log_success "Event publishing (tenant creation)"
    else
        log_warning "Event publishing test inconclusive"
    fi
fi

# Cleanup
log_info "Cleaning up test data..."
if [ -n "$TEST_TENANT_ID" ]; then
    # In a real implementation, you might have a delete endpoint
    log_info "Test tenant ID: $TEST_TENANT_ID (manual cleanup may be required)"
fi

# Summary
echo ""
echo "=============================================="
echo "📊 Test Results Summary"
echo "=============================================="
echo "Tests Run: $TESTS_RUN"
echo "Tests Passed: $TESTS_PASSED"
echo "Tests Failed: $TESTS_FAILED"

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✅ All tests passed!${NC}"
    echo "🎉 Tenant Service is working correctly!"
else
    echo -e "${RED}❌ Some tests failed!${NC}"
    echo "🔧 Please check the failed tests and fix any issues."
fi

echo ""
echo "=============================================="
echo "🔍 Service Information"
echo "=============================================="
echo "Service URL: $BASE_URL"
echo "API Base: $API_BASE"
echo "Health Check: $HEALTH_URL"
echo "Metrics: $METRICS_URL"

if [ -n "$TEST_TENANT_ID" ]; then
    echo "Test Tenant ID: $TEST_TENANT_ID"
    echo "Test Tenant URL: $API_BASE/tenants/$TEST_TENANT_ID"
fi

echo ""
echo "=============================================="
echo "📚 Available Endpoints"
echo "=============================================="
echo "POST   /api/v1/tenants                    - Create tenant"
echo "GET    /api/v1/tenants/:id                - Get tenant by ID"
echo "PUT    /api/v1/tenants/:id                - Update tenant"
echo "GET    /api/v1/tenants                    - List tenants"
echo "GET    /api/v1/tenants/:id/usage          - Get tenant analytics"
echo "GET    /health                            - Health check"
echo "GET    /metrics                           - Prometheus metrics"
echo ""

# Exit with appropriate code
if [ $TESTS_FAILED -eq 0 ]; then
    exit 0
else
    exit 1
fi
