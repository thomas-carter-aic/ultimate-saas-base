# Multi-stage build for AI Service with ML framework support
FROM node:18-bullseye-slim AS base

# Install system dependencies for ML frameworks
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-dev \
    build-essential \
    cmake \
    pkg-config \
    libhdf5-dev \
    libopenblas-dev \
    liblapack-dev \
    libjpeg-dev \
    libpng-dev \
    libtiff-dev \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    libv4l-dev \
    libxvidcore-dev \
    libx264-dev \
    libgtk-3-dev \
    libatlas-base-dev \
    gfortran \
    wget \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install Python ML dependencies
RUN pip3 install --no-cache-dir \
    numpy==1.24.3 \
    scipy==1.10.1 \
    scikit-learn==1.3.0 \
    pandas==2.0.3 \
    tensorflow==2.13.0 \
    torch==2.0.1 \
    torchvision==0.15.2 \
    onnxruntime==1.15.1 \
    xgboost==1.7.6 \
    joblib==1.3.2 \
    pillow==10.0.0 \
    opencv-python-headless==4.8.0.76

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install Node.js dependencies
RUN npm ci --only=production && npm cache clean --force

# Development stage
FROM base AS development

# Install development dependencies
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Expose port
EXPOSE 3004

# Start development server
CMD ["npm", "run", "dev"]

# Build stage
FROM base AS build

# Install all dependencies for building
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM base AS production

# Create non-root user
RUN groupadd -r aiservice && useradd -r -g aiservice aiservice

# Copy built application
COPY --from=build --chown=aiservice:aiservice /app/dist ./dist
COPY --from=build --chown=aiservice:aiservice /app/node_modules ./node_modules
COPY --from=build --chown=aiservice:aiservice /app/package*.json ./

# Create necessary directories
RUN mkdir -p /app/logs /app/uploads /app/models && \
    chown -R aiservice:aiservice /app

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3004
ENV LOG_LEVEL=info

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3004/health || exit 1

# Switch to non-root user
USER aiservice

# Expose port
EXPOSE 3004

# Start the application
CMD ["node", "dist/index.js"]

# GPU-enabled stage (optional)
FROM nvidia/cuda:11.8-runtime-ubuntu20.04 AS gpu-production

# Install Node.js and system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && rm -rf /var/lib/apt/lists/*

# Install GPU-enabled Python packages
RUN pip3 install --no-cache-dir \
    tensorflow-gpu==2.13.0 \
    torch==2.0.1+cu118 \
    torchvision==0.15.2+cu118 \
    --extra-index-url https://download.pytorch.org/whl/cu118

# Copy from build stage
COPY --from=build /app/dist /app/dist
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package*.json /app/

WORKDIR /app

# Create non-root user
RUN groupadd -r aiservice && useradd -r -g aiservice aiservice && \
    chown -R aiservice:aiservice /app

USER aiservice

ENV NODE_ENV=production
ENV PORT=3004
ENV CUDA_VISIBLE_DEVICES=0

EXPOSE 3004

CMD ["node", "dist/index.js"]
