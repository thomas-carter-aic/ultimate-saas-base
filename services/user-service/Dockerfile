# Multi-stage Dockerfile for User Service
# Optimized for production deployment with security best practices

# Stage 1: Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    && ln -sf python3 /usr/bin/python

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for build)
RUN npm ci --only=production=false

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Remove dev dependencies
RUN npm prune --production

# Stage 2: Production stage
FROM node:18-alpine AS production

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S userservice -u 1001

# Set working directory
WORKDIR /app

# Install runtime dependencies only
RUN apk add --no-cache \
    dumb-init \
    curl \
    && rm -rf /var/cache/apk/*

# Copy built application from builder stage
COPY --from=builder --chown=userservice:nodejs /app/dist ./dist
COPY --from=builder --chown=userservice:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=userservice:nodejs /app/package*.json ./

# Copy database migrations
COPY --chown=userservice:nodejs src/infrastructure/database/migrations ./migrations

# Create logs directory
RUN mkdir -p /app/logs && chown userservice:nodejs /app/logs

# Switch to non-root user
USER userservice

# Expose port
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application
CMD ["node", "dist/index.js"]

# Labels for metadata
LABEL maintainer="AI-Native SaaS Platform Team" \
      version="1.0.0" \
      description="User Service - AI-native user management microservice" \
      org.opencontainers.image.source="https://github.com/your-org/ultimate-saas-base" \
      org.opencontainers.image.documentation="https://github.com/your-org/ultimate-saas-base/blob/main/services/user-service/README.md"
