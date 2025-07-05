# User Service

The User Service is a core microservice of the AI-Native SaaS Platform, responsible for user management, authentication, and AI-driven personalization. Built with clean/hexagonal architecture principles, it provides comprehensive user lifecycle management with enterprise-grade security and observability.

## 🏗️ Architecture

The User Service follows clean architecture principles with clear separation of concerns:

```
src/
├── domain/              # Business logic and entities
│   ├── entities/        # User domain entity
│   ├── events/          # Domain events
│   └── repositories/    # Repository interfaces
├── application/         # Use cases and application services
│   ├── usecases/        # Business use cases
│   └── ports/           # Interface definitions
├── infrastructure/      # External integrations
│   ├── repositories/    # Database implementations
│   ├── events/          # Event publishing
│   ├── logging/         # Logging implementation
│   └── ai/              # AI service integration
└── interfaces/          # API controllers
    └── http/            # REST API endpoints
```

## 🚀 Features

### Core User Management
- ✅ User registration and profile management
- ✅ Secure password handling with bcrypt
- ✅ Email validation and normalization
- ✅ Multi-tenant user isolation
- ✅ Role-based access control (RBAC)
- ✅ User activation/deactivation
- ✅ Account verification workflows

### AI-Driven Personalization
- ✅ User behavior tracking and analytics
- ✅ AI-powered recommendations
- ✅ Personalized user experience
- ✅ Privacy-compliant data collection
- ✅ Machine learning model integration
- ✅ Predictive user behavior analysis

### Event-Driven Architecture
- ✅ Domain event publishing to Kafka
- ✅ Event sourcing for audit trails
- ✅ Saga orchestration support
- ✅ Real-time event processing
- ✅ Event replay capabilities

### Enterprise Features
- ✅ Comprehensive logging with OpenTelemetry
- ✅ Prometheus metrics and monitoring
- ✅ Health checks and readiness probes
- ✅ Rate limiting and security headers
- ✅ Input validation and sanitization
- ✅ Error handling and recovery

## 🛠️ Technology Stack

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Runtime** | Node.js 18+ | JavaScript runtime |
| **Language** | TypeScript | Type-safe development |
| **Framework** | Express.js | HTTP server framework |
| **Database** | PostgreSQL | Primary data storage |
| **Caching** | Redis | Session and data caching |
| **Events** | Apache Kafka | Event streaming |
| **AI/ML** | AWS SageMaker | Machine learning services |
| **Monitoring** | OpenTelemetry | Distributed tracing |
| **Testing** | Jest | Unit and integration testing |

## 📋 API Endpoints

### User Management
```http
POST   /api/v1/users              # Create new user
GET    /api/v1/users/:id          # Get user by ID
PUT    /api/v1/users/:id          # Update user
GET    /api/v1/users              # List users (admin only)
```

### User Profile
```http
GET    /api/v1/users/me/profile        # Get current user profile
PATCH  /api/v1/users/me/profile        # Update current user profile
PATCH  /api/v1/users/me/preferences    # Update user preferences
```

### Metrics and Activity
```http
GET    /api/v1/users/:id/metrics       # Get user metrics
POST   /api/v1/users/me/activity       # Record user activity
```

### Health and Monitoring
```http
GET    /health                    # Health check
GET    /health/live               # Liveness probe
GET    /health/ready              # Readiness probe
GET    /metrics                   # Prometheus metrics
GET    /metrics/json              # JSON metrics
```

## 🔧 Configuration

### Environment Variables

```bash
# Application
NODE_ENV=development
PORT=3001
LOG_LEVEL=info
LOG_FORMAT=json

# Database
DATABASE_HOST=localhost
DATABASE_PORT=5432
DATABASE_NAME=user_service
DATABASE_USER=saas_user
DATABASE_PASSWORD=saas_password
DATABASE_SSL=false
DATABASE_MAX_CONNECTIONS=20

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=user-service
KAFKA_SSL=false

# AWS Services
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key

# Security
CORS_ORIGINS=http://localhost:3000,http://localhost:8080
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# OpenTelemetry
OTEL_EXPORTER_JAEGER_ENDPOINT=http://jaeger:14268/api/traces
OTEL_SERVICE_NAME=user-service
OTEL_SERVICE_VERSION=1.0.0
```

## 🚦 Getting Started

### Prerequisites
- Node.js 18+
- PostgreSQL 13+
- Redis 6+
- Apache Kafka 2.8+

### Local Development

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Setup Database**
   ```bash
   # Create database
   createdb user_service
   
   # Run migrations
   psql -d user_service -f src/infrastructure/database/migrations/001_create_users_table.sql
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```

4. **Run Tests**
   ```bash
   # Unit tests
   npm test
   
   # Test coverage
   npm run test:coverage
   
   # Integration tests
   npm run test:integration
   ```

### Docker Development

1. **Build Image**
   ```bash
   docker build -t user-service .
   ```

2. **Run with Docker Compose**
   ```bash
   docker-compose up user-service
   ```

## 🧪 Testing

### Test Structure
```
tests/
├── unit/                # Unit tests
├── integration/         # Integration tests
├── e2e/                # End-to-end tests
└── setup.ts            # Test configuration
```

