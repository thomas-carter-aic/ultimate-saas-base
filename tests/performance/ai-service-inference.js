// K6 Performance Test for AI Service Inference
// Tests model inference performance under various load conditions

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');
const inferenceLatency = new Trend('inference_latency');
const batchInferenceLatency = new Trend('batch_inference_latency');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 10 },   // Ramp up to 10 users
    { duration: '5m', target: 10 },   // Stay at 10 users
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 0 },    // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<500'], // 95% of requests must complete below 500ms
    http_req_failed: ['rate<0.05'],   // Error rate must be below 5%
    errors: ['rate<0.05'],
    inference_latency: ['p(95)<200'], // 95% of inferences must complete below 200ms
    batch_inference_latency: ['p(95)<1000'], // 95% of batch inferences must complete below 1s
  },
};

// Test data
const singleInferenceData = {
  input: {
    features: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
  },
  options: {
    includeConfidence: true,
    includeFeatureImportance: false
  }
};

const batchInferenceData = {
  inputs: Array(10).fill().map(() => ({
    features: Array(10).fill().map(() => Math.random())
  })),
  options: {
    batchSize: 10,
    parallel: true
  }
};

// Configuration
const authToken = __ENV.AUTH_TOKEN || 'test-token';
const baseUrl = __ENV.BASE_URL || 'http://localhost:3004';
const tenantId = __ENV.TENANT_ID || 'test-tenant-id';

export default function() {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${authToken}`,
    'X-Tenant-ID': tenantId
  };

  // Test single inference
  testSingleInference(headers);
  
  // Test batch inference (less frequently)
  if (Math.random() < 0.3) {
    testBatchInference(headers);
  }

  sleep(1);
}

function testSingleInference(headers) {
  const startTime = Date.now();
  
  const response = http.post(
    `${baseUrl}/api/v1/ai/models/test-model/predict`,
    JSON.stringify(singleInferenceData),
    { headers }
  );

  const latency = Date.now() - startTime;
  inferenceLatency.add(latency);

  const success = check(response, {
    'single inference status is 200': (r) => r.status === 200,
    'single inference has prediction': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success && body.data && body.data.prediction !== undefined;
      } catch (e) {
        return false;
      }
    },
    'single inference latency < 500ms': () => latency < 500,
  });

  if (!success) {
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }
}

function testBatchInference(headers) {
  const startTime = Date.now();
  
  const response = http.post(
    `${baseUrl}/api/v1/ai/models/test-model/batch-predict`,
    JSON.stringify(batchInferenceData),
    { headers, timeout: '30s' }
  );

  const latency = Date.now() - startTime;
  batchInferenceLatency.add(latency);

  const success = check(response, {
    'batch inference status is 200': (r) => r.status === 200,
    'batch inference has results': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.success && body.data && body.data.results && body.data.results.length > 0;
      } catch (e) {
        return false;
      }
    },
    'batch inference latency < 2000ms': () => latency < 2000,
  });

  if (!success) {
    errorRate.add(1);
  } else {
    errorRate.add(0);
  }
}
