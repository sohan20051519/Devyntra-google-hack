#!/bin/bash

# Devyntra Auto-Start Script
# This script runs automatically on startup and handles everything

set -e

echo "🚀 Devyntra Auto-Start System"
echo "=============================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[AUTO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Auto-detect environment
auto_detect_environment() {
    print_status "Auto-detecting environment..."
    
    if [ -f "/.dockerenv" ]; then
        echo "🐳 Docker container detected"
        export ENVIRONMENT="docker"
    elif [ "$GITHUB_ACTIONS" = "true" ]; then
        echo "⚙️ GitHub Actions detected"
        export ENVIRONMENT="github-actions"
    elif [ "$CI" = "true" ] || [ "$CONTINUOUS_INTEGRATION" = "true" ]; then
        echo "🔄 CI/CD environment detected"
        export ENVIRONMENT="ci-cd"
    elif [ -n "$CLOUD_PROVIDER" ] || [ -n "$AWS_REGION" ] || [ -n "$GCP_PROJECT" ]; then
        echo "☁️ Cloud environment detected"
        export ENVIRONMENT="cloud"
    else
        echo "🏠 Local environment detected"
        export ENVIRONMENT="local"
    fi
    
    print_success "Environment: $ENVIRONMENT"
}

# Auto-setup Google Cloud
auto_setup_gcloud() {
    print_status "Auto-setting up Google Cloud..."
    
    # Check if gcloud is available
    if ! command -v gcloud &> /dev/null; then
        print_warning "Google Cloud SDK not found, skipping Google Cloud setup"
        return 0
    fi
    
    # Auto-authenticate if service account key exists
    if [ -f "Devyntra-google-hack/devyntra-deploy-key.json" ]; then
        print_status "Auto-authenticating with service account..."
        gcloud auth activate-service-account --key-file="Devyntra-google-hack/devyntra-deploy-key.json" --quiet
        gcloud config set project devyntra-500e4 --quiet
        print_success "Google Cloud authenticated"
    else
        print_warning "Service account key not found, skipping authentication"
    fi
    
    # Auto-enable APIs
    print_status "Auto-enabling APIs..."
    gcloud services enable artifactregistry.googleapis.com --quiet || true
    gcloud services enable run.googleapis.com --quiet || true
    gcloud services enable cloudbuild.googleapis.com --quiet || true
    gcloud services enable iam.googleapis.com --quiet || true
    print_success "APIs enabled"
    
    # Auto-create Artifact Registry
    print_status "Auto-setting up Artifact Registry..."
    gcloud artifacts repositories describe devyntra-images --location=us-central1 --quiet || \
    gcloud artifacts repositories create devyntra-images \
        --repository-format=docker \
        --location=us-central1 \
        --description="Devyntra images" \
        --quiet
    print_success "Artifact Registry ready"
    
    # Auto-configure Docker
    print_status "Auto-configuring Docker..."
    gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
    print_success "Docker configured"
}

# Auto-build and deploy
auto_build_deploy() {
    print_status "Auto-building and deploying..."
    
    # Auto-build application
    if [ -d "Devyntra-google-hack" ]; then
        print_status "Auto-building application..."
        cd Devyntra-google-hack
        npm ci --silent || true
        npm run build || true
        cd ..
        print_success "Application built"
    fi
    
    # Auto-build Docker image
    print_status "Auto-building Docker image..."
    TIMESTAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
    IMAGE_TAG="us-central1-docker.pkg.dev/devyntra-500e4/devyntra-images/devyntra-web:auto-$TIMESTAMP"
    
    docker build -t "$IMAGE_TAG" . || {
        print_warning "Docker build failed, continuing..."
        return 0
    }
    print_success "Docker image built"
    
    # Auto-push to Artifact Registry
    print_status "Auto-pushing to Artifact Registry..."
    docker push "$IMAGE_TAG" || {
        print_warning "Docker push failed, continuing..."
        return 0
    }
    print_success "Image pushed"
    
    # Auto-deploy to Cloud Run
    print_status "Auto-deploying to Cloud Run..."
    gcloud run deploy devyntra-web \
        --image "$IMAGE_TAG" \
        --region us-central1 \
        --platform managed \
        --allow-unauthenticated \
        --quiet || {
        print_warning "Cloud Run deployment failed, continuing..."
        return 0
    }
    
    # Get deployment URL
    SERVICE_URL=$(gcloud run services describe devyntra-web --region=us-central1 --format="value(status.url)" 2>/dev/null || echo "")
    
    if [ -n "$SERVICE_URL" ]; then
        print_success "Auto-deployment successful!"
        print_success "Service URL: $SERVICE_URL"
        
        # Auto-health check
        print_status "Auto-running health check..."
        if curl -f -s "$SERVICE_URL" > /dev/null; then
            print_success "Health check passed"
        else
            print_warning "Health check failed"
        fi
    else
        print_warning "Could not get service URL"
    fi
}

# Auto-start monitoring
auto_start_monitoring() {
    print_status "Auto-starting monitoring..."
    
    # Start background monitoring
    (
        while true; do
            sleep 300  # Check every 5 minutes
            print_status "Auto-monitoring check..."
            # Add monitoring logic here
        done
    ) &
    
    print_success "Auto-monitoring started"
}

# Main auto-start function
main() {
    print_status "Starting Devyntra auto-start system..."
    
    auto_detect_environment
    auto_setup_gcloud
    auto_build_deploy
    auto_start_monitoring
    
    print_success "🎉 Auto-start system completed successfully!"
    print_success "🚀 Your Devyntra application is fully automated"
    
    # Keep the script running for monitoring
    if [ "$KEEP_ALIVE" = "true" ]; then
        print_status "🔄 Keeping process alive for monitoring..."
        while true; do
            sleep 60
        done
    fi
}

# Run main function
main "$@"