### Running Tests
```bash
# All tests
npm test

# Unit tests only
npm run test:unit

# Integration tests
npm run test:integration

# End-to-end tests
npm run test:e2e

# Test coverage
npm run test:coverage

# Watch mode
npm run test:watch
```

### Test Coverage Targets
- **Domain Layer**: >90% coverage
- **Application Layer**: >85% coverage
- **Infrastructure Layer**: >80% coverage
- **Overall**: >85% coverage

## 📊 Monitoring and Observability

### Health Checks
- **Liveness**: `/health/live` - Basic service health
- **Readiness**: `/health/ready` - Service ready for traffic
- **Detailed**: `/health` - Comprehensive health status

### Metrics
- **Prometheus**: `/metrics` - Prometheus-compatible metrics
- **JSON**: `/metrics/json` - JSON format metrics
- **Business**: `/metrics/business` - Business-specific metrics

### Logging
- **Structured Logging**: JSON format with correlation IDs
- **Log Levels**: DEBUG, INFO, WARN, ERROR, FATAL
- **OpenTelemetry**: Distributed tracing integration

### Key Metrics
- User registration rate
- Authentication success/failure rates
- API response times
- Database connection pool status
- Event publishing success rates
- AI personalization effectiveness

## 🔒 Security

### Authentication & Authorization
- JWT token-based authentication
- Role-based access control (RBAC)
- Multi-tenant data isolation
- Session management

### Data Protection
- Password hashing with bcrypt (12 rounds)
- Input validation and sanitization
- SQL injection prevention
- XSS protection with helmet.js

### Rate Limiting
- User creation: 5 requests per 15 minutes
- General API: 100 requests per 15 minutes
- IP and tenant-based limiting

### Privacy & Compliance
- GDPR-compliant data handling
- User consent management
- Data anonymization options
- Audit trail maintenance

## 🤖 AI Integration

### Personalization Features
- User behavior analysis
- Personalized recommendations
- Adaptive UI/UX suggestions
- Predictive analytics

### Machine Learning
- AWS SageMaker integration
- Model training and deployment
- A/B testing for model performance
- Continuous learning from user feedback

### Privacy Controls
- Opt-in/opt-out mechanisms
- Data collection preferences
- Anonymized analytics
- Transparent AI decisions

## 🚀 Deployment

### Production Deployment
```bash
# Build for production
npm run build

# Start production server
npm start
```

### Kubernetes Deployment
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: user-service
spec:
  replicas: 3
  selector:
    matchLabels:
      app: user-service
  template:
    metadata:
      labels:
        app: user-service
    spec:
      containers:
      - name: user-service
        image: user-service:latest
        ports:
        - containerPort: 3001
        env:
        - name: NODE_ENV
          value: "production"
        - name: DATABASE_HOST
          value: "postgres-service"
        livenessProbe:
          httpGet:
            path: /health/live
            port: 3001
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health/ready
            port: 3001
          initialDelaySeconds: 5
          periodSeconds: 5
```

## 📈 Performance

### Benchmarks
- **Throughput**: 1000+ requests/second
- **Latency**: <100ms p95 response time
- **Memory**: <512MB under normal load
- **Database**: Connection pooling with 20 max connections

### Optimization
- Database query optimization
- Connection pooling
- Response caching
- Async/await patterns
- Event loop monitoring

## 🔧 Development

### Code Style
- ESLint configuration
- Prettier formatting
- TypeScript strict mode
- Clean architecture principles

### Git Workflow
```bash
# Feature development
git checkout -b feature/user-profile-enhancement
git commit -m "feat: add user profile validation"
git push origin feature/user-profile-enhancement

# Create pull request for review
```

### Contributing Guidelines
1. Follow clean architecture principles
2. Write comprehensive tests (>85% coverage)
3. Update documentation
4. Follow semantic commit messages
5. Ensure all checks pass

## 📚 Documentation

- [API Documentation](./docs/api.md)
- [Database Schema](./docs/database.md)
- [Event Specifications](./docs/events.md)
- [Deployment Guide](./docs/deployment.md)
- [Troubleshooting](./docs/troubleshooting.md)

## 🆘 Troubleshooting

### Common Issues

**Database Connection Errors**
```bash
# Check database connectivity
pg_isready -h localhost -p 5432

# Verify credentials
psql -h localhost -U saas_user -d user_service
```

**Kafka Connection Issues**
```bash
# Check Kafka brokers
kafka-broker-api-versions --bootstrap-server localhost:9092

# List topics
kafka-topics --list --bootstrap-server localhost:9092
```

**High Memory Usage**
```bash
# Monitor memory usage
npm run metrics:memory

# Check for memory leaks
node --inspect dist/index.js
```

### Debug Mode
```bash
# Enable debug logging
LOG_LEVEL=debug npm run dev

# Enable Node.js debugging
node --inspect-brk dist/index.js
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../../LICENSE) file for details.

## 🤝 Support

- **Documentation**: [docs/](./docs/)
- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Email**: support@ai-saas-platform.com

---

Built with ❤️ for the AI-Native SaaS Platform
