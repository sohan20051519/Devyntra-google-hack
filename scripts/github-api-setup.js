#!/usr/bin/env node

/**
 * GitHub API Integration for Automated Secret Management
 * This script automates GitHub secrets creation using the GitHub API
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

class GitHubAPISetup {
    constructor(token, owner, repo) {
        this.token = token;
        this.owner = owner;
        this.repo = repo;
        this.baseURL = 'https://api.github.com';
    }

    async makeRequest(endpoint, method = 'GET', data = null) {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.github.com',
                port: 443,
                path: endpoint,
                method: method,
                headers: {
                    'Authorization': `token ${this.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Devyntra-Automation/1.0'
                }
            };

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

    async getPublicKey() {
        console.log('🔑 Getting repository public key...');
        try {
            const response = await this.makeRequest(`/repos/${this.owner}/${this.repo}/actions/secrets/public-key`);
            return response;
        } catch (error) {
            console.error('❌ Failed to get public key:', error.message);
            throw error;
        }
    }

    async encryptSecret(secret, publicKey) {
        const crypto = require('crypto');
        const key = Buffer.from(publicKey.key, 'base64');
        const encrypted = crypto.publicEncrypt(
            {
                key: key,
                padding: crypto.constants.RSA_PKCS1_PADDING
            },
            Buffer.from(secret)
        );
        return encrypted.toString('base64');
    }

    async createSecret(secretName, secretValue) {
        console.log(`🔐 Creating secret: ${secretName}...`);
        
        try {
            // Get public key
            const publicKey = await this.getPublicKey();
            
            // Encrypt the secret
            const encryptedValue = await this.encryptSecret(secretValue, publicKey);
            
            // Create the secret
            const data = JSON.stringify({
                encrypted_value: encryptedValue,
                key_id: publicKey.key_id
            });

            await this.makeRequest(
                `/repos/${this.owner}/${this.repo}/actions/secrets/${secretName}`,
                'PUT',
                data
            );

            console.log(`✅ Secret ${secretName} created successfully`);
            return true;
        } catch (error) {
            console.error(`❌ Failed to create secret ${secretName}:`, error.message);
            throw error;
        }
    }

    async setupDevyntraSecrets() {
        console.log('🚀 Setting up Devyntra secrets...');
        
        try {
            // Read service account key
            const keyPath = path.join(process.cwd(), 'devyntra-deploy-key.json');
            if (!fs.existsSync(keyPath)) {
                throw new Error('Service account key file not found. Please run setup first.');
            }

            const serviceAccountKey = fs.readFileSync(keyPath, 'utf8');
            
            // Create GCP_SA_KEY secret
            await this.createSecret('GCP_SA_KEY', serviceAccountKey);
            
            // Create other useful secrets
            await this.createSecret('GCP_PROJECT_ID', 'devyntra-500e4');
            await this.createSecret('GCP_REGION', 'us-central1');
            await this.createSecret('ARTIFACT_REGISTRY', 'devyntra-images');
            
            console.log('✅ All Devyntra secrets created successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to setup secrets:', error.message);
            throw error;
        }
    }

    async verifySecrets() {
        console.log('🔍 Verifying secrets...');
        
        try {
            const secrets = await this.makeRequest(`/repos/${this.owner}/${this.repo}/actions/secrets`);
            const secretNames = secrets.secrets.map(secret => secret.name);
            
            const requiredSecrets = ['GCP_SA_KEY', 'GCP_PROJECT_ID', 'GCP_REGION', 'ARTIFACT_REGISTRY'];
            const missingSecrets = requiredSecrets.filter(secret => !secretNames.includes(secret));
            
            if (missingSecrets.length === 0) {
                console.log('✅ All required secrets are present');
                return true;
            } else {
                console.log('⚠️ Missing secrets:', missingSecrets.join(', '));
                return false;
            }
        } catch (error) {
            console.error('❌ Failed to verify secrets:', error.message);
            return false;
        }
    }
}

// CLI interface
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 3) {
        console.log('Usage: node github-api-setup.js <github_token> <repo_owner> <repo_name>');
        console.log('Example: node github-api-setup.js ghp_xxx your-username your-repo');
        process.exit(1);
    }

    const [token, owner, repo] = args;
    
    try {
        const setup = new GitHubAPISetup(token, owner, repo);
        await setup.setupDevyntraSecrets();
        await setup.verifySecrets();
        
        console.log('\n🎉 GitHub secrets setup completed successfully!');
        console.log('🚀 Your repository is now ready for automated deployment');
    } catch (error) {
        console.error('\n❌ Setup failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = GitHubAPISetup;
