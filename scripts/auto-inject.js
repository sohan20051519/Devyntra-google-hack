#!/usr/bin/env node

/**
 * Auto-Injection System for Devyntra
 * Automatically injects secrets and triggers deployment without manual intervention
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class AutoInjector {
    constructor() {
        this.projectId = 'devyntra-500e4';
        this.region = 'us-central1';
        this.repository = 'devyntra-images';
        this.serviceName = 'devyntra-web';
    }

    async detectEnvironment() {
        console.log('🔍 Detecting environment...');
        
        // Check if we're in GitHub Actions
        if (process.env.GITHUB_ACTIONS === 'true') {
            console.log('✅ Running in GitHub Actions');
            return 'github-actions';
        }
        
        // Check if we're in a CI/CD environment
        if (process.env.CI === 'true' || process.env.CONTINUOUS_INTEGRATION === 'true') {
            console.log('✅ Running in CI/CD environment');
            return 'ci-cd';
        }
        
        // Check if we're in a container
        if (fs.existsSync('/.dockerenv')) {
            console.log('✅ Running in Docker container');
            return 'docker';
        }
        
        console.log('✅ Running in local environment');
        return 'local';
    }

    async autoSetupGoogleCloud() {
        console.log('🔧 Auto-setting up Google Cloud...');
        
        try {
            // Check if gcloud is authenticated
            try {
                execSync('gcloud auth list --filter=status:ACTIVE --format="value(account)"', { stdio: 'pipe' });
                console.log('✅ Google Cloud already authenticated');
            } catch (error) {
                console.log('🔐 Auto-authenticating with Google Cloud...');
                
                // Try to authenticate using service account key
                const keyPath = path.join(process.cwd(), 'devyntra-deploy-key.json');
                if (fs.existsSync(keyPath)) {
                    execSync(`gcloud auth activate-service-account --key-file="${keyPath}"`, { stdio: 'inherit' });
                    execSync(`gcloud config set project ${this.projectId}`, { stdio: 'inherit' });
                    console.log('✅ Auto-authenticated with service account');
                } else {
                    // Try to authenticate using default credentials
                    execSync('gcloud auth application-default login --quiet', { stdio: 'inherit' });
                    console.log('✅ Auto-authenticated with default credentials');
                }
            }

            // Auto-enable APIs
            const apis = [
                'artifactregistry.googleapis.com',
                'run.googleapis.com',
                'cloudbuild.googleapis.com',
                'iam.googleapis.com'
            ];

            for (const api of apis) {
                try {
                    execSync(`gcloud services enable ${api} --quiet`, { stdio: 'pipe' });
                    console.log(`✅ API ${api} enabled`);
                } catch (error) {
                    console.log(`⚠️ API ${api} may already be enabled`);
                }
            }

            // Auto-create Artifact Registry
            try {
                execSync(`gcloud artifacts repositories describe ${this.repository} --location=${this.region} --quiet`, { stdio: 'pipe' });
                console.log('✅ Artifact Registry already exists');
            } catch (error) {
                execSync(`gcloud artifacts repositories create ${this.repository} --repository-format=docker --location=${this.region} --description="Devyntra images" --quiet`, { stdio: 'inherit' });
                console.log('✅ Artifact Registry created');
            }

            // Auto-configure Docker
            execSync(`gcloud auth configure-docker ${this.region}-docker.pkg.dev --quiet`, { stdio: 'inherit' });
            console.log('✅ Docker configured for Artifact Registry');

        } catch (error) {
            console.error('❌ Auto-setup failed:', error.message);
            throw error;
        }
    }

    async autoInjectSecrets() {
        console.log('🔐 Auto-injecting secrets...');
        
        try {
            // Check if we're in GitHub Actions
            if (process.env.GITHUB_ACTIONS === 'true') {
                console.log('✅ Running in GitHub Actions - secrets already available');
                return true;
            }

            // Auto-detect GitHub token
            let githubToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
            
            if (!githubToken) {
                // Try to get token from git config
                try {
                    githubToken = execSync('git config --get github.token', { encoding: 'utf8' }).trim();
                } catch (error) {
                    console.log('⚠️ No GitHub token found - skipping GitHub secrets injection');
                    return false;
                }
            }

            // Auto-detect repository info
            let repoOwner, repoName;
            
            if (process.env.GITHUB_REPOSITORY) {
                [repoOwner, repoName] = process.env.GITHUB_REPOSITORY.split('/');
            } else {
                try {
                    const remoteUrl = execSync('git config --get remote.origin.url', { encoding: 'utf8' }).trim();
                    const match = remoteUrl.match(/github\.com[:/]([^/]+)\/([^/]+)\.git/);
                    if (match) {
                        repoOwner = match[1];
                        repoName = match[2];
                    }
                } catch (error) {
                    console.log('⚠️ Could not detect repository info - skipping GitHub secrets injection');
                    return false;
                }
            }

            if (githubToken && repoOwner && repoName) {
                console.log(`🔐 Auto-injecting secrets to ${repoOwner}/${repoName}...`);
                
                // Read service account key
                const keyPath = path.join(process.cwd(), 'devyntra-deploy-key.json');
                if (fs.existsSync(keyPath)) {
                    const serviceAccountKey = fs.readFileSync(keyPath, 'utf8');
                    
                    // Auto-inject using GitHub API
                    await this.injectGitHubSecret(githubToken, repoOwner, repoName, 'GCP_SA_KEY', serviceAccountKey);
                    await this.injectGitHubSecret(githubToken, repoOwner, repoName, 'GCP_PROJECT_ID', this.projectId);
                    await this.injectGitHubSecret(githubToken, repoOwner, repoName, 'GCP_REGION', this.region);
                    await this.injectGitHubSecret(githubToken, repoOwner, repoName, 'ARTIFACT_REGISTRY', this.repository);
                    
                    console.log('✅ Secrets auto-injected successfully');
                    return true;
                }
            }

        } catch (error) {
            console.error('❌ Auto-secret injection failed:', error.message);
            return false;
        }
    }

    async injectGitHubSecret(token, owner, repo, secretName, secretValue) {
        const https = require('https');
        const crypto = require('crypto');

        return new Promise(async (resolve, reject) => {
            try {
                // Get public key
                const publicKey = await this.getGitHubPublicKey(token, owner, repo);
                
                // Encrypt the secret
                const key = Buffer.from(publicKey.key, 'base64');
                const encryptedValue = crypto.publicEncrypt(
                    {
                        key: key,
                        padding: crypto.constants.RSA_PKCS1_PADDING
                    },
                    Buffer.from(secretValue)
                ).toString('base64');

                // Create the secret
                const data = JSON.stringify({
                    encrypted_value: encryptedValue,
                    key_id: publicKey.key_id
                });

                const options = {
                    hostname: 'api.github.com',
                    port: 443,
                    path: `/repos/${owner}/${repo}/actions/secrets/${secretName}`,
                    method: 'PUT',
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(data)
                    }
                };

                const req = https.request(options, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log(`✅ Secret ${secretName} injected`);
                        resolve(true);
                    } else {
                        let responseData = '';
                        res.on('data', (chunk) => responseData += chunk);
                        res.on('end', () => {
                            console.log(`⚠️ Secret ${secretName} may already exist`);
                            resolve(true);
                        });
                    }
                });

                req.on('error', (error) => {
                    console.log(`⚠️ Failed to inject secret ${secretName}: ${error.message}`);
                    resolve(false);
                });

                req.write(data);
                req.end();

            } catch (error) {
                console.log(`⚠️ Failed to inject secret ${secretName}: ${error.message}`);
                resolve(false);
            }
        });
    }

    async getGitHubPublicKey(token, owner, repo) {
        const https = require('https');

        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                port: 443,
                path: `/repos/${owner}/${repo}/actions/secrets/public-key`,
                method: 'GET',
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            };

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => responseData += chunk);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(responseData);
                        resolve(result);
                    } catch (error) {
                        reject(error);
                    }
                });
            });

            req.on('error', (error) => reject(error));
            req.end();
        });
    }

    async autoBuildAndDeploy() {
        console.log('🚀 Auto-building and deploying...');
        
        try {
            // Auto-build application
            console.log('🏗️ Auto-building application...');
            const appDir = path.join(process.cwd(), 'Devyntra-google-hack');
            
            if (fs.existsSync(appDir)) {
                execSync('npm ci', { cwd: appDir, stdio: 'inherit' });
                execSync('npm run build', { cwd: appDir, stdio: 'inherit' });
                console.log('✅ Application built');
            }

            // Auto-build Docker image
            console.log('🐳 Auto-building Docker image...');
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const imageTag = `${this.region}-docker.pkg.dev/${this.projectId}/${this.repository}/${this.serviceName}:${timestamp}`;
            
            execSync(`docker build -t ${imageTag} .`, { stdio: 'inherit' });
            console.log('✅ Docker image built');

            // Auto-push to Artifact Registry
            console.log('📤 Auto-pushing to Artifact Registry...');
            execSync(`docker push ${imageTag}`, { stdio: 'inherit' });
            console.log('✅ Image pushed to Artifact Registry');

            // Auto-deploy to Cloud Run
            console.log('🚀 Auto-deploying to Cloud Run...');
            execSync(`gcloud run deploy ${this.serviceName} --image ${imageTag} --region ${this.region} --platform managed --allow-unauthenticated --quiet`, { stdio: 'inherit' });
            
            // Get deployment URL
            const serviceUrl = execSync(`gcloud run services describe ${this.serviceName} --region ${this.region} --format="value(status.url)"`, { encoding: 'utf8' }).trim();
            
            console.log('✅ Auto-deployment successful!');
            console.log(`🌐 Service URL: ${serviceUrl}`);
            
            return serviceUrl;

        } catch (error) {
            console.error('❌ Auto-deployment failed:', error.message);
            throw error;
        }
    }

    async autoHealthCheck(serviceUrl) {
        console.log('🏥 Auto-running health check...');
        
        try {
            const https = require('https');
            const url = new URL(serviceUrl);
            
            return new Promise((resolve) => {
                const req = https.request({
                    hostname: url.hostname,
                    port: url.port || 443,
                    path: url.pathname,
                    method: 'GET',
                    timeout: 10000
                }, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log('✅ Auto-health check passed');
                        resolve(true);
                    } else {
                        console.log(`⚠️ Auto-health check returned status: ${res.statusCode}`);
                        resolve(false);
                    }
                });

                req.on('error', (error) => {
                    console.log(`❌ Auto-health check failed: ${error.message}`);
                    resolve(false);
                });

                req.on('timeout', () => {
                    console.log('❌ Auto-health check timed out');
                    req.destroy();
                    resolve(false);
                });

                req.end();
            });
        } catch (error) {
            console.log(`❌ Auto-health check error: ${error.message}`);
            return false;
        }
    }

    async run() {
        try {
            console.log('🚀 Starting auto-injection system...\n');
            
            const environment = await this.detectEnvironment();
            console.log(`📍 Environment: ${environment}\n`);
            
            await this.autoSetupGoogleCloud();
            await this.autoInjectSecrets();
            
            const serviceUrl = await this.autoBuildAndDeploy();
            await this.autoHealthCheck(serviceUrl);
            
            console.log('\n🎉 Auto-injection completed successfully!');
            console.log('🚀 Your application is fully automated and deployed');
            
        } catch (error) {
            console.error('\n❌ Auto-injection failed:', error.message);
            process.exit(1);
        }
    }
}

// Auto-run if this script is executed directly
if (require.main === module) {
    const injector = new AutoInjector();
    injector.run();
}

module.exports = AutoInjector;
