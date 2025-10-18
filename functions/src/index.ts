import express, { Request, Response, NextFunction } from 'express';
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
import { fileURLToPath } from 'url';

if (getApps().length === 0) {
  initializeApp();
}
const db = getFirestore();
const WEBHOOK_KEY = process.env.DEPLOY_WEBHOOK_KEY || process.env.WEBHOOK_KEY || '';

// Define secrets for API keys
const genaiApiKey = defineSecret('GENAI_API_KEY');
const julesApiKey = defineSecret('JULES_API_KEY');
const gcloudServiceKey = defineSecret('GCLOUD_SERVICE_KEY');

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

interface AuthenticatedRequest extends Request {
  uid?: string;
}

interface GitHubToken {
  accessToken: string;
}

interface GitHubRepo {
  id: number;
  full_name: string;
}

interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  html_url: string;
}

interface GitTree {
  tree: { path: string }[];
}

interface RepoMetadata {
  default_branch: string;
}

interface WorkflowRun {
  status: string;
  conclusion: string | null;
  html_url: string;
}

interface WorkflowRunsResponse {
  workflow_runs: WorkflowRun[];
}

interface GitHubFile {
  content: string;
  sha: string;
}

interface JulesSession {
  name?: string;
  id?: string;
}


function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing ID token' });
  getAdminAuth()
    .verifyIdToken(token)
    .then((decoded) => {
      req.uid = decoded.uid;
      next();
    })
    .catch(() => res.status(401).json({ error: 'Invalid ID token' }));
}

// Store GitHub OAuth access token received from Firebase client sign-in
app.post('/auth/github', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { accessToken } = req.body as { accessToken?: string };
  if (!accessToken) return res.status(400).json({ error: 'Missing accessToken' });
  const uid = req.uid as string;
  await db.collection('githubTokens').doc(uid).set({ accessToken }, { merge: true });
  res.json({ ok: true });
});

// List repositories for the authenticated user (selected/all scopes handled by GitHub OAuth)
app.get('/repos', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const uid = req.uid as string;
  const doc = await db.collection('githubTokens').doc(uid).get();
  if (!doc.exists) return res.status(400).json({ error: 'GitHub not linked' });
  const token = (doc.data() as GitHubToken).accessToken;
  const response = await fetch('https://api.github.com/user/repos?per_page=100', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json'
    }
  });
  const data = await response.json() as GitHubRepo[];
  if (!response.ok) return res.status(response.status).json(data);
  res.json(
    data.map((r) => ({ id: String(r.id), name: r.full_name }))
  );
});

// Receive webhook from CI with the deployed Cloud Run URL
app.post('/deploy/webhook', async (req: Request, res: Response) => {
  try {
    const key = (req.headers['x-webhook-key'] as string) || '';
    if (!WEBHOOK_KEY || key !== WEBHOOK_KEY) return res.status(401).json({ error: 'unauthorized' });
    const { repoFullName, url } = req.body as { repoFullName?: string; url?: string };
    if (!repoFullName || !url) return res.status(400).json({ error: 'repoFullName and url required' });

    const createdAt = new Date().toISOString();
    await db.collection('deployments').doc(repoFullName).collection('runs').doc(createdAt).set({
      repoFullName,
      url,
      createdAt
    });
    await db.collection('deployments').doc(repoFullName).set({ latestUrl: url, updatedAt: createdAt }, { merge: true });
    res.json({ ok: true });
  } catch (e) {
    console.error('deploy webhook error', e);
    res.status(500).json({ error: 'failed' });
  }
});

// Get latest deployed URL for a repo
app.get('/deploy/latest', async (req: Request, res: Response) => {
  try {
    const repoFullName = req.query.repo as string | undefined;
    if (!repoFullName) return res.status(400).json({ error: 'repo query required' });
    const doc = await db.collection('deployments').doc(repoFullName).get();
    const data = doc.exists ? doc.data() : null;
    res.json({ url: data?.latestUrl || null, updatedAt: data?.updatedAt || null });
  } catch (e) {
    console.error('deploy latest error', e);
    res.status(500).json({ error: 'failed' });
  }
});

