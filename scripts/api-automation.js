#!/usr/bin/env node

/**
 * API-Based Automation System for Devyntra
 * Handles complete automation through APIs without manual intervention
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class APIAutomation {
    constructor() {
        this.projectId = 'devyntra-500e4';
        this.region = 'us-central1';
        this.repository = 'devyntra-images';
        this.serviceName = 'devyntra-web';
    }

    // Google Cloud API integration
    async makeGCPRequest(endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'cloudresourcemanager.googleapis.com',
                port: 443,
                path: endpoint,
                method: method,
                headers: {
                    'Authorization': `Bearer ${await this.getAccessToken()}`,
                    'Content-Type': 'application/json'
                }
            };

            if (data) {
                options.headers['Content-Length'] = Buffer.byteLength(data);
            }

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => responseData += chunk);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(responseData);
                        resolve(result);
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => reject(error));
            
            if (data) {
                req.write(data);
            }
            req.end();
        });
    }

    async getAccessToken() {
        try {
            const result = execSync('gcloud auth print-access-token', { encoding: 'utf8' });
            return result.trim();
        } catch (error) {
            throw new Error('Failed to get access token. Please authenticate with gcloud.');
        }
    }

    // GitHub API integration
    async makeGitHubRequest(endpoint, method = 'GET', data = null, token = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                port: 443,
                path: endpoint,
                method: method,
                headers: {
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Devyntra-Automation/1.0'
                }
            };

            if (token) {
                options.headers['Authorization'] = `token ${token}`;
            }

            if (data) {
                options.headers['Content-Type'] = 'application/json';
                options.headers['Content-Length'] = Buffer.byteLength(data);
            }

            const req = https.request(options, (res) => {
                let responseData = '';
                res.on('data', (chunk) => responseData += chunk);
                res.on('end', () => {
                    try {
                        const result = JSON.parse(responseData);
                        if (res.statusCode >= 200 && res.statusCode < 300) {
                            resolve(result);
                        } else {
                            reject(new Error(`GitHub API Error: ${res.statusCode} - ${result.message || responseData}`));
                        }
                    } catch (error) {
                        reject(new Error(`Failed to parse response: ${error.message}`));
                    }
                });
            });

            req.on('error', (error) => reject(error));
            
            if (data) {
                req.write(data);
            }
            req.end();
        });
    }

    // Automated service account creation
    async createServiceAccount() {
        console.log('👤 Creating service account via API...');
        
        try {
            const serviceAccountData = {
                accountId: 'devyntra-deploy',
                serviceAccount: {
                    displayName: 'Devyntra Deploy Service Account',
                    description: 'Service account for Devyntra deployment automation'
                }
            };

            const endpoint = `/v1/projects/${this.projectId}/serviceAccounts`;
            await this.makeGCPRequest(endpoint, 'POST', JSON.stringify(serviceAccountData));
            
            console.log('✅ Service account created');
            return true;
        } catch (error) {
            if (error.message.includes('already exists')) {
                console.log('✅ Service account already exists');
                return true;
            }
            throw error;
        }
    }

    // Automated IAM policy binding
    async bindIAMPolicy() {
        console.log('🔐 Setting up IAM permissions...');
        
        const roles = [
            'roles/artifactregistry.writer',
            'roles/run.admin',
            'roles/iam.serviceAccountUser',
            'roles/storage.admin'
        ];

        const serviceAccountEmail = `devyntra-deploy@${this.projectId}.iam.gserviceaccount.com`;

        for (const role of roles) {
            try {
                const policyData = {
                    policy: {
                        bindings: [{
                            role: role,
                            members: [`serviceAccount:${serviceAccountEmail}`]
                        }]
                    }
                };

                const endpoint = `/v1/projects/${this.projectId}:setIamPolicy`;
                await this.makeGCPRequest(endpoint, 'POST', JSON.stringify(policyData));
                console.log(`✅ Granted ${role}`);
            } catch (error) {
                console.log(`⚠️ Failed to grant ${role}: ${error.message}`);
            }
        }
    }

    // Automated Artifact Registry creation
    async createArtifactRegistry() {
        console.log('📦 Creating Artifact Registry via API...');
        
        try {
            const registryData = {
                repository: {
                    format: 'DOCKER',
                    description: 'Devyntra images'
                },
                repositoryId: this.repository
            };

            const endpoint = `/v1/projects/${this.projectId}/locations/${this.region}/repositories`;
            await this.makeGCPRequest(endpoint, 'POST', JSON.stringify(registryData));
            
            console.log('✅ Artifact Registry created');
            return true;
        } catch (error) {
            if (error.message.includes('already exists')) {
                console.log('✅ Artifact Registry already exists');
                return true;
            }
            throw error;
        }
    }

    // Automated GitHub secrets setup
    async setupGitHubSecrets(githubToken, repoOwner, repoName) {
        console.log('🔐 Setting up GitHub secrets via API...');
        
        try {
            // Get repository public key
            const publicKey = await this.makeGitHubRequest(
                `/repos/${repoOwner}/${repoName}/actions/secrets/public-key`,
                'GET',
                null,
                githubToken
            );

            // Read service account key
            const keyPath = path.join(process.cwd(), 'devyntra-deploy-key.json');
            const serviceAccountKey = fs.readFileSync(keyPath, 'utf8');

            // Encrypt the secret
            const crypto = require('crypto');
            const key = Buffer.from(publicKey.key, 'base64');
            const encryptedValue = crypto.publicEncrypt(
                {
                    key: key,
                    padding: crypto.constants.RSA_PKCS1_PADDING
                },
                Buffer.from(serviceAccountKey)
            ).toString('base64');

            // Create the secret
            const secretData = JSON.stringify({
                encrypted_value: encryptedValue,
                key_id: publicKey.key_id
            });

            await this.makeGitHubRequest(
                `/repos/${repoOwner}/${repoName}/actions/secrets/GCP_SA_KEY`,
                'PUT',
                secretData,
                githubToken
            );

            console.log('✅ GitHub secret GCP_SA_KEY created');
            return true;
        } catch (error) {
            throw new Error(`GitHub secrets setup failed: ${error.message}`);
        }
    }

    // Automated deployment trigger
    async triggerDeployment(githubToken, repoOwner, repoName) {
        console.log('🚀 Triggering automated deployment...');
        
        try {
            const workflowData = JSON.stringify({
                ref: 'main'
            });

            await this.makeGitHubRequest(
                `/repos/${repoOwner}/${repoName}/actions/workflows/automated-deployment.yml/dispatches`,
                'POST',
                workflowData,
                githubToken
            );

            console.log('✅ Deployment triggered successfully');
            return true;
        } catch (error) {
            throw new Error(`Deployment trigger failed: ${error.message}`);
        }
    }

    // Complete automation setup
    async fullAutomationSetup(githubToken, repoOwner, repoName) {
        try {
            console.log('🚀 Starting complete automation setup...\n');
            
            // Google Cloud setup
            await this.createServiceAccount();
            await this.bindIAMPolicy();
            await this.createArtifactRegistry();
            
            // Create service account key
            console.log('🔑 Creating service account key...');
            execSync(`gcloud iam service-accounts keys create devyntra-deploy-key.json --iam-account=devyntra-deploy@${this.projectId}.iam.gserviceaccount.com`);
            
            // GitHub setup
            await this.setupGitHubSecrets(githubToken, repoOwner, repoName);
            
            // Trigger deployment
            await this.triggerDeployment(githubToken, repoOwner, repoName);
            
            console.log('\n🎉 Complete automation setup finished!');
            console.log('🚀 Your application is being deployed automatically');
            
        } catch (error) {
            console.error('\n❌ Automation setup failed:', error.message);
            throw error;
        }
    }

    // Health check automation
    async checkDeploymentHealth() {
        console.log('🏥 Checking deployment health...');
        
        try {
            const serviceUrl = execSync(
                `gcloud run services describe ${this.serviceName} --region=${this.region} --format="value(status.url)"`,
                { encoding: 'utf8' }
            ).trim();

            const https = require('https');
            const url = new URL(serviceUrl);
            
            return new Promise((resolve, reject) => {
                const req = https.request({
                    hostname: url.hostname,
                    port: url.port || 443,
                    path: url.pathname,
                    method: 'GET',
                    timeout: 10000
                }, (res) => {
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        console.log('✅ Deployment is healthy');
                        resolve(true);
                    } else {
                        console.log(`⚠️ Deployment returned status: ${res.statusCode}`);
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
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.log('Usage: node api-automation.js <github_token> <repo_owner> <repo_name>');
        console.log('Example: node api-automation.js ghp_xxx your-username your-repo');
        process.exit(1);
    }

    const [githubToken, repoOwner, repoName] = args;
    
    try {
        const automation = new APIAutomation();
        await automation.fullAutomationSetup(githubToken, repoOwner, repoName);
        
        // Wait a bit for deployment to start
        console.log('⏳ Waiting for deployment to start...');
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        // Check health
        await automation.checkDeploymentHealth();
        
    } catch (error) {
        console.error('\n❌ Automation failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = APIAutomation;
