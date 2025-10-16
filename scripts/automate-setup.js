#!/usr/bin/env node

/**
 * Automated Setup Script for Devyntra Deployment
 * This script automates the entire setup process including:
 * - GitHub Secrets creation
 * - Google Cloud service account management
 * - Repository configuration
 * - Deployment automation
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class DevyntraAutomation {
    constructor() {
        this.projectId = 'devyntra-500e4';
        this.region = 'us-central1';
        this.repository = 'devyntra-images';
        this.serviceAccountName = 'devyntra-deploy';
        this.serviceAccountEmail = `${this.serviceAccountName}@${this.projectId}.iam.gserviceaccount.com`;
    }

    async setupGoogleCloud() {
        console.log('🔧 Setting up Google Cloud resources...');
        
        try {
            // Enable required APIs
            const apis = [
                'artifactregistry.googleapis.com',
                'run.googleapis.com',
                'cloudbuild.googleapis.com',
                'iam.googleapis.com'
            ];

            for (const api of apis) {
                console.log(`📡 Enabling ${api}...`);
                execSync(`gcloud services enable ${api} --quiet`, { stdio: 'inherit' });
            }

            // Create Artifact Registry repository if it doesn't exist
            console.log('📦 Setting up Artifact Registry...');
            try {
                execSync(`gcloud artifacts repositories describe ${this.repository} --location=${this.region} --quiet`, { stdio: 'pipe' });
                console.log('✅ Artifact Registry repository already exists');
            } catch (error) {
                execSync(`gcloud artifacts repositories create ${this.repository} --repository-format=docker --location=${this.region} --description="Devyntra images" --quiet`, { stdio: 'inherit' });
                console.log('✅ Artifact Registry repository created');
            }

            // Create service account if it doesn't exist
            console.log('👤 Setting up service account...');
            try {
                execSync(`gcloud iam service-accounts describe ${this.serviceAccountEmail} --quiet`, { stdio: 'pipe' });
                console.log('✅ Service account already exists');
            } catch (error) {
                execSync(`gcloud iam service-accounts create ${this.serviceAccountName} --display-name="Devyntra Deploy Service Account" --description="Service account for Devyntra deployment automation" --quiet`, { stdio: 'inherit' });
                console.log('✅ Service account created');
            }

            // Grant necessary permissions
            const roles = [
                'roles/artifactregistry.writer',
                'roles/run.admin',
                'roles/iam.serviceAccountUser',
                'roles/storage.admin'
            ];

            for (const role of roles) {
                console.log(`🔐 Granting ${role}...`);
                execSync(`gcloud projects add-iam-policy-binding ${this.projectId} --member="serviceAccount:${this.serviceAccountEmail}" --role="${role}" --quiet`, { stdio: 'inherit' });
            }

            console.log('✅ Google Cloud setup completed');

        } catch (error) {
            console.error('❌ Error setting up Google Cloud:', error.message);
            throw error;
        }
    }

    async createServiceAccountKey() {
        console.log('🔑 Creating service account key...');
        
        try {
            const keyPath = path.join(process.cwd(), 'devyntra-deploy-key.json');
            
            // Create service account key
            execSync(`gcloud iam service-accounts keys create ${keyPath} --iam-account=${this.serviceAccountEmail} --quiet`, { stdio: 'inherit' });
            
            console.log('✅ Service account key created');
            return keyPath;
        } catch (error) {
            console.error('❌ Error creating service account key:', error.message);
            throw error;
        }
    }

    async setupGitHubSecrets(keyPath) {
        console.log('🔐 Setting up GitHub secrets...');
        
        try {
            const keyContent = fs.readFileSync(keyPath, 'utf8');
            
            // This would require GitHub API token and repository access
            // For now, we'll create a script that can be run with proper credentials
            const setupScript = `
#!/bin/bash

# GitHub API setup script
# Run this script with your GitHub token and repository details

GITHUB_TOKEN="$1"
REPO_OWNER="$2"
REPO_NAME="$3"

if [ -z "$GITHUB_TOKEN" ] || [ -z "$REPO_OWNER" ] || [ -z "$REPO_NAME" ]; then
    echo "Usage: $0 <github_token> <repo_owner> <repo_name>"
    exit 1
fi

# Create or update the GCP_SA_KEY secret
curl -X PUT \\
  -H "Authorization: token $GITHUB_TOKEN" \\
  -H "Accept: application/vnd.github.v3+json" \\
  "https://api.github.com/repos/$REPO_OWNER/$REPO_NAME/actions/secrets/GCP_SA_KEY" \\
  -d '{
    "encrypted_value": "'$(echo "$(cat devyntra-deploy-key.json)" | base64 -w 0)'",
    "key_id": "your-key-id"
  }'

echo "✅ GitHub secret GCP_SA_KEY created/updated"
`;

            fs.writeFileSync('scripts/setup-github-secrets.sh', setupScript);
            console.log('📝 GitHub secrets setup script created: scripts/setup-github-secrets.sh');
            console.log('💡 Run this script with your GitHub token to automate secret creation');
            
        } catch (error) {
            console.error('❌ Error setting up GitHub secrets:', error.message);
            throw error;
        }
    }

    async createAutomatedWorkflow() {
        console.log('⚙️ Creating automated workflow...');
        
        const workflowContent = `name: Automated Devyntra Deployment

on:
  push:
    branches: [ main, master ]
  pull_request:
    branches: [ main, master ]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deployment environment'
        required: true
        default: 'production'
        type: choice
        options:
        - production
        - staging

permissions:
  contents: read
  id-token: write

env:
  REGION: us-central1
  REPOSITORY: devyntra-images
  IMAGE_NAME: devyntra-web
  SERVICE_NAME: devyntra-web
  PROJECT_ID: devyntra-500e4

jobs:
  setup-and-deploy:
    runs-on: ubuntu-latest
    environment: \${{ github.event.inputs.environment || 'production' }}
    
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: |
          cd Devyntra-google-hack
          npm ci

      - name: Build application
        run: |
          cd Devyntra-google-hack
          npm run build

      - name: Authenticate to Google Cloud
        uses: google-github-actions/auth@v2
        with:
          credentials_json: \${{ secrets.GCP_SA_KEY }}

      - name: Setup Google Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Configure Docker for Artifact Registry
        run: |
          gcloud auth configure-docker \$REGION-docker.pkg.dev --quiet

      - name: Build and push Docker image
        run: |
          cd Devyntra-google-hack
          IMAGE_PATH="\$REGION-docker.pkg.dev/\$PROJECT_ID/\$REPOSITORY/\$IMAGE_NAME:sha-\${{ github.sha }}"
          echo "IMAGE_PATH=\$IMAGE_PATH" >> \$GITHUB_ENV
          docker build -t "\$IMAGE_PATH" .
          docker push "\$IMAGE_PATH"

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy "\$SERVICE_NAME" \\
            --image "\$IMAGE_PATH" \\
            --region "\$REGION" \\
            --platform managed \\
            --allow-unauthenticated \\
            --quiet

      - name: Get deployment URL
        id: get-url
        run: |
          SERVICE_URL=\$(gcloud run services describe "\$SERVICE_NAME" --region="\$REGION" --format="value(status.url)")
          echo "service_url=\$SERVICE_URL" >> \$GITHUB_OUTPUT
          echo "🚀 Deployment URL: \$SERVICE_URL"

      - name: Comment deployment URL
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: \`🚀 **Deployment Successful!**\\n\\n**Environment:** \${{ github.event.inputs.environment || 'production' }}\\n**URL:** \${{ steps.get-url.outputs.service_url }}\\n**Commit:** \${{ github.sha }}\`
            })
`;

        const workflowDir = '.github/workflows';
        if (!fs.existsSync(workflowDir)) {
            fs.mkdirSync(workflowDir, { recursive: true });
        }
        
        fs.writeFileSync('.github/workflows/automated-deployment.yml', workflowContent);
        console.log('✅ Automated workflow created');
    }

    async createDeploymentScript() {
        console.log('🚀 Creating deployment script...');
        
        const deploymentScript = `#!/bin/bash

# Devyntra Automated Deployment Script
# This script handles the complete deployment process

set -e

echo "🚀 Starting Devyntra deployment automation..."

# Check if required tools are installed
check_dependencies() {
    echo "🔍 Checking dependencies..."
    
    if ! command -v gcloud &> /dev/null; then
        echo "❌ Google Cloud SDK not found. Please install it first."
        exit 1
    fi
    
    if ! command -v docker &> /dev/null; then
        echo "❌ Docker not found. Please install it first."
        exit 1
    fi
    
    if ! command -v node &> /dev/null; then
        echo "❌ Node.js not found. Please install it first."
        exit 1
    fi
    
    echo "✅ All dependencies found"
}

# Authenticate with Google Cloud
authenticate_gcloud() {
    echo "🔐 Authenticating with Google Cloud..."
    
    if [ -f "devyntra-deploy-key.json" ]; then
        gcloud auth activate-service-account --key-file="devyntra-deploy-key.json"
        gcloud config set project devyntra-500e4
        echo "✅ Authenticated with service account"
    else
        echo "❌ Service account key not found. Please run setup first."
        exit 1
    fi
}

# Build and deploy
build_and_deploy() {
    echo "🏗️ Building application..."
    
    cd Devyntra-google-hack
    
    # Install dependencies
    npm ci
    
    # Build application
    npm run build
    
    # Configure Docker
    gcloud auth configure-docker us-central1-docker.pkg.dev --quiet
    
    # Build Docker image
    IMAGE_PATH="us-central1-docker.pkg.dev/devyntra-500e4/devyntra-images/devyntra-web:latest"
    docker build -t "$IMAGE_PATH" .
    
    # Push to Artifact Registry
    echo "📦 Pushing to Artifact Registry..."
    docker push "$IMAGE_PATH"
    
    # Deploy to Cloud Run
    echo "🚀 Deploying to Cloud Run..."
    gcloud run deploy devyntra-web \\
        --image "$IMAGE_PATH" \\
        --region us-central1 \\
        --platform managed \\
        --allow-unauthenticated \\
        --quiet
    
    # Get deployment URL
    SERVICE_URL=$(gcloud run services describe devyntra-web --region=us-central1 --format="value(status.url)")
    echo "🎉 Deployment successful!"
    echo "🌐 URL: $SERVICE_URL"
}

# Main execution
main() {
    check_dependencies
    authenticate_gcloud
    build_and_deploy
}

# Run main function
main "$@"
`;

        fs.writeFileSync('scripts/deploy.sh', deploymentScript);
        fs.chmodSync('scripts/deploy.sh', '755');
        console.log('✅ Deployment script created: scripts/deploy.sh');
    }

    async createPackageJson() {
        console.log('📦 Creating package.json for automation...');
        
        const packageJson = {
            "name": "devyntra-automation",
            "version": "1.0.0",
            "description": "Automated deployment scripts for Devyntra",
            "scripts": {
                "setup": "node scripts/automate-setup.js",
                "deploy": "bash scripts/deploy.sh",
                "setup-github": "bash scripts/setup-github-secrets.sh",
                "full-setup": "npm run setup && npm run setup-github"
            },
            "dependencies": {
                "child_process": "^1.0.2"
            },
            "devDependencies": {
                "@types/node": "^20.0.0"
            }
        };

        fs.writeFileSync('package.json', JSON.stringify(packageJson, null, 2));
        console.log('✅ Package.json created with automation scripts');
    }

    async run() {
        try {
            console.log('🚀 Starting Devyntra automation setup...\n');
            
            await this.setupGoogleCloud();
            const keyPath = await this.createServiceAccountKey();
            await this.setupGitHubSecrets(keyPath);
            await this.createAutomatedWorkflow();
            await this.createDeploymentScript();
            await this.createPackageJson();
            
            console.log('\n🎉 Automation setup completed successfully!');
            console.log('\n📋 Next steps:');
            console.log('1. Run: npm run setup-github <github_token> <repo_owner> <repo_name>');
            console.log('2. Or manually add the GCP_SA_KEY secret to your GitHub repository');
            console.log('3. Push your code to trigger the automated deployment');
            console.log('\n🔧 Available commands:');
            console.log('- npm run setup: Setup Google Cloud resources');
            console.log('- npm run deploy: Deploy manually');
            console.log('- npm run full-setup: Complete automated setup');
            
        } catch (error) {
            console.error('\n❌ Automation setup failed:', error.message);
            process.exit(1);
        }
    }
}

// Run the automation
if (require.main === module) {
    const automation = new DevyntraAutomation();
    automation.run();
}

module.exports = DevyntraAutomation;