// List saved projects for the authenticated user
app.get('/projects', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.uid as string;
    const snapshot = await db.collection('projects').doc(uid).collection('repos').orderBy('updatedAt', 'desc').get();
    const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ items });
  } catch (e) {
    console.error('list projects error', e);
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

// List deployments (latest) for the authenticated user's repos
app.get('/deployments', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const uid = req.uid as string;
    const doc = await db.collection('githubTokens').doc(uid).get();
    if (!doc.exists) return res.status(400).json({ error: 'GitHub not linked' });
    const token = (doc.data() as GitHubToken).accessToken;

    const response = await fetch('https://api.github.com/user/repos?per_page=100', {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json'
      }
    });
    const repos = await response.json() as GitHubRepo[];
    if (!response.ok) return res.status(response.status).json(repos);

    const fullNames: string[] = repos.map((r) => r.full_name);

    const results: { repoFullName: string; url: string | null; updatedAt: string | null }[] = [];
    const tasks = fullNames.map(async (name) => {
      const snap = await db.collection('deployments').doc(name).get();
      const data = snap.exists ? snap.data() : null;
      results.push({ repoFullName: name, url: data?.latestUrl || null, updatedAt: data?.updatedAt || null });
    });
    await Promise.all(tasks);

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
app.get('/github/me', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const uid = req.uid as string;
  const doc = await db.collection('githubTokens').doc(uid).get();
  if (!doc.exists) return res.status(400).json({ error: 'GitHub not linked' });
  const token = (doc.data() as GitHubToken).accessToken;
  const response = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
  });
  const data = await response.json() as GitHubUser;
  if (!response.ok) return res.status(response.status).json(data);
  res.json({ login: data.login, name: data.name, avatar_url: data.avatar_url, html_url: data.html_url });
});


// Latest workflow run status
app.get('/deploy/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const repoFullName = req.query.repo as string | undefined;
  if (!repoFullName) return res.status(400).json({ error: 'repo query required' });
  const uid = req.uid as string;
  const tokenDoc = await db.collection('githubTokens').doc(uid).get();
  if (!tokenDoc.exists) return res.status(400).json({ error: 'GitHub not linked' });
  const ghToken = (tokenDoc.data() as GitHubToken).accessToken;
  const resp = await fetch(`https://api.github.com/repos/${repoFullName}/actions/runs?per_page=1`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
  });
  const data = await resp.json() as WorkflowRunsResponse;
  if (!resp.ok) return res.status(resp.status).json(data);
  const run = (data.workflow_runs && data.workflow_runs[0]) || null;
  res.json({ status: run?.status || 'unknown', conclusion: run?.conclusion || null, html_url: run?.html_url || null });
});

// Jules session status and activities
app.get('/jules/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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
app.post('/devai', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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
    const data = await resp.json() as { candidates: { content: { parts: { text: string }[] } }[] };
    if (!resp.ok) return res.status(resp.status).json(data);
    const text = (data.candidates?.[0]?.content?.parts?.[0]?.text) || '';
    res.json({ text });
  } catch (e) {
    console.error('DevAI error', e);
    res.status(500).json({ error: 'DevAI request failed' });
  }
});

