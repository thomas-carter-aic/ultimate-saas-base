# AI Service - Advanced ML Model Management Platform

A production-ready, enterprise-grade AI service that provides comprehensive machine learning model management, training, and inference capabilities with multi-framework support.

## 🚀 Features

### Core Capabilities
- **Multi-Framework Support**: TensorFlow, PyTorch, Scikit-learn, XGBoost, ONNX
- **Model Lifecycle Management**: Complete CRUD operations with versioning
- **Distributed Training**: GPU-accelerated training with progress monitoring
- **High-Performance Inference**: <100ms p95 latency, 1000+ predictions/sec
- **Kubernetes Deployment**: Native K8s integration with autoscaling
- **Event-Driven Architecture**: Comprehensive event publishing and handling

### Enterprise Features
- **Multi-Tenant Architecture**: Complete tenant isolation and resource management
- **Advanced Security**: RBAC, input validation, audit logging
- **Monitoring & Observability**: Prometheus metrics, distributed tracing
- **Resource Management**: Intelligent caching, memory optimization
- **Batch Processing**: Optimized batch inference with parallel processing
- **A/B Testing**: Model experimentation and comparison framework

## 🏗️ Architecture

### Clean Architecture Implementation
```
src/
├── domain/              # Business logic and entities
│   ├── entities/        # Core business entities
│   ├── events/          # Domain events
│   └── value-objects/   # Value objects
├── application/         # Use cases and application services
│   ├── usecases/        # Business use cases
│   └── ports/           # Interface definitions
├── infrastructure/      # External integrations
│   ├── inference/       # ML framework integrations
│   ├── repositories/    # Data persistence
│   ├── deployment/      # Kubernetes integration
│   └── monitoring/      # Observability
└── interfaces/          # API and external interfaces
    └── http/            # REST API controllers
```

### Technology Stack
- **Runtime**: Node.js 18+ with TypeScript
- **ML Frameworks**: TensorFlow.js, PyTorch (via Python bridge), ONNX Runtime
- **Database**: PostgreSQL with JSONB optimization
- **Cache**: Redis with intelligent LRU eviction
- **Message Queue**: Apache Kafka for event streaming
- **Orchestration**: Kubernetes with custom operators
- **Monitoring**: Prometheus, Grafana, OpenTelemetry

## 🚦 Quick Start

### Prerequisites
- Node.js 18+
- Docker & Docker Compose
- Kubernetes cluster (optional)
- PostgreSQL 14+
- Redis 6+

### Local Development
```bash
# Clone repository
git clone <repository-url>
cd services/ai-service

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Start dependencies
docker-compose up -d postgres redis kafka

# Run database migrations
npm run migrate

# Start development server
npm run dev
```

### Docker Deployment
```bash
# Build image
docker build -t ai-service .

# Run container
docker run -p 3004:3004 \
  -e DB_HOST=localhost \
  -e REDIS_HOST=localhost \
  -e KAFKA_BROKER=localhost:9092 \
  ai-service
```

### Kubernetes Deployment
```bash
# Deploy to Kubernetes
kubectl apply -f k8s/

# Check deployment status
kubectl get pods -l app=ai-service
```

## 📚 API Documentation

### Authentication
All endpoints require JWT authentication:
```bash
Authorization: Bearer <jwt-token>
X-Tenant-ID: <tenant-uuid>
```

### Core Endpoints

#### Create Model
```http
POST /api/v1/ai/models
Content-Type: application/json

{
  "name": "my-classifier",
  "description": "Image classification model",
  "framework": "tensorflow",
  "category": "computer_vision",
  "configuration": {
    "inputShape": [224, 224, 3],
    "numClasses": 10
  },
  "inputSchema": {
    "type": "image",
    "format": "jpeg"
  },
  "outputSchema": {
    "type": "classification",
    "classes": ["cat", "dog", ...]
  }
}
```

#### Train Model
```http
POST /api/v1/ai/models/{modelId}/train
Content-Type: application/json

{
  "trainingConfig": {
    "epochs": 100,
    "batchSize": 32,
    "learningRate": 0.001
  },
  "datasetConfig": {
    "trainPath": "s3://bucket/train/",
    "validationPath": "s3://bucket/val/"
  },
  "resourceConfig": {
    "gpu": true,
    "memory": "8Gi",
    "cpu": "4"
  }
}
```

#### Make Prediction
```http
POST /api/v1/ai/models/{modelId}/predict
Content-Type: application/json

{
  "input": {
    "image": "base64-encoded-image"
  },
  "options": {
    "includeConfidence": true,
    "includeFeatureImportance": true
  }
}
```

#### Deploy Model
```http
POST /api/v1/ai/models/{modelId}/deploy
Content-Type: application/json

{
  "deploymentName": "my-classifier-prod",
  "environment": "production",
  "minReplicas": 2,
  "maxReplicas": 10,
  "resourceLimits": {
    "cpu": "2",
    "memory": "4Gi"
  },
  "autoscaling": {
    "enabled": true,
    "targetCPUUtilization": 70
  }
}
```

