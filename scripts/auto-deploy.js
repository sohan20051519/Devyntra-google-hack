#!/usr/bin/env node

/**
 * Automated Deployment Script for Devyntra
 * Handles complete CI/CD pipeline automation
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class AutoDeploy {
    constructor() {
        this.projectId = 'devyntra-500e4';
        this.region = 'us-central1';
        this.repository = 'devyntra-images';
        this.serviceName = 'devyntra-web';
        this.imageName = 'devyntra-web';
    }

    async checkPrerequisites() {
        console.log('🔍 Checking prerequisites...');
        
        const requiredTools = ['gcloud', 'docker', 'node', 'npm'];
        const missingTools = [];

        for (const tool of requiredTools) {
            try {
                execSync(`which ${tool}`, { stdio: 'pipe' });
            } catch (error) {
                missingTools.push(tool);
            }
        }

        if (missingTools.length > 0) {
            throw new Error(`Missing required tools: ${missingTools.join(', ')}`);
        }

        console.log('✅ All prerequisites met');
    }

    async authenticateGoogleCloud() {
        console.log('🔐 Authenticating with Google Cloud...');
        
        const keyPath = path.join(process.cwd(), 'devyntra-deploy-key.json');
        
        if (!fs.existsSync(keyPath)) {
            throw new Error('Service account key not found. Please run setup first.');
        }

        try {
            execSync(`gcloud auth activate-service-account --key-file="${keyPath}"`, { stdio: 'inherit' });
            execSync(`gcloud config set project ${this.projectId}`, { stdio: 'inherit' });
            console.log('✅ Google Cloud authentication successful');
        } catch (error) {
            throw new Error(`Authentication failed: ${error.message}`);
        }
    }

    async setupGoogleCloudResources() {
        console.log('🏗️ Setting up Google Cloud resources...');
        
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

            // Create Artifact Registry repository
            try {
                execSync(`gcloud artifacts repositories describe ${this.repository} --location=${this.region} --quiet`, { stdio: 'pipe' });
                console.log('✅ Artifact Registry repository already exists');
            } catch (error) {
                execSync(`gcloud artifacts repositories create ${this.repository} --repository-format=docker --location=${this.region} --description="Devyntra images" --quiet`, { stdio: 'inherit' });
                console.log('✅ Artifact Registry repository created');
            }

            // Configure Docker authentication
            execSync(`gcloud auth configure-docker ${this.region}-docker.pkg.dev --quiet`, { stdio: 'inherit' });
            console.log('✅ Docker authentication configured');

        } catch (error) {
            throw new Error(`Google Cloud setup failed: ${error.message}`);
        }
    }

    async buildApplication() {
        console.log('🏗️ Building application...');
        
        const appDir = path.join(process.cwd(), 'Devyntra-google-hack');
        
        if (!fs.existsSync(appDir)) {
            throw new Error('Application directory not found');
        }

        try {
            // Install dependencies
            console.log('📦 Installing dependencies...');
            execSync('npm ci', { cwd: appDir, stdio: 'inherit' });

            // Build application
            console.log('🔨 Building application...');
            execSync('npm run build', { cwd: appDir, stdio: 'inherit' });

            console.log('✅ Application built successfully');
        } catch (error) {
            throw new Error(`Build failed: ${error.message}`);
        }
    }

    async buildAndPushDockerImage() {
        console.log('🐳 Building and pushing Docker image...');
        
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const imageTag = `${this.region}-docker.pkg.dev/${this.projectId}/${this.repository}/${this.imageName}:${timestamp}`;
            
            console.log(`📦 Building image: ${imageTag}`);
            execSync(`docker build -t ${imageTag} .`, { stdio: 'inherit' });

            console.log('📤 Pushing to Artifact Registry...');
            execSync(`docker push ${imageTag}`, { stdio: 'inherit' });

            console.log('✅ Docker image built and pushed successfully');
            return imageTag;
        } catch (error) {
            throw new Error(`Docker build/push failed: ${error.message}`);
        }
    }

    async deployToCloudRun(imageTag) {
        console.log('🚀 Deploying to Cloud Run...');
        
        try {
            execSync(`gcloud run deploy ${this.serviceName} --image ${imageTag} --region ${this.region} --platform managed --allow-unauthenticated --quiet`, { stdio: 'inherit' });
            
            // Get deployment URL
            const serviceUrl = execSync(`gcloud run services describe ${this.serviceName} --region ${this.region} --format="value(status.url)"`, { encoding: 'utf8' }).trim();
            
            console.log('✅ Deployment successful!');
            console.log(`🌐 Service URL: ${serviceUrl}`);
            
            return serviceUrl;
        } catch (error) {
            throw new Error(`Cloud Run deployment failed: ${error.message}`);
        }
    }

    async runHealthCheck(serviceUrl) {
        console.log('🏥 Running health check...');
        
        try {
            const https = require('https');
            const url = new URL(serviceUrl);
            
            const options = {
                hostname: url.hostname,
                port: url.port || 443,
                path: url.pathname,
                method: 'GET',
                timeout: 10000
            };

            return new Promise((resolve, reject) => {
                const req = https.request(options, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log('✅ Health check passed');
                        resolve(true);
                    } else {
                        console.log(`⚠️ Health check returned status: ${res.statusCode}`);
                        resolve(false);
                    }
                });

                req.on('error', (error) => {
                    console.log(`❌ Health check failed: ${error.message}`);
                    resolve(false);
                });

                req.on('timeout', () => {
                    console.log('❌ Health check timed out');
                    req.destroy();
                    resolve(false);
                });

                req.end();
            });
        } catch (error) {
            console.log(`❌ Health check error: ${error.message}`);
            return false;
        }
    }

    async createDeploymentReport(serviceUrl, imageTag) {
        console.log('📊 Creating deployment report...');
        
        const report = {
            timestamp: new Date().toISOString(),
            projectId: this.projectId,
            region: this.region,
            serviceName: this.serviceName,
            imageTag: imageTag,
            serviceUrl: serviceUrl,
            status: 'success'
        };

        const reportPath = path.join(process.cwd(), 'deployment-report.json');
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        
        console.log(`📄 Deployment report saved to: ${reportPath}`);
        return report;
    }

    async run() {
        try {
            console.log('🚀 Starting automated deployment...\n');
            
            await this.checkPrerequisites();
            await this.authenticateGoogleCloud();
            await this.setupGoogleCloudResources();
            await this.buildApplication();
            
            const imageTag = await this.buildAndPushDockerImage();
            const serviceUrl = await this.deployToCloudRun(imageTag);
            
            await this.runHealthCheck(serviceUrl);
            const report = await this.createDeploymentReport(serviceUrl, imageTag);
            
            console.log('\n🎉 Deployment completed successfully!');
            console.log(`🌐 Your application is live at: ${serviceUrl}`);
            console.log(`📊 Deployment report: ${JSON.stringify(report, null, 2)}`);
            
        } catch (error) {
            console.error('\n❌ Deployment failed:', error.message);
            process.exit(1);
        }
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log('Devyntra Automated Deployment');
        console.log('Usage: node auto-deploy.js [options]');
        console.log('');
        console.log('Options:');
        console.log('  --help, -h     Show this help message');
        console.log('  --dry-run      Show what would be deployed without actually deploying');
        console.log('');
        console.log('Prerequisites:');
        console.log('  - Google Cloud SDK installed and configured');
        console.log('  - Docker installed and running');
        console.log('  - Node.js and npm installed');
        console.log('  - Service account key file (devyntra-deploy-key.json)');
        return;
    }

    if (args.includes('--dry-run')) {
        console.log('🔍 Dry run mode - showing what would be deployed...');
        console.log('Project ID: devyntra-500e4');
        console.log('Region: us-central1');
        console.log('Service: devyntra-web');
        console.log('Repository: devyntra-images');
        return;
    }

    const deployer = new AutoDeploy();
    await deployer.run();
}

if (require.main === module) {
    main();
}

module.exports = AutoDeploy;
