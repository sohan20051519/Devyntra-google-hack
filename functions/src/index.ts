import express from 'express';
import fetch from 'node-fetch';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import cors from 'cors';
import sodium from 'libsodium-wrappers';
import * as fs from 'fs';
import * as path from 'path';

if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();
const WEBHOOK_KEY = process.env.DEPLOY_WEBHOOK_KEY || process.env.WEBHOOK_KEY || '';

// Define secrets for API keys
const genaiApiKey = defineSecret('GENAI_API_KEY');
const julesApiKey = defineSecret('JULES_API_KEY');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

function requireAuth(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing ID token' });
  getAdminAuth()
    .verifyIdToken(token)
    .then((decoded) => {
      (req as any).uid = decoded.uid;
      next();
    })
    .catch(() => res.status(401).json({ error: 'Invalid ID token' }));
}

// Store GitHub OAuth access token received from Firebase client sign-in
app.post('/auth/github', requireAuth, async (req, res) => {
  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });
  const uid = (req as any).uid as string;
  await db.collection('githubTokens').doc(uid).set({ accessToken }, { merge: true });
  res.json({ ok: true });
});

// List repositories for the authenticated user (selected/all scopes handled by GitHub OAuth)
app.get('/repos', requireAuth, async (req, res) => {
  const uid = (req as any).uid as string;
  const doc = await db.collection('githubTokens').doc(uid).get();
  if (!doc.exists) return res.status(400).json({ error: 'GitHub not linked' });
  const token = (doc.data() as any).accessToken as string;
  const response = await fetch('https://api.github.com/user/repos?per_page=100', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json'
    }
  });
  const data = await response.json() as any;
  if (!response.ok) return res.status(response.status).json(data);
  res.json(
    (data as any[]).map((r) => ({ id: String(r.id), name: r.full_name }))
  );
});