### Batch Operations

#### Batch Prediction
```http
POST /api/v1/ai/models/{modelId}/batch-predict
Content-Type: application/json

{
  "inputs": [
    {"image": "base64-1"},
    {"image": "base64-2"},
    ...
  ],
  "options": {
    "batchSize": 32,
    "parallel": true
  }
}
```

## 🔧 Configuration

### Environment Variables
```bash
# Server Configuration
PORT=3004
HOST=0.0.0.0
NODE_ENV=production

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=ai_service
DB_USER=postgres
DB_PASSWORD=password

# Cache
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Message Queue
KAFKA_BROKER=localhost:9092

# Authentication
JWT_SECRET=your-secret-key

# ML Configuration
TENSORFLOW_BACKEND=cpu
PYTORCH_BACKEND=cpu
MODEL_CACHE_SIZE=10
MAX_BATCH_SIZE=1000

# Kubernetes
KUBECONFIG=/path/to/kubeconfig
K8S_NAMESPACE=ai-service

# Monitoring
PROMETHEUS_PORT=9090
JAEGER_ENDPOINT=http://localhost:14268/api/traces
```

### Framework-Specific Configuration

#### TensorFlow Configuration
```json
{
  "tensorflow": {
    "backend": "cpu|gpu",
    "memoryGrowth": true,
    "optimization": {
      "quantization": false,
      "pruning": false
    }
  }
}
```

#### PyTorch Configuration
```json
{
  "pytorch": {
    "device": "cpu|cuda|mps",
    "numThreads": 4,
    "optimization": {
      "torchScript": true,
      "quantization": false
    }
  }
}
```

## 🧪 Testing

### Unit Tests
```bash
npm run test
```

### Integration Tests
```bash
npm run test:integration
```

### End-to-End Tests
```bash
npm run test:e2e
```

### Load Testing
```bash
# Install k6
npm install -g k6

# Run load tests
k6 run tests/load/inference-test.js
```

## 📊 Monitoring

### Metrics
The service exposes Prometheus metrics at `/metrics`:

- `ai_service_requests_total` - Total HTTP requests
- `ai_service_request_duration_ms` - Request duration histogram
- `ai_service_model_predictions_total` - Total predictions made
- `ai_service_model_training_jobs_total` - Total training jobs
- `ai_service_inference_duration_ms` - Inference latency histogram
- `ai_service_model_cache_hits_total` - Model cache hit rate

### Health Checks
- `/health` - Basic health check
- `/health/detailed` - Detailed health with dependencies

### Logging
Structured JSON logging with configurable levels:
```json
{
  "timestamp": "2024-01-05T09:00:00.000Z",
  "level": "info",
  "service": "ai-service",
  "message": "Model prediction completed",
  "modelId": "uuid",
  "tenantId": "uuid",
  "duration": 45,
  "confidence": 0.95
}
```

## 🔒 Security

### Authentication & Authorization
- JWT-based authentication
- Role-based access control (RBAC)
- Tenant-based resource isolation
- API rate limiting

### Input Validation
- Request schema validation
- File upload restrictions
- SQL injection prevention
- XSS protection

### Data Protection
- Encryption at rest and in transit
- Secure model artifact storage
- Audit logging
- GDPR compliance support

## 🚀 Performance

### Benchmarks
- **Inference Latency**: <100ms p95 for typical models
- **Throughput**: 1000+ predictions/second
- **Batch Processing**: 10,000+ items/minute
- **Model Loading**: <5 seconds for cached models
- **Memory Usage**: <512MB per loaded model

### Optimization Features
- Intelligent model caching with LRU eviction
- Batch inference optimization
- GPU acceleration support
- Model quantization and pruning
- Connection pooling and keep-alive

## 🔄 CI/CD

### GitHub Actions Workflow
```yaml
name: AI Service CI/CD
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test
      - run: npm run test:integration

  build:
    needs: test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - run: docker build -t ai-service .
      - run: docker push registry/ai-service:${{ github.sha }}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - run: kubectl set image deployment/ai-service ai-service=registry/ai-service:${{ github.sha }}
```

## 🤝 Contributing

### Development Setup
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run the test suite
6. Submit a pull request

### Code Standards
- TypeScript with strict mode
- ESLint + Prettier formatting
- 80%+ test coverage
- Conventional commit messages

### Architecture Guidelines
- Follow clean architecture principles
- Implement proper error handling
- Use dependency injection
- Write comprehensive tests
- Document public APIs

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Email**: support@ai-platform.com

## 🗺️ Roadmap

### Phase 1 (Current)
- ✅ Multi-framework inference
- ✅ Model lifecycle management
- ✅ Kubernetes deployment
- ✅ Basic monitoring

### Phase 2 (Next)
- 🔄 AutoML capabilities
- 🔄 Model drift detection
- 🔄 Advanced A/B testing
- 🔄 Federated learning

### Phase 3 (Future)
- 📋 Edge deployment
- 📋 Model marketplace
- 📋 Custom operators
- 📋 Multi-cloud support

---

Built with ❤️ for the future of AI-native applications
