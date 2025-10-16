#!/bin/bash

# Devyntra Complete Automation Setup
# This script sets up everything needed for automated deployment

set -e

echo "🚀 Devyntra Complete Automation Setup"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
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

# Check if running as root
check_root() {
    if [[ $EUID -eq 0 ]]; then
        print_error "This script should not be run as root"
        exit 1
    fi
}

# Check system requirements
check_requirements() {
    print_status "Checking system requirements..."
    
    # Check for required commands
    local missing_tools=()
    
    if ! command -v gcloud &> /dev/null; then
        missing_tools+=("gcloud")
    fi
    
    if ! command -v docker &> /dev/null; then
        missing_tools+=("docker")
    fi
    
    if ! command -v node &> /dev/null; then
        missing_tools+=("node")
    fi
    
    if ! command -v npm &> /dev/null; then
        missing_tools+=("npm")
    fi
    
    if [ ${#missing_tools[@]} -ne 0 ]; then
        print_error "Missing required tools: ${missing_tools[*]}"
        print_status "Please install the missing tools and run this script again"
        exit 1
    fi
    
    print_success "All required tools are installed"
}

# Install Google Cloud SDK if not present
install_gcloud() {
    if ! command -v gcloud &> /dev/null; then
        print_status "Installing Google Cloud SDK..."
        
        # Detect OS
        if [[ "$OSTYPE" == "linux-gnu"* ]]; then
            # Linux
            curl https://sdk.cloud.google.com | bash
            exec -l $SHELL
        elif [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            if command -v brew &> /dev/null; then
                brew install --cask google-cloud-sdk
            else
                print_error "Please install Google Cloud SDK manually"
                exit 1
            fi
        else
            print_error "Unsupported operating system"
            exit 1
        fi
    fi
}

# Setup Google Cloud project
setup_gcloud_project() {
    print_status "Setting up Google Cloud project..."
    
    # Initialize gcloud
    gcloud init --no-launch-browser
    
    # Set project
    gcloud config set project devyntra-500e4
    
    # Enable required APIs
    print_status "Enabling required APIs..."
    gcloud services enable artifactregistry.googleapis.com
    gcloud services enable run.googleapis.com
    gcloud services enable cloudbuild.googleapis.com
    gcloud services enable iam.googleapis.com
    
    print_success "Google Cloud project configured"
}

# Create service account and key
create_service_account() {
    print_status "Creating service account..."
    
    local service_account="devyntra-deploy"
    local service_account_email="${service_account}@devyntra-500e4.iam.gserviceaccount.com"
    
    # Create service account if it doesn't exist
    if ! gcloud iam service-accounts describe "$service_account_email" &> /dev/null; then
        gcloud iam service-accounts create "$service_account" \
            --display-name="Devyntra Deploy Service Account" \
            --description="Service account for Devyntra deployment automation"
        print_success "Service account created"
    else
        print_status "Service account already exists"
    fi
    
    # Grant necessary roles
    print_status "Granting permissions..."
    gcloud projects add-iam-policy-binding devyntra-500e4 \
        --member="serviceAccount:$service_account_email" \
        --role="roles/artifactregistry.writer"
    
    gcloud projects add-iam-policy-binding devyntra-500e4 \
        --member="serviceAccount:$service_account_email" \
        --role="roles/run.admin"
    
    gcloud projects add-iam-policy-binding devyntra-500e4 \
        --member="serviceAccount:$service_account_email" \
        --role="roles/iam.serviceAccountUser"
    
    gcloud projects add-iam-policy-binding devyntra-500e4 \
        --member="serviceAccount:$service_account_email" \
        --role="roles/storage.admin"
    
    # Create service account key
    print_status "Creating service account key..."
    gcloud iam service-accounts keys create devyntra-deploy-key.json \
        --iam-account="$service_account_email"
    
    print_success "Service account key created"
}

# Create Artifact Registry repository
create_artifact_registry() {
    print_status "Creating Artifact Registry repository..."
    
    local repository="devyntra-images"
    local region="us-central1"
    
    if ! gcloud artifacts repositories describe "$repository" --location="$region" &> /dev/null; then
        gcloud artifacts repositories create "$repository" \
            --repository-format=docker \
            --location="$region" \
            --description="Devyntra images"
        print_success "Artifact Registry repository created"
    else
        print_status "Artifact Registry repository already exists"
    fi
}

# Setup GitHub integration
setup_github_integration() {
    print_status "Setting up GitHub integration..."
    
    # Create GitHub secrets setup script
    cat > setup-github-secrets.sh << 'EOF'
#!/bin/bash

# GitHub Secrets Setup Script
# Run this script with your GitHub token and repository details

if [ $# -ne 3 ]; then
    echo "Usage: $0 <github_token> <repo_owner> <repo_name>"
    echo "Example: $0 ghp_xxx your-username your-repo"
    exit 1
fi

GITHUB_TOKEN="$1"
REPO_OWNER="$2"
REPO_NAME="$3"

echo "🔐 Setting up GitHub secrets..."

# Create GCP_SA_KEY secret
curl -X PUT \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/secrets/GCP_SA_KEY" \
  -d "{
    \"encrypted_value\": \"$(base64 -w 0 devyntra-deploy-key.json)\"
  }"

echo "✅ GitHub secret GCP_SA_KEY created"
EOF

    chmod +x setup-github-secrets.sh
    print_success "GitHub integration script created"
}

# Create deployment scripts
create_deployment_scripts() {
    print_status "Creating deployment scripts..."
    
    # Create package.json with automation scripts
    cat > package.json << 'EOF'
{
  "name": "devyntra-automation",
  "version": "1.0.0",
  "description": "Automated deployment scripts for Devyntra",
  "scripts": {
    "setup": "node scripts/automate-setup.js",
    "deploy": "node scripts/auto-deploy.js",
    "setup-github": "bash setup-github-secrets.sh",
    "full-setup": "npm run setup && npm run setup-github",
    "quick-deploy": "bash scripts/deploy.sh"
  },
  "dependencies": {
    "child_process": "^1.0.2"
  }
}
EOF

    print_success "Deployment scripts created"
}

# Create directories
create_directories() {
    print_status "Creating directory structure..."
    
    mkdir -p scripts
    mkdir -p .github/workflows
    
    print_success "Directory structure created"
}

# Main setup function
main() {
    echo "Starting Devyntra automation setup..."
    echo ""
    
    check_root
    check_requirements
    install_gcloud
    setup_gcloud_project
    create_service_account
    create_artifact_registry
    create_directories
    setup_github_integration
    create_deployment_scripts
    
    echo ""
    print_success "🎉 Devyntra automation setup completed successfully!"
    echo ""
    echo "📋 Next steps:"
    echo "1. Run: ./setup-github-secrets.sh <github_token> <repo_owner> <repo_name>"
    echo "2. Or manually add the GCP_SA_KEY secret to your GitHub repository"
    echo "3. Push your code to trigger automated deployment"
    echo ""
    echo "🔧 Available commands:"
    echo "- npm run deploy: Deploy manually"
    echo "- npm run setup-github: Setup GitHub secrets"
    echo "- npm run full-setup: Complete automated setup"
    echo ""
    echo "🚀 Your Devyntra application is ready for automated deployment!"
}

# Run main function
main "$@"