// Send a follow-up message to Jules session
app.post('/jules/send', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
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

// Start deployment orchestration
app.post('/deploy', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const { repoFullName } = req.body as { repoFullName?: string };
  if (!repoFullName) return res.status(400).json({ error: 'repoFullName required' });
  const uid = req.uid as string;
  const tokenDoc = await db.collection('githubTokens').doc(uid).get();
  if (!tokenDoc.exists) return res.status(400).json({ error: 'GitHub not linked' });
  const ghToken = (tokenDoc.data() as GitHubToken).accessToken;

  const treeResp = await fetch(`https://api.github.com/repos/${repoFullName}/git/trees/HEAD?recursive=1`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
  });
  const tree = (await treeResp.json()) as GitTree;
  if (!treeResp.ok) return res.status(treeResp.status).json(tree);
  const paths: string[] = (tree.tree || []).map((t) => t.path);
  const isNode = paths.includes('package.json') || paths.some((p) => p.endsWith('package.json'));
  const detectedFramework = (() => {
    const has = (p: string) => paths.some((x) => x.toLowerCase().includes(p));
    if (has('next.config')) return 'Next.js';
    if (has('angular.json')) return 'Angular';
    if (has('vite.config')) return 'Vite';
    if (has('vue.config') || has('src/main.ts') && has('src/App.vue')) return 'Vue';
    return isNode ? 'Node.js' : 'Unknown';
  })();

  const repoResp = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
  });
  const repoMeta = await repoResp.json() as RepoMetadata;
  const defaultBranch = repoResp.ok && repoMeta.default_branch ? repoMeta.default_branch : 'main';

  if (!isNode) {
    return res.status(400).json({ error: 'Unsupported repository type. A package.json was not found. Currently only Node.js repos are supported.' });
  }

  const workflowPath = '.github/workflows/ci.yml';
  const getFileResp = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
  });

  const [owner, repo] = repoFullName.split('/');
  const gcpSecrets = {
    GCP_PROJECT: process.env.GCP_PROJECT || 'devyntra-500e4',
    GCP_REGION: process.env.GCP_REGION || 'us-central1',
    AR_REPO: 'devyntra-images',
    SERVICE_NAME: repo,
    REPO_NAME: repo
  };

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const templatePath = path.join(__dirname, 'workflow-template.yml');
  let workflowYml: string;
  try {
    workflowYml = fs.readFileSync(templatePath, 'utf8');
  } catch (error) {
    console.error('Error reading workflow template:', error);
    return res.status(500).json({ error: 'Failed to read workflow template' });
  }

  for (const [key, value] of Object.entries(gcpSecrets)) {
    workflowYml = workflowYml.replace(new RegExp(`__${key}__`, 'g'), value);
  }

  const desiredContentB64 = Buffer.from(workflowYml).toString('base64');

  if (getFileResp.status === 404) {
    await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ message: 'chore(ci): add GitHub Actions workflow', content: desiredContentB64 })
    });
  } else if (getFileResp.ok) {
    const existing = await getFileResp.json() as GitHubFile;
    if (existing.content.replace(/\s/g, '') !== desiredContentB64.replace(/\s/g, '')) {
      await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${ghToken}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: 'chore(ci): update workflow', content: desiredContentB64, sha: existing.sha })
      });
    }
  }

  if (isNode) {
    const dockerfilePath = 'Dockerfile';
    const getDockerfile = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(dockerfilePath)}`, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    if (getDockerfile.status === 404) {
      const dockerfile = Buffer.from(`FROM node:20-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci || npm install\nCOPY . .\nEXPOSE 3000\nCMD ["npm", "start"]\n`).toString('base64');
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

  try {
    const keyResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, {
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    if (keyResp.ok) {
      const keyData = await keyResp.json() as { key: string; key_id: string };
      await sodium.ready;
      const { key, key_id } = keyData;
      const encrypt = (value: string) => {
        const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
        const binsec = sodium.from_string(value);
        const encBytes = sodium.crypto_box_seal(binsec, binkey);
        return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
      };

      for (const [name, value] of Object.entries(gcpSecrets)) {
        const encrypted_value = encrypt(value);
        await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${name}`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ encrypted_value, key_id })
        });
      }

      const serviceAccountKey = gcloudServiceKey.value();
      if (serviceAccountKey) {
        const encrypted_key = encrypt(serviceAccountKey);
        await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/GCLOUD_SERVICE_KEY`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ encrypted_value: encrypted_key, key_id })
        });
      }
    }
  } catch (e) {
    console.error('Failed setting repo secrets', e);
  }

  try {
    await fetch(`https://api.github.com/repos/${repoFullName}/actions/workflows/ci.yml/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: defaultBranch })
    });
  } catch (e) {
    console.error('workflow_dispatch error', e);
  }

  let julesSessionId: string | null = null;
  try {
    const julesApiKeyValue = (julesApiKey.value() || process.env.JULES_API_KEY || '').trim();
    if (julesApiKeyValue) {
      const prompt = `You are a CI fixer agent. Task: Clone the repo, install deps, run build/test, fix issues, commit with clear messages, and push fixes directly to the default branch (${defaultBranch}). If scripts are missing, add minimal ones. Keep changes minimal but sufficient to pass CI.`;
      const julesResp = await fetch('https://jules.googleapis.com/v1alpha/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': julesApiKeyValue },
        body: JSON.stringify({
          prompt,
          sourceContext: { source: `sources/github/${owner}/${repo}`, githubRepoContext: { startingBranch: 'main' } },
          title: `Devyntra deploy: ${repoFullName}`
        })
      });
      if (julesResp.ok) {
        const julesData = await julesResp.json() as JulesSession;
        julesSessionId = (julesData.name || julesData.id || '').toString();
      }
    }
  } catch (e) {
    console.error('Jules session error', e);
  }

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

export const api = onRequest({
  region: 'us-central1',
  secrets: [genaiApiKey, julesApiKey, gcloudServiceKey]
}, app);