#!/usr/bin/env node

/**
 * Comprehensive System Health Check for Devyntra
 * Checks all components: Frontend, Backend, Firebase, Google Cloud, Cloud Run, Docker, GitHub
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

class SystemHealthCheck {
    constructor() {
        this.results = {
            frontend: { status: 'unknown', details: [] },
            backend: { status: 'unknown', details: [] },
            firebase: { status: 'unknown', details: [] },
            gcloud: { status: 'unknown', details: [] },
            cloudrun: { status: 'unknown', details: [] },
            docker: { status: 'unknown', details: [] },
            github: { status: 'unknown', details: [] },
            overall: { status: 'unknown', score: 0 }
        };
    }

    async checkFrontend() {
        console.log('🔍 Checking Frontend (React/Vite)...');
        
        try {
            // Check if package.json exists
            if (!fs.existsSync('Devyntra-google-hack/package.json')) {
                this.results.frontend.details.push('❌ package.json not found');
                this.results.frontend.status = 'error';
                return;
            }

            // Check dependencies
            const packageJson = JSON.parse(fs.readFileSync('Devyntra-google-hack/package.json', 'utf8'));
            const requiredDeps = ['react', 'react-dom', 'vite', 'firebase'];
            const missingDeps = requiredDeps.filter(dep => !packageJson.dependencies[dep] && !packageJson.devDependencies[dep]);
            
            if (missingDeps.length > 0) {
                this.results.frontend.details.push(`❌ Missing dependencies: ${missingDeps.join(', ')}`);
            } else {
                this.results.frontend.details.push('✅ All required dependencies present');
            }

            // Check if build works
            try {
                execSync('cd Devyntra-google-hack && npm run build', { stdio: 'pipe' });
                this.results.frontend.details.push('✅ Build successful');
            } catch (error) {
                this.results.frontend.details.push('❌ Build failed');
                this.results.frontend.status = 'error';
                return;
            }

            // Check if dist folder exists
            if (fs.existsSync('Devyntra-google-hack/dist')) {
                this.results.frontend.details.push('✅ Build output exists');
            } else {
                this.results.frontend.details.push('❌ Build output missing');
                this.results.frontend.status = 'error';
                return;
            }

            this.results.frontend.status = 'healthy';
            console.log('✅ Frontend check completed');

        } catch (error) {
            this.results.frontend.details.push(`❌ Frontend check failed: ${error.message}`);
            this.results.frontend.status = 'error';
        }
    }

    async checkBackend() {
        console.log('🔍 Checking Backend (Firebase Functions)...');
        
        try {
            // Check if functions directory exists
            if (!fs.existsSync('Devyntra-google-hack/functions')) {
                this.results.backend.details.push('❌ Functions directory not found');
                this.results.backend.status = 'error';
                return;
            }

            // Check functions package.json
            if (!fs.existsSync('Devyntra-google-hack/functions/package.json')) {
                this.results.backend.details.push('❌ Functions package.json not found');
                this.results.backend.status = 'error';
                return;
            }

            const functionsPackage = JSON.parse(fs.readFileSync('Devyntra-google-hack/functions/package.json', 'utf8'));
            const requiredDeps = ['firebase-functions', 'firebase-admin', 'express'];
            const missingDeps = requiredDeps.filter(dep => !functionsPackage.dependencies[dep]);
            
            if (missingDeps.length > 0) {
                this.results.backend.details.push(`❌ Missing dependencies: ${missingDeps.join(', ')}`);
            } else {
                this.results.backend.details.push('✅ All required dependencies present');
            }

            // Check if functions build works
            try {
                execSync('cd Devyntra-google-hack/functions && npm run build', { stdio: 'pipe' });
                this.results.backend.details.push('✅ Functions build successful');
            } catch (error) {
                this.results.backend.details.push('❌ Functions build failed');
                this.results.backend.status = 'error';
                return;
            }

            this.results.backend.status = 'healthy';
            console.log('✅ Backend check completed');

        } catch (error) {
            this.results.backend.details.push(`❌ Backend check failed: ${error.message}`);
            this.results.backend.status = 'error';
        }
    }

    async checkFirebase() {
        console.log('🔍 Checking Firebase configuration...');
        
        try {
            // Check firebase.json
            if (!fs.existsSync('Devyntra-google-hack/firebase.json')) {
                this.results.firebase.details.push('❌ firebase.json not found');
                this.results.firebase.status = 'error';
                return;
            }

            const firebaseConfig = JSON.parse(fs.readFileSync('Devyntra-google-hack/firebase.json', 'utf8'));
            
            // Check required configurations
            if (!firebaseConfig.hosting) {
                this.results.firebase.details.push('❌ Hosting configuration missing');
            } else {
                this.results.firebase.details.push('✅ Hosting configuration present');
            }

            if (!firebaseConfig.functions) {
                this.results.firebase.details.push('❌ Functions configuration missing');
            } else {
                this.results.firebase.details.push('✅ Functions configuration present');
            }

            // Check .firebaserc
            if (!fs.existsSync('Devyntra-google-hack/.firebaserc')) {
                this.results.firebase.details.push('❌ .firebaserc not found');
            } else {
                this.results.firebase.details.push('✅ Firebase project configuration present');
            }

            this.results.firebase.status = 'healthy';
            console.log('✅ Firebase check completed');

        } catch (error) {
            this.results.firebase.details.push(`❌ Firebase check failed: ${error.message}`);
            this.results.firebase.status = 'error';
        }
    }

    async checkGoogleCloud() {
        console.log('🔍 Checking Google Cloud setup...');
        
        try {
            // Check if gcloud is installed
            try {
                execSync('gcloud --version', { stdio: 'pipe' });
                this.results.gcloud.details.push('✅ Google Cloud SDK installed');
            } catch (error) {
                this.results.gcloud.details.push('❌ Google Cloud SDK not found');
                this.results.gcloud.status = 'error';
                return;
            }

            // Check authentication
            try {
                const authList = execSync('gcloud auth list --filter=status:ACTIVE --format="value(account)"', { encoding: 'utf8' });
                if (authList.trim()) {
                    this.results.gcloud.details.push('✅ Google Cloud authenticated');
                } else {
                    this.results.gcloud.details.push('❌ No active authentication');
                    this.results.gcloud.status = 'error';
                    return;
                }
            } catch (error) {
                this.results.gcloud.details.push('❌ Authentication check failed');
                this.results.gcloud.status = 'error';
                return;
            }

            // Check project
            try {
                const project = execSync('gcloud config get-value project', { encoding: 'utf8' });
                if (project.trim()) {
                    this.results.gcloud.details.push(`✅ Project set: ${project.trim()}`);
                } else {
                    this.results.gcloud.details.push('❌ No project configured');
                    this.results.gcloud.status = 'error';
                    return;
                }
            } catch (error) {
                this.results.gcloud.details.push('❌ Project configuration check failed');
                this.results.gcloud.status = 'error';
                return;
            }

            this.results.gcloud.status = 'healthy';
            console.log('✅ Google Cloud check completed');

        } catch (error) {
            this.results.gcloud.details.push(`❌ Google Cloud check failed: ${error.message}`);
            this.results.gcloud.status = 'error';
        }
    }

    async checkCloudRun() {
        console.log('🔍 Checking Cloud Run deployment...');
        
        try {
            // Check if service exists
            try {
                execSync('gcloud run services describe devyntra-web --region=us-central1 --quiet', { stdio: 'pipe' });
                this.results.cloudrun.details.push('✅ Cloud Run service exists');
            } catch (error) {
                this.results.cloudrun.details.push('❌ Cloud Run service not found');
                this.results.cloudrun.status = 'error';
                return;
            }

            // Get service URL and check health
            try {
                const serviceUrl = execSync('gcloud run services describe devyntra-web --region=us-central1 --format="value(status.url)"', { encoding: 'utf8' }).trim();
                if (serviceUrl) {
                    this.results.cloudrun.details.push(`✅ Service URL: ${serviceUrl}`);
                    
                    // Check if service is healthy
                    try {
                        const response = await this.makeHttpRequest(serviceUrl);
                        if (response.statusCode >= 200 && response.statusCode < 300) {
                            this.results.cloudrun.details.push('✅ Service is healthy');
                        } else {
                            this.results.cloudrun.details.push(`⚠️ Service returned status: ${response.statusCode}`);
                        }
                    } catch (error) {
                        this.results.cloudrun.details.push('❌ Service health check failed');
                    }
                } else {
                    this.results.cloudrun.details.push('❌ Could not get service URL');
                    this.results.cloudrun.status = 'error';
                    return;
                }
            } catch (error) {
                this.results.cloudrun.details.push('❌ Service URL check failed');
                this.results.cloudrun.status = 'error';
                return;
            }

            this.results.cloudrun.status = 'healthy';
            console.log('✅ Cloud Run check completed');

        } catch (error) {
            this.results.cloudrun.details.push(`❌ Cloud Run check failed: ${error.message}`);
            this.results.cloudrun.status = 'error';
        }
    }

    async checkDocker() {
        console.log('🔍 Checking Docker setup...');
        
        try {
            // Check if Docker is installed
            try {
                execSync('docker --version', { stdio: 'pipe' });
                this.results.docker.details.push('✅ Docker installed');
            } catch (error) {
                this.results.docker.details.push('❌ Docker not found');
                this.results.docker.status = 'error';
                return;
            }

            // Check if Docker is running
            try {
                execSync('docker info', { stdio: 'pipe' });
                this.results.docker.details.push('✅ Docker daemon running');
            } catch (error) {
                this.results.docker.details.push('❌ Docker daemon not running');
                this.results.docker.status = 'error';
                return;
            }

            // Check if Dockerfile exists
            if (fs.existsSync('Dockerfile')) {
                this.results.docker.details.push('✅ Dockerfile present');
            } else {
                this.results.docker.details.push('❌ Dockerfile not found');
                this.results.docker.status = 'error';
                return;
            }

            this.results.docker.status = 'healthy';
            console.log('✅ Docker check completed');

        } catch (error) {
            this.results.docker.details.push(`❌ Docker check failed: ${error.message}`);
            this.results.docker.status = 'error';
        }
    }

    async checkGitHub() {
        console.log('🔍 Checking GitHub setup...');
        
        try {
            // Check if .github directory exists
            if (!fs.existsSync('.github')) {
                this.results.github.details.push('❌ .github directory not found');
                this.results.github.status = 'error';
                return;
            }

            // Check workflows
            const workflowsDir = '.github/workflows';
            if (fs.existsSync(workflowsDir)) {
                const workflows = fs.readdirSync(workflowsDir).filter(file => file.endsWith('.yml') || file.endsWith('.yaml'));
                if (workflows.length > 0) {
                    this.results.github.details.push(`✅ ${workflows.length} workflow(s) found`);
                } else {
                    this.results.github.details.push('❌ No workflows found');
                    this.results.github.status = 'error';
                    return;
                }
            } else {
                this.results.github.details.push('❌ Workflows directory not found');
                this.results.github.status = 'error';
                return;
            }

            // Check if git is initialized
            try {
                execSync('git status', { stdio: 'pipe' });
                this.results.github.details.push('✅ Git repository initialized');
            } catch (error) {
                this.results.github.details.push('❌ Git repository not initialized');
                this.results.github.status = 'error';
                return;
            }

            this.results.github.status = 'healthy';
            console.log('✅ GitHub check completed');

        } catch (error) {
            this.results.github.details.push(`❌ GitHub check failed: ${error.message}`);
            this.results.github.status = 'error';
        }
    }

    async makeHttpRequest(url) {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port || 443,
                path: urlObj.pathname,
                method: 'GET',
                timeout: 10000
            };

            const req = https.request(options, (res) => {
                resolve({ statusCode: res.statusCode });
            });

            req.on('error', (error) => reject(error));
            req.on('timeout', () => reject(new Error('Request timeout')));
            req.end();
        });
    }

    calculateOverallScore() {
        const components = ['frontend', 'backend', 'firebase', 'gcloud', 'cloudrun', 'docker', 'github'];
        const healthyCount = components.filter(comp => this.results[comp].status === 'healthy').length;
        const totalCount = components.length;
        
        this.results.overall.score = Math.round((healthyCount / totalCount) * 100);
        
        if (this.results.overall.score >= 90) {
            this.results.overall.status = 'excellent';
        } else if (this.results.overall.score >= 70) {
            this.results.overall.status = 'good';
        } else if (this.results.overall.score >= 50) {
            this.results.overall.status = 'fair';
        } else {
            this.results.overall.status = 'poor';
        }
    }

    generateReport() {
        console.log('\n📊 SYSTEM HEALTH REPORT');
        console.log('========================\n');

        const components = [
            { name: 'Frontend (React/Vite)', key: 'frontend' },
            { name: 'Backend (Firebase Functions)', key: 'backend' },
            { name: 'Firebase Configuration', key: 'firebase' },
            { name: 'Google Cloud Setup', key: 'gcloud' },
            { name: 'Cloud Run Deployment', key: 'cloudrun' },
            { name: 'Docker Configuration', key: 'docker' },
            { name: 'GitHub Workflows', key: 'github' }
        ];

        components.forEach(comp => {
            const result = this.results[comp.key];
            const status = result.status === 'healthy' ? '✅' : '❌';
            console.log(`${status} ${comp.name}: ${result.status.toUpperCase()}`);
            result.details.forEach(detail => console.log(`   ${detail}`));
            console.log('');
        });

        console.log(`🎯 OVERALL SCORE: ${this.results.overall.score}% (${this.results.overall.status.toUpperCase()})`);
        
        if (this.results.overall.score < 100) {
            console.log('\n🔧 RECOMMENDATIONS:');
            components.forEach(comp => {
                if (this.results[comp.key].status !== 'healthy') {
                    console.log(`   • Fix ${comp.name} issues`);
                }
            });
        } else {
            console.log('\n🎉 All systems are healthy! Your Devyntra application is ready for production.');
        }
    }

    async run() {
        try {
            console.log('🚀 Starting comprehensive system health check...\n');
            
            await this.checkFrontend();
            await this.checkBackend();
            await this.checkFirebase();
            await this.checkGoogleCloud();
            await this.checkCloudRun();
            await this.checkDocker();
            await this.checkGitHub();
            
            this.calculateOverallScore();
            this.generateReport();
            
            // Save report to file
            const reportPath = 'system-health-report.json';
            fs.writeFileSync(reportPath, JSON.stringify(this.results, null, 2));
            console.log(`\n📄 Detailed report saved to: ${reportPath}`);
            
        } catch (error) {
            console.error('\n❌ Health check failed:', error.message);
            process.exit(1);
        }
    }
}

// Auto-run if this script is executed directly
if (require.main === module) {
    const healthCheck = new SystemHealthCheck();
    healthCheck.run();
}

module.exports = SystemHealthCheck;
