# Plugin Service Dockerfile
# Multi-stage build for production-ready container

# Build stage
FROM node:18-alpine AS builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage
FROM node:18-alpine AS production

# Install security updates
RUN apk update && apk upgrade && apk add --no-cache dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S plugin-service -u 1001

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=plugin-service:nodejs /app/dist ./dist
COPY --from=builder --chown=plugin-service:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=plugin-service:nodejs /app/package*.json ./

# Create directories for plugin storage
RUN mkdir -p /app/plugins /app/logs && \
    chown -R plugin-service:nodejs /app/plugins /app/logs

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3003

# Expose port
EXPOSE 3003

# Switch to non-root user
USER plugin-service

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

# Start application with dumb-init
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]