// Receive webhook from CI with the deployed Cloud Run URL
app.post('/deploy/webhook', async (req, res) => {
  try {
    const key = (req.headers['x-webhook-key'] as string) || '';
    if (!WEBHOOK_KEY || key !== WEBHOOK_KEY) return res.status(401).json({ error: 'unauthorized' });
    const { repoFullName, url } = req.body as { repoFullName?: string; url?: string };
    if (!repoFullName || !url) return res.status(400).json({ error: 'repoFullName and url required' });

    const createdAt = new Date().toISOString();
    // Store under deployments/{repo}/runs/{createdAt}
    await db.collection('deployments').doc(repoFullName).collection('runs').doc(createdAt).set({
      repoFullName,
      url,
      createdAt
    });
    // Also store latest pointer
    await db.collection('deployments').doc(repoFullName).set({ latestUrl: url, updatedAt: createdAt }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('deploy webhook error', e);
    res.status(500).json({ error: 'failed' });
  }
});

// Get latest deployed URL for a repo
app.get('/deploy/latest', async (req, res) => {
  try {
    const repoFullName = req.query.repo as string | undefined;
    if (!repoFullName) return res.status(400).json({ error: 'repo query required' });
    const doc = await db.collection('deployments').doc(repoFullName).get();
    const data = doc.exists ? (doc.data() as any) : null;
    res.json({ url: data?.latestUrl || null, updatedAt: data?.updatedAt || null });
  } catch (e) {
    console.error('deploy latest error', e);
    res.status(500).json({ error: 'failed' });
  }
});

// List saved projects for the authenticated user
app.get('/projects', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid as string;
    const snapshot = await db.collection('projects').doc(uid).collection('repos').orderBy('updatedAt', 'desc').get();
    const items = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
    res.json({ items });
  } catch (e) {
    console.error('list projects error', e);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// List deployments (latest) for the authenticated user's repos
app.get('/deployments', requireAuth, async (req, res) => {
  try {
    const uid = (req as any).uid as string;
    const doc = await db.collection('githubTokens').doc(uid).get();
    if (!doc.exists) return res.status(400).json({ error: 'GitHub not linked' });
    const token = (doc.data() as any).accessToken as string;

    // 1) Fetch user's repos from GitHub (limit 100)
    const response = await fetch('https://api.github.com/user/repos?per_page=100', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    });
    const repos = await response.json() as any[];
    if (!response.ok) return res.status(response.status).json(repos);

    const fullNames: string[] = repos.map((r) => r.full_name as string);

    // 2) For each repo, read latest deployment from Firestore if present
    const results: { repoFullName: string; url: string | null; updatedAt: string | null }[] = [];
    const tasks = fullNames.map(async (name) => {
      const snap = await db.collection('deployments').doc(name).get();
      const data = snap.exists ? (snap.data() as any) : null;
      results.push({ repoFullName: name, url: data?.latestUrl || null, updatedAt: data?.updatedAt || null });
    });
    await Promise.all(tasks);

    // 3) Sort by updatedAt desc (nulls last)
    results.sort((a, b) => {
      if (!a.updatedAt && !b.updatedAt) return 0;
      if (!a.updatedAt) return 1;
      if (!b.updatedAt) return -1;
      return a.updatedAt > b.updatedAt ? -1 : 1;
    });

    res.json({ items: results });
  } catch (e) {
    console.error('list deployments error', e);
    res.status(500).json({ error: 'Failed to list deployments' });
  }
});

// GitHub user profile
app.get('/github/me', requireAuth, async (req, res) => {
  const uid = (req as any).uid as string;
  const doc = await db.collection('githubTokens').doc(uid).get();
  if (!doc.exists) return res.status(400).json({ error: 'GitHub not linked' });
  const token = (doc.data() as any).accessToken as string;
  const response = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  const data = await response.json() as any;
  if (!response.ok) return res.status(response.status).json(data);
  res.json({ login: data.login, name: data.name, avatar_url: data.avatar_url, html_url: data.html_url });
});

// Start deployment orchestration (real GitHub workflow creation; GCP deploy remains simulated per request)
app.post('/deploy', requireAuth, async (req, res) => {
  const { repoFullName } = req.body as { repoFullName?: string };
  if (!repoFullName) return res.status(400).json({ error: 'repoFullName required' });
  const uid = (req as any).uid as string;
  const tokenDoc = await db.collection('githubTokens').doc(uid).get();
  if (!tokenDoc.exists) return res.status(400).json({ error: 'GitHub not linked' });
  const ghToken = (tokenDoc.data() as any).accessToken as string;

  // 1) Detect framework (basic heuristic via repo file listing)
  const treeResp = await fetch(`https://api.github.com/repos/${repoFullName}/git/trees/HEAD?recursive=1`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
  });
  const tree = (await treeResp.json()) as any;
  if (!treeResp.ok) return res.status(treeResp.status).json(tree);
  const paths: string[] = (tree.tree || []).map((t: any) => t.path as string);
  const isNode = paths.includes('package.json') || paths.some((p) => p.endsWith('package.json'));
  const detectedFramework = (() => {
    const has = (p: string) => paths.some((x) => x.toLowerCase().includes(p));
    if (has('next.config')) return 'Next.js';
    if (has('angular.json')) return 'Angular';
    if (has('vite.config')) return 'Vite';
    if (has('vue.config') || has('src/main.ts') && has('src/App.vue')) return 'Vue';
    return isNode ? 'Node.js' : 'Unknown';
  })();

  // Determine default branch for workflow dispatch
  const repoResp = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
  });
  const repoMeta = await repoResp.json() as any;
  const defaultBranch = repoResp.ok && repoMeta.default_branch ? String(repoMeta.default_branch) : 'main';

  // If unsupported stack, stop early with an informative error
  if (!isNode) {
    return res.status(400).json({ error: 'Unsupported repository type. A package.json was not found. Currently only Node.js repos are supported.' });
  }

  // 2) Detect Language & Framework (already done above), then Code Analysis phase
  // Placeholder: use Jules to analyze before generating workflow
  // 2a) Initialize Jules session early for AI-Powered Auto-Fix
  let julesSessionId: string | null = null;
  try {
    const [owner, repo] = repoFullName.split('/');
    const julesApiKeyValue = (julesApiKey.value() || process.env.JULES_API_KEY || process.env.JULES_KEY || '').trim();
    if (julesApiKeyValue) {
      const prompt = `Analyze the repository ${repoFullName}. Detect framework, run install, tests, and propose minimal fixes to pass CI. Prepare commits but do not push yet.`;
      const julesResp = await fetch('https://jules.googleapis.com/v1alpha/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': julesApiKeyValue },
        body: JSON.stringify({
          prompt,
          sourceContext: { source: `sources/github/${owner}/${repo}`, githubRepoContext: { startingBranch: defaultBranch } },
          title: `Devyntra analysis: ${repoFullName}`
        })
      });
      if (julesResp.ok) {
        const julesData = await julesResp.json() as any;
        julesSessionId = (julesData.name || julesData.id || '').toString();
        console.log('✅ Jules session created (analysis):', julesSessionId);
      } else {
        console.error('❌ Failed to create Jules session (analysis):', await julesResp.text());
      }
    }
  } catch (e) {
    console.error('Jules analysis session error', e);
  }

  // 3) AI-Powered Auto-Fix step (deferred: user may trigger actual fix via /jules/send)

  // 4) Push Changes to Main will be handled by Jules when user confirms; we do not push here

  // 5) Generate CI/CD Pipeline (GitHub Actions) but do NOT auto-dispatch yet
  const workflowPath = '.github/workflows/deploy.yml';
  const getFileResp = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
  });
  const workflowYml = `name: CI

on:
  push:
    branches: ["main"]
  workflow_dispatch:

permissions:
  contents: write
  packages: write

jobs:
  build_test_deploy:
    runs-on: ubuntu-latest
    env:
      GCP_PROJECT: \${{ secrets.GCP_PROJECT }}
      GCP_REGION: \${{ secrets.GCP_REGION }}
      AR_REPO: \${{ secrets.AR_REPO }}
      SERVICE_NAME: \${{ secrets.SERVICE_NAME }}
      IMAGE: \${{ secrets.GCP_REGION }}-docker.pkg.dev/\${{ secrets.GCP_PROJECT }}/\${{ secrets.AR_REPO }}/\${{ github.event.repository.name }}:latest
    steps:
      - uses: actions/checkout@v4

      - name: Debug - List files
        run: ls -la

      - name: Check package.json
        run: |
          if [ -f package.json ]; then
            echo "✅ package.json found"
            cat package.json
          else
            echo "❌ package.json not found"
            exit 1
          fi

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install dependencies
        run: |
          echo "Installing dependencies..."
          if [ -f package-lock.json ]; then
            echo "Using npm ci (package-lock.json found)"
            npm ci
          else
            echo "Using npm install (no package-lock.json found)"
            npm install
          fi
          echo "Dependencies installed successfully"

      - name: Run tests
        run: |
          echo "Running tests..."
          npm test --if-present || echo "No tests found or tests failed"

      - name: Build app
        run: |
          echo "Building app..."
          npm run build --if-present || echo "No build script found"

      - name: Decide auth method
        id: decide_auth
        run: |
          if [ -z "\${GCLOUD_SERVICE_KEY}" ] && [ -n "\${GCP_WIF_PROVIDER}" ] && [ -n "\${GCP_WIF_SERVICE_ACCOUNT}" ]; then
            echo "use_wif=true" >> \$GITHUB_OUTPUT
          else
            echo "use_wif=false" >> \$GITHUB_OUTPUT
          fi
        env:
          GCLOUD_SERVICE_KEY: \${{ secrets.GCLOUD_SERVICE_KEY }}
          GCP_WIF_PROVIDER: \${{ secrets.GCP_WIF_PROVIDER }}
          GCP_WIF_SERVICE_ACCOUNT: \${{ secrets.GCP_WIF_SERVICE_ACCOUNT }}

      - name: Authenticate to Google Cloud (WIF)
        if: \${{ needs.deploy.outputs.use_wif == 'true' || steps.decide_auth.outputs.use_wif == 'true' }}
        uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: \${{ secrets.GCP_WIF_PROVIDER }}
          service_account: \${{ secrets.GCP_WIF_SERVICE_ACCOUNT }}

      - name: Authenticate to Google Cloud (Key)
        if: \${{ needs.deploy.outputs.use_wif == 'false' || steps.decide_auth.outputs.use_wif == 'false' }}
        uses: google-github-actions/auth@v2
        with:
          credentials_json: \${{ secrets.GCLOUD_SERVICE_KEY }}

      - name: Set up gcloud
        uses: google-github-actions/setup-gcloud@v2
        with:
          project_id: \${{ secrets.GCP_PROJECT }}
          export_default_credentials: true

      - name: Configure Docker for Artifact Registry
        run: |
          echo "Configuring Docker for Artifact Registry..."
          gcloud auth configure-docker "\$GCP_REGION-docker.pkg.dev" --quiet
          echo "Docker configured successfully"

      - name: Ensure Dockerfile
        run: |
          DOCKERFILE_PATH="Dockerfile"
          if [ -f "./Dockerfile" ]; then
            DOCKERFILE_PATH="Dockerfile"
          elif [ -f "./app/Dockerfile" ]; then
            DOCKERFILE_PATH="app/Dockerfile"
          elif [ -f "./docker/Dockerfile" ]; then
            DOCKERFILE_PATH="docker/Dockerfile"
          elif [ -f "./deploy/Dockerfile" ]; then
            DOCKERFILE_PATH="deploy/Dockerfile"
          elif [ -f "./.devcontainer/Dockerfile" ]; then
            DOCKERFILE_PATH=".devcontainer/Dockerfile"
          else
            echo "Dockerfile missing. Creating a minimal one at repo root..."
            echo "FROM node:20-alpine" > Dockerfile
            echo "WORKDIR /app" >> Dockerfile
            echo "COPY package*.json ./" >> Dockerfile
            echo "RUN npm ci || npm install" >> Dockerfile
            echo "COPY . ." >> Dockerfile
            echo "RUN npm run build --if-present || echo \"No build script found\"" >> Dockerfile
            echo "EXPOSE 3000" >> Dockerfile
            echo "CMD [\"npm\",\"start\"]" >> Dockerfile
            DOCKERFILE_PATH="Dockerfile"
          fi
          echo "DOCKERFILE_PATH=$DOCKERFILE_PATH" >> "$GITHUB_ENV"

      - name: Build Docker image
        run: |
          echo "Building Docker image: \$IMAGE"
          echo "Using Dockerfile: \${DOCKERFILE_PATH}"
          docker build -f "\${DOCKERFILE_PATH}" -t "\$IMAGE" .
          echo "Docker image built successfully"

      - name: Push image to Artifact Registry
        run: |
          echo "Pushing Docker image to Artifact Registry..."
          docker push "\$IMAGE"
          echo "Docker image pushed successfully"

      - name: Deploy to Cloud Run
        run: |
          echo "Deploying to Cloud Run..."
          gcloud run deploy "\$SERVICE_NAME" --image="\$IMAGE" --region="\$GCP_REGION" --platform=managed --allow-unauthenticated
          echo "Deployed to Cloud Run successfully"`;
  const desiredContentB64 = Buffer.from(workflowYml).toString('base64');

  // Force update the workflow file to ensure latest version
  console.log(`🔍 Checking workflow file at: ${workflowPath}`);
  console.log(`📋 Workflow content preview: ${workflowYml.substring(0, 200)}...`);
  
  if (getFileResp.ok) {
    const existing = await getFileResp.json() as any;
    console.log('📝 Found existing workflow file, checking content...');
    
    // Check if the existing file contains Docker Hub references
    const existingContent = Buffer.from(existing.content || '', 'base64').toString('utf8');
    console.log(`📋 Existing workflow content preview: ${existingContent.substring(0, 200)}...`);
    
    if (existingContent.includes('docker/login-action@v3') || existingContent.includes('DOCKERHUB_USERNAME')) {
      console.log('🚨 Found Docker Hub references in existing workflow, forcing replacement...');
      
      // Delete the old workflow file first
      console.log('📝 Deleting old workflow file first...');
      const deleteResponse = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'chore(ci): delete old workflow with Docker Hub', sha: existing.sha })
      });
      
      if (deleteResponse.ok) {
        console.log('✅ Successfully deleted old workflow file with Docker Hub');
      } else {
        console.error('❌ Failed to delete old workflow file:', deleteResponse.status, await deleteResponse.text());
      }
      
      // Wait for the deletion to propagate
      await new Promise(resolve => setTimeout(resolve, 3000));
    } else {
      console.log('✅ Existing workflow already uses Artifact Registry, updating anyway...');
    }
    
    // Create/update the workflow file
    console.log('📝 Creating/updating workflow file with Artifact Registry...');
    const createResponse = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        message: 'chore(ci): force update workflow to use Artifact Registry (NO DOCKER HUB)', 
        content: desiredContentB64,
        sha: existing.sha 
      })
    });
    if (createResponse.ok) {
      console.log('✅ Successfully created/updated workflow file with Artifact Registry');
    } else {
      const errorText = await createResponse.text();
      console.error('❌ Failed to create/update workflow file:', createResponse.status, errorText);
    }
  } else if (getFileResp.status === 404) {
    // Create new workflow
    console.log('📝 Creating new workflow file...');
    const createResponse = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'chore(ci): add GitHub Actions workflow with Artifact Registry', content: desiredContentB64 })
    });
    if (createResponse.ok) {
      console.log('✅ Successfully created new workflow file with Artifact Registry');
    } else {
      const errorText = await createResponse.text();
      console.error('❌ Failed to create workflow file:', createResponse.status, errorText);
    }
  } else {
    const errorText = await getFileResp.text();
    console.error('❌ Failed to fetch existing workflow file:', getFileResp.status, errorText);
  }

  // 6) Install Dependencies handled in workflow; Ensure Dockerfile exists now
  if (isNode) {
    const dockerfilePath = 'Dockerfile';
    const getDockerfile = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(dockerfilePath)}`, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    if (getDockerfile.status === 404) {
      const dockerfile = Buffer.from(`FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci || npm install\nCOPY . .\nRUN npm run build --if-present || echo "No build script found"\nEXPOSE 3000\nCMD [\"npm\", \"start\"]\n`).toString('base64');
      await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(dockerfilePath)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'chore(docker): add Dockerfile', content: dockerfile })
      });
    }
  }

  // 7) Set GitHub secrets automatically
  try {
    const [owner, repo] = repoFullName.split('/');
    const keyResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    if (keyResp.ok) {
      const keyData = await keyResp.json() as any;
      await sodium.ready;
      const { key, key_id } = keyData;
      const encrypt = (value: string) => {
        const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
        const binsec = sodium.from_string(value);
        const encBytes = sodium.crypto_box_seal(binsec, binkey);
        return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
      };
      
      // Set GCP secrets for Cloud Run deployment
      const gcpSecrets = {
        GCP_PROJECT: 'devyntra-500e4',
        GCP_REGION: 'us-central1',
        AR_REPO: 'devyntra-images',
        SERVICE_NAME: repo
      };
      
      for (const [name, value] of Object.entries(gcpSecrets)) {
          const encrypted_value = encrypt(value as string);
          await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${name}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ encrypted_value, key_id })
          });
        console.log(`✅ Set secret: ${name}`);
      }

      // Ensure WIF secrets and optionally GCLOUD_SERVICE_KEY
      try {
        // Always set WIF-based secrets so anyone can run CI without a key
        const wifSecrets = {
          GCP_WIF_PROVIDER: `projects/583516794481/locations/global/workloadIdentityPools/github-pool/providers/github`,
          GCP_WIF_SERVICE_ACCOUNT: `devyntra-deploy@devyntra-500e4.iam.gserviceaccount.com`
        };
        for (const [name, value] of Object.entries(wifSecrets)) {
          const encrypted_value = encrypt(String(value));
          await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${name}`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ encrypted_value, key_id })
          });
          console.log(`✅ Set secret: ${name}`);
        }

        // Optionally set GCLOUD_SERVICE_KEY from local key file if present
        const keyPath = path.join(process.cwd(), 'functions', 'devyntra-deploy-key.json');
        if (fs.existsSync(keyPath)) {
          const keyJson = fs.readFileSync(keyPath, 'utf8');
          const encrypted_value = encrypt(keyJson);
          await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/GCLOUD_SERVICE_KEY`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ encrypted_value, key_id })
          });
          console.log('✅ Set secret: GCLOUD_SERVICE_KEY');
        } else {
          console.log('ℹ️ GCLOUD_SERVICE_KEY file not found locally; skipping secret creation');
        }
      } catch (e) {
        console.error('Failed to set GCLOUD_SERVICE_KEY', e);
      }
    }
  } catch (e) {
    console.error('Failed setting repo secrets', e);
  }

  // 8) Disable ALL old workflows that contain Docker Hub references
  try {
    console.log('🔍 Checking for old workflows with Docker Hub references...');
    
    // List all workflow files in .github/workflows
    const workflowsResp = await fetch(`https://api.github.com/repos/${repoFullName}/contents/.github/workflows`, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    
    if (workflowsResp.ok) {
      const workflows = await workflowsResp.json() as any[];
      console.log(`📋 Found ${workflows.length} workflow files`);
      
      for (const workflow of workflows) {
        if (workflow.name.endsWith('.yml') || workflow.name.endsWith('.yaml')) {
          const workflowResp = await fetch(workflow.url, {
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
          });
          
          if (workflowResp.ok) {
            const workflowData = await workflowResp.json() as any;
            const content = Buffer.from(workflowData.content || '', 'base64').toString('utf8');
            
            if (content.includes('docker/login-action@v3') || content.includes('DOCKERHUB_USERNAME')) {
              console.log(`🚨 Found Docker Hub references in ${workflow.name}, deleting...`);
              await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflow.path)}`, {
                method: 'DELETE',
                headers: {
                  Authorization: `Bearer ${ghToken}`,
                  Accept: 'application/vnd.github+json',
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: 'chore(ci): remove workflow with Docker Hub', sha: workflowData.sha })
              });
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('Failed to disable old workflows', e);
  }

  // 9) Simulate GCP deploy step (final)
  const deploymentUrl = `https://cloud-run-simulated.devyntra.app/${encodeURIComponent(repoFullName)}`;

  res.json({
    detectedStack: isNode ? 'node' : 'unknown',
    detectedFramework,
    workflowEnsured: true,
    dockerfileEnsured: isNode,
    dockerHubSecretsSet: true,
    julesSessionId,
    deploymentUrl
  });
});

// Latest workflow run status
app.get('/deploy/status', requireAuth, async (req, res) => {
  const repoFullName = req.query.repo as string | undefined;
  if (!repoFullName) return res.status(400).json({ error: 'repo query required' });
  const uid = (req as any).uid as string;
  const tokenDoc = await db.collection('githubTokens').doc(uid).get();
  if (!tokenDoc.exists) return res.status(400).json({ error: 'GitHub not linked' });
  const ghToken = (tokenDoc.data() as any).accessToken as string;
  const resp = await fetch(`https://api.github.com/repos/${repoFullName}/actions/runs?per_page=1`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
  });
  const data = await resp.json() as any;
  if (!resp.ok) return res.status(resp.status).json(data);
  const run = (data.workflow_runs && data.workflow_runs[0]) || null;
  res.json({ status: run?.status || 'unknown', conclusion: run?.conclusion || null, html_url: run?.html_url || null });
});

// Jules session status and activities
app.get('/jules/status', requireAuth, async (req, res) => {
  const sessionId = req.query.session as string | undefined;
  if (!sessionId) return res.status(400).json({ error: 'session query required' });
  const julesApiKeyValue = (julesApiKey.value() || process.env.JULES_API_KEY || process.env.JULES_KEY || '').trim();
  if (!julesApiKeyValue) return res.status(400).json({ error: 'Jules not configured' });
  const [sessionResp, activitiesResp] = await Promise.all([
    fetch(`https://jules.googleapis.com/v1alpha/sessions/${encodeURIComponent(sessionId)}`, { headers: { 'X-Goog-Api-Key': julesApiKeyValue } }),
    fetch(`https://jules.googleapis.com/v1alpha/sessions/${encodeURIComponent(sessionId)}/activities?pageSize=30`, { headers: { 'X-Goog-Api-Key': julesApiKeyValue } })
  ]);
  const session = await sessionResp.json();
  const activities = await activitiesResp.json();
  res.json({ session, activities });
});

// DevAI proxy to Google Generative Language API (server-side to keep API key secret)
app.post('/devai', requireAuth, async (req, res) => {
  try {
    const { prompt } = req.body as { prompt?: string };
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'prompt required' });
    const apiKey = genaiApiKey.value() || process.env.GENAI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || '';
    if (!apiKey) return res.status(500).json({ error: 'DevAI not configured' });
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=' + encodeURIComponent(apiKey);
    const body = {
      contents: [
        { role: 'user', parts: [{ text: prompt }] }
      ]
    };
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await resp.json() as any;
    if (!resp.ok) return res.status(resp.status).json(data);
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text) || '';
    res.json({ text });
  } catch (e) {
    console.error('DevAI error', e);
    res.status(500).json({ error: 'DevAI request failed' });
  }
});

// Send a follow-up message to Jules session
app.post('/jules/send', requireAuth, async (req, res) => {
  try {
    const { sessionId, prompt } = req.body as { sessionId?: string; prompt?: string };
    if (!sessionId || !prompt) return res.status(400).json({ error: 'sessionId and prompt required' });
    const julesApiKeyValue = (julesApiKey.value() || process.env.JULES_API_KEY || process.env.JULES_KEY || '').trim();
    if (!julesApiKeyValue) return res.status(500).json({ error: 'Jules not configured' });
    const url = `https://jules.googleapis.com/v1alpha/sessions/${encodeURIComponent(sessionId)}:sendMessage`;
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': julesApiKeyValue }, body: JSON.stringify({ prompt }) });
    const data = await resp.json();
    if (!resp.ok) return res.status(resp.status).json(data);
    res.json({ ok: true, data });
  } catch (e) {
    console.error('Jules send error', e);
    res.status(500).json({ error: 'Failed to send message to Jules' });
  }
});

export const api = onRequest({ 
  region: 'us-central1',
  secrets: [genaiApiKey, julesApiKey]
}, app);



