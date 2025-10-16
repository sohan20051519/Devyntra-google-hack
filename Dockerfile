# Multi-stage build for Devyntra
FROM node:20-alpine AS base

# Install system dependencies
RUN apk add --no-cache \
    curl \
    bash \
    git \
    python3 \
    make \
    g++ \
    && rm -rf /var/cache/apk/*

# Install Google Cloud SDK
RUN curl https://sdk.cloud.google.com | bash
ENV PATH $PATH:/root/google-cloud-sdk/bin

# Development stage
FROM base AS development
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=development
EXPOSE 3000
CMD ["npm", "run", "dev"]

# Build stage
FROM base AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY Devyntra-google-hack/package*.json ./Devyntra-google-hack/

# Install dependencies
RUN npm ci --only=production
WORKDIR /app/Devyntra-google-hack
RUN npm ci

# Copy source code
COPY Devyntra-google-hack/ ./

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

# Install serve and Google Cloud SDK
RUN apk add --no-cache curl bash
RUN npm install -g serve
RUN curl https://sdk.cloud.google.com | bash
ENV PATH $PATH:/root/google-cloud-sdk/bin

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S devyntra -u 1001

# Set working directory
WORKDIR /app

# Copy built application
COPY --from=builder --chown=devyntra:nodejs /app/Devyntra-google-hack/dist ./dist
COPY --from=builder --chown=devyntra:nodejs /app/Devyntra-google-hack/package*.json ./

# Set environment variables
ENV NODE_ENV=production
ENV KEEP_ALIVE=true
ENV PORT=8080

# Switch to non-root user
USER devyntra

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/ || exit 1

# Start the application
CMD ["serve", "-s", "dist", "-l", "8080"]

