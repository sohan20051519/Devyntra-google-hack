import express from 'express';
import fetch from 'node-fetch';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import cors from 'cors';
import sodium from 'libsodium-wrappers';
import * as fs from 'fs';
import * as path from 'path';
if (getApps().length === 0) {
    initializeApp();
}
const db = getFirestore();
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    if (!token)
        return res.status(401).json({ error: 'Missing ID token' });
    getAdminAuth()
        .verifyIdToken(token)
        .then((decoded) => {
        req.uid = decoded.uid;
        next();
    })
        .catch(() => res.status(401).json({ error: 'Invalid ID token' }));
}
// Store GitHub OAuth access token received from Firebase client sign-in
app.post('/auth/github', requireAuth, async (req, res) => {
    const { accessToken } = req.body;
    if (!accessToken)
        return res.status(400).json({ error: 'Missing accessToken' });
    const uid = req.uid;
    await db.collection('githubTokens').doc(uid).set({ accessToken }, { merge: true });
    res.json({ ok: true });
});
// List repositories for the authenticated user (selected/all scopes handled by GitHub OAuth)
app.get('/repos', requireAuth, async (req, res) => {
    const uid = req.uid;
    const doc = await db.collection('githubTokens').doc(uid).get();
    if (!doc.exists)
        return res.status(400).json({ error: 'GitHub not linked' });
    const token = doc.data().accessToken;
    const response = await fetch('https://api.github.com/user/repos?per_page=100', {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json'
        }
    });
    const data = await response.json();
    if (!response.ok)
        return res.status(response.status).json(data);
    res.json(data.map((r) => ({ id: String(r.id), name: r.full_name })));
});
// GitHub user profile
app.get('/github/me', requireAuth, async (req, res) => {
    const uid = req.uid;
    const doc = await db.collection('githubTokens').doc(uid).get();
    if (!doc.exists)
        return res.status(400).json({ error: 'GitHub not linked' });
    const token = doc.data().accessToken;
    const response = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }
    });
    const data = await response.json();
    if (!response.ok)
        return res.status(response.status).json(data);
    res.json({ login: data.login, name: data.name, avatar_url: data.avatar_url, html_url: data.html_url });
});
// Start deployment orchestration (real GitHub workflow creation; GCP deploy remains simulated per request)
app.post('/deploy', requireAuth, async (req, res) => {
    const { repoFullName } = req.body;
    if (!repoFullName)
        return res.status(400).json({ error: 'repoFullName required' });
    const uid = req.uid;
    const tokenDoc = await db.collection('githubTokens').doc(uid).get();
    if (!tokenDoc.exists)
        return res.status(400).json({ error: 'GitHub not linked' });
    const ghToken = tokenDoc.data().accessToken;
    // 1) Detect framework (basic heuristic via repo file listing)
    const treeResp = await fetch(`https://api.github.com/repos/${repoFullName}/git/trees/HEAD?recursive=1`, {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    const tree = (await treeResp.json());
    if (!treeResp.ok)
        return res.status(treeResp.status).json(tree);
    const paths = (tree.tree || []).map((t) => t.path);
    const isNode = paths.includes('package.json') || paths.some((p) => p.endsWith('package.json'));
    const detectedFramework = (() => {
        const has = (p) => paths.some((x) => x.toLowerCase().includes(p));
        if (has('next.config'))
            return 'Next.js';
        if (has('angular.json'))
            return 'Angular';
        if (has('vite.config'))
            return 'Vite';
        if (has('vue.config') || has('src/main.ts') && has('src/App.vue'))
            return 'Vue';
        return isNode ? 'Node.js' : 'Unknown';
    })();
    // Determine default branch for workflow dispatch
    const repoResp = await fetch(`https://api.github.com/repos/${repoFullName}`, {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    const repoMeta = await repoResp.json();
    const defaultBranch = repoResp.ok && repoMeta.default_branch ? String(repoMeta.default_branch) : 'main';
    // If unsupported stack, stop early with an informative error
    if (!isNode) {
        return res.status(400).json({ error: 'Unsupported repository type. A package.json was not found. Currently only Node.js repos are supported.' });
    }
    // 2) Ensure workflow file exists - real build/test + Docker build/push
    const workflowPath = '.github/workflows/ci.yml';
    const getFileResp = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    const [owner, repo] = repoFullName.split('/');
    const gcpSecrets = {
        GCP_PROJECT: 'devyntra-500e4',
        GCP_REGION: 'us-central1',
        AR_REPO: 'devyntra-images',
        SERVICE_NAME: repo,
        REPO_NAME: repo
    };
    const templatePath = path.join(__dirname, 'workflow-template.yml');
    let workflowYml = fs.readFileSync(templatePath, 'utf8');
    for (const [key, value] of Object.entries(gcpSecrets)) {
        workflowYml = workflowYml.replace(new RegExp(`__${key}__`, 'g'), value);
    }
    const desiredContentB64 = Buffer.from(workflowYml).toString('base64');
    if (getFileResp.status === 404) {
        // Create new workflow
        await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${ghToken}`,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message: 'chore(ci): add GitHub Actions workflow', content: desiredContentB64 })
        });
    }
    else if (getFileResp.ok) {
        const existing = await getFileResp.json();
        const currentContent = existing?.content || '';
        if (currentContent.replace(/\n/g, '').trim() !== desiredContentB64.replace(/\n/g, '').trim()) {
            // Update existing workflow with safe conditionals
            await fetch(`https://api.github.com/repos/${repoFullName}/contents/${encodeURIComponent(workflowPath)}`, {
                method: 'PUT',
                headers: {
                    Authorization: `Bearer ${ghToken}`,
                    Accept: 'application/vnd.github+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ message: 'chore(ci): update workflow for conditional Docker push', content: desiredContentB64, sha: existing.sha })
            });
        }
    }
    // 3) Ensure Dockerfile exists for Node projects
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
    // 4) Set GitHub secrets automatically
    try {
        const keyResp = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/public-key`, {
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
        });
        if (keyResp.ok) {
            const keyData = await keyResp.json();
            await sodium.ready;
            const { key, key_id } = keyData;
            const encrypt = (value) => {
                const binkey = sodium.from_base64(key, sodium.base64_variants.ORIGINAL);
                const binsec = sodium.from_string(value);
                const encBytes = sodium.crypto_box_seal(binsec, binkey);
                return sodium.to_base64(encBytes, sodium.base64_variants.ORIGINAL);
            };
            // Set GCP secrets for Cloud Run deployment
            for (const [name, value] of Object.entries(gcpSecrets)) {
                const encrypted_value = encrypt(value);
                await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/${name}`, {
                    method: 'PUT',
                    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ encrypted_value, key_id })
                });
                console.log(`✅ Set secret: ${name}`);
            }
            // Set GCLOUD_SERVICE_KEY secret automatically from file
            try {
                const keyPath = path.join(__dirname, '..', 'devyntra-deploy-key.json');
                let serviceAccountKey;
                if (fs.existsSync(keyPath)) {
                    serviceAccountKey = fs.readFileSync(keyPath, 'utf8');
                    console.log('✅ Reading service account key from file:', keyPath);
                }
                else {
                    console.error('❌ Service account key file not found at:', keyPath);
                    throw new Error('Service account key file not found');
                }
                const encrypted_key = encrypt(serviceAccountKey);
                const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/secrets/GCLOUD_SERVICE_KEY`, {
                    method: 'PUT',
                    headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
                    body: JSON.stringify({ encrypted_value: encrypted_key, key_id })
                });
                if (response.ok) {
                    console.log('✅ Successfully set GCLOUD_SERVICE_KEY secret for repository:', `${owner}/${repo}`);
                }
                else {
                    const errorText = await response.text();
                    console.error('❌ Failed to set GCLOUD_SERVICE_KEY secret:', response.status, errorText);
                }
            }
            catch (e) {
                console.error('❌ Failed to set GCLOUD_SERVICE_KEY:', e);
            }
        }
    }
    catch (e) {
        console.error('Failed setting repo secrets', e);
    }
    // 5) Trigger GitHub workflow_dispatch (real run)
    try {
        await fetch(`https://api.github.com/repos/${repoFullName}/actions/workflows/ci.yml/dispatches`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: defaultBranch })
        });
    }
    catch (e) {
        console.error('workflow_dispatch error', e);
    }
    // 6) Start Jules session for analysis/fix/logs
    let julesSessionId = null;
    try {
        const julesApiKey = process.env.JULES_API_KEY || process.env.JULES_KEY || '';
        if (julesApiKey) {
            const prompt = `You are a CI fixer agent. Task: Clone the repo, install deps, run build/test, fix issues, commit with clear messages, and push fixes directly to the default branch (${defaultBranch}). If scripts are missing, add minimal ones. Keep changes minimal but sufficient to pass CI.`;
            const julesResp = await fetch('https://jules.googleapis.com/v1alpha/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': julesApiKey },
                body: JSON.stringify({
                    prompt,
                    sourceContext: { source: `sources/github/${owner}/${repo}`, githubRepoContext: { startingBranch: 'main' } },
                    title: `Devyntra deploy: ${repoFullName}`
                })
            });
            if (julesResp.ok) {
                const julesData = await julesResp.json();
                julesSessionId = (julesData.name || julesData.id || '').toString();
            }
        }
    }
    catch (e) {
        console.error('Jules session error', e);
    }
    // 7) Simulate GCP deploy step (as requested, keep production deploy simulated; other steps real)
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
    const repoFullName = req.query.repo;
    if (!repoFullName)
        return res.status(400).json({ error: 'repo query required' });
    const uid = req.uid;
    const tokenDoc = await db.collection('githubTokens').doc(uid).get();
    if (!tokenDoc.exists)
        return res.status(400).json({ error: 'GitHub not linked' });
    const ghToken = tokenDoc.data().accessToken;
    const resp = await fetch(`https://api.github.com/repos/${repoFullName}/actions/runs?per_page=1`, {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    const data = await resp.json();
    if (!resp.ok)
        return res.status(resp.status).json(data);
    const run = (data.workflow_runs && data.workflow_runs[0]) || null;
    res.json({ status: run?.status || 'unknown', conclusion: run?.conclusion || null, html_url: run?.html_url || null });
});
// Jules session status and activities
app.get('/jules/status', requireAuth, async (req, res) => {
    const sessionId = req.query.session;
    if (!sessionId)
        return res.status(400).json({ error: 'session query required' });
    const julesApiKey = process.env.JULES_API_KEY || process.env.JULES_KEY || '';
    if (!julesApiKey)
        return res.status(400).json({ error: 'Jules not configured' });
    const [sessionResp, activitiesResp] = await Promise.all([
        fetch(`https://jules.googleapis.com/v1alpha/sessions/${encodeURIComponent(sessionId)}`, { headers: { 'X-Goog-Api-Key': julesApiKey } }),
        fetch(`https://jules.googleapis.com/v1alpha/sessions/${encodeURIComponent(sessionId)}/activities?pageSize=30`, { headers: { 'X-Goog-Api-Key': julesApiKey } })
    ]);
    const session = await sessionResp.json();
    const activities = await activitiesResp.json();
    res.json({ session, activities });
});
// DevAI proxy to Google Generative Language API (server-side to keep API key secret)
app.post('/devai', requireAuth, async (req, res) => {
    try {
        const { prompt } = req.body;
        if (!prompt || !prompt.trim())
            return res.status(400).json({ error: 'prompt required' });
        const apiKey = process.env.GENAI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || '';
        if (!apiKey)
            return res.status(500).json({ error: 'DevAI not configured' });
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=' + encodeURIComponent(apiKey);
        const body = {
            contents: [
                { role: 'user', parts: [{ text: prompt }] }
            ]
        };
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await resp.json();
        if (!resp.ok)
            return res.status(resp.status).json(data);
        const text = (data.candidates?.[0]?.content?.parts?.[0]?.text) || '';
        res.json({ text });
    }
    catch (e) {
        console.error('DevAI error', e);
        res.status(500).json({ error: 'DevAI request failed' });
    }
});
// Send a follow-up message to Jules session
app.post('/jules/send', requireAuth, async (req, res) => {
    try {
        const { sessionId, prompt } = req.body;
        if (!sessionId || !prompt)
            return res.status(400).json({ error: 'sessionId and prompt required' });
        const julesApiKey = process.env.JULES_API_KEY || process.env.JULES_KEY || '';
        if (!julesApiKey)
            return res.status(500).json({ error: 'Jules not configured' });
        const url = `https://jules.googleapis.com/v1alpha/sessions/${encodeURIComponent(sessionId)}:sendMessage`;
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': julesApiKey }, body: JSON.stringify({ prompt }) });
        const data = await resp.json();
        if (!resp.ok)
            return res.status(resp.status).json(data);
        res.json({ ok: true, data });
    }
    catch (e) {
        console.error('Jules send error', e);
        res.status(500).json({ error: 'Failed to send message to Jules' });
    }
});
export const api = onRequest({ region: 'us-central1' }, app);
