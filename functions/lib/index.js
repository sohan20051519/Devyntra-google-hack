import express from 'express';
import fetch from 'node-fetch';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import cors from 'cors';
import jwt from 'jsonwebtoken';
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
const githubAppPrivateKey = defineSecret('GITHUB_APP_PRIVATE_KEY');
const githubAppClientSecret = defineSecret('GITHUB_APP_CLIENT_SECRET');
const GITHUB_APP_ID = '2139669';
const GITHUB_APP_CLIENT_ID = 'Iv23li892YlZShywCzP3';
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
async function getGitHubAppToken() {
    const privateKey = githubAppPrivateKey.value();
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iat: now - 60,
        exp: now + (10 * 60),
        iss: GITHUB_APP_ID,
    };
    const token = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
    return token;
}
async function getInstallationAccessToken(installationId) {
    const appToken = await getGitHubAppToken();
    const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${appToken}`,
            Accept: 'application/vnd.github+json',
        },
    });
    const data = await response.json();
    if (!response.ok) {
        throw new Error('Failed to get installation access token');
    }
    return data.token;
}
// Exchange a GitHub OAuth code for an access token and store it
app.post('/auth/github', requireAuth, async (req, res) => {
    const { code } = req.body;
    if (!code)
        return res.status(400).json({ error: 'Missing code' });
    const uid = req.uid;
    const response = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify({
            client_id: GITHUB_APP_CLIENT_ID,
            client_secret: githubAppClientSecret.value(),
            code,
        }),
    });
    const data = await response.json();
    if (!response.ok || !data.access_token) {
        return res.status(400).json({ error: 'Failed to exchange code for token' });
    }
    await db.collection('githubTokens').doc(uid).set({ accessToken: data.access_token }, { merge: true });
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
// Receive webhook from CI with the deployed Cloud Run URL
app.post('/deploy/webhook', async (req, res) => {
    try {
        const key = req.headers['x-webhook-key'] || '';
        if (!WEBHOOK_KEY || key !== WEBHOOK_KEY)
            return res.status(401).json({ error: 'unauthorized' });
        const { repoFullName, url } = req.body;
        if (!repoFullName || !url)
            return res.status(400).json({ error: 'repoFullName and url required' });
        const createdAt = new Date().toISOString();
        await db.collection('deployments').doc(repoFullName).collection('runs').doc(createdAt).set({
            repoFullName,
            url,
            createdAt
        });
        await db.collection('deployments').doc(repoFullName).set({ latestUrl: url, updatedAt: createdAt }, { merge: true });
        res.json({ ok: true });
    }
    catch (e) {
        console.error('deploy webhook error', e);
        res.status(500).json({ error: 'failed' });
    }
});
// Get latest deployed URL for a repo
app.get('/deploy/latest', async (req, res) => {
    try {
        const repoFullName = req.query.repo;
        if (!repoFullName)
            return res.status(400).json({ error: 'repo query required' });
        const doc = await db.collection('deployments').doc(repoFullName).get();
        const data = doc.exists ? doc.data() : null;
        res.json({ url: data?.latestUrl || null, updatedAt: data?.updatedAt || null });
    }
    catch (e) {
        console.error('deploy latest error', e);
        res.status(500).json({ error: 'failed' });
    }
});
// List saved projects for the authenticated user
app.get('/projects', requireAuth, async (req, res) => {
    try {
        const uid = req.uid;
        const snapshot = await db.collection('projects').doc(uid).collection('repos').orderBy('updatedAt', 'desc').get();
        const items = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
        res.json({ items });
    }
    catch (e) {
        console.error('list projects error', e);
        res.status(500).json({ error: 'Failed to list projects' });
    }
});
// List deployments (latest) for the authenticated user's repos
app.get('/deployments', requireAuth, async (req, res) => {
    try {
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
        const repos = await response.json();
        if (!response.ok)
            return res.status(response.status).json(repos);
        const fullNames = repos.map((r) => r.full_name);
        const results = [];
        const tasks = fullNames.map(async (name) => {
            const snap = await db.collection('deployments').doc(name).get();
            const data = snap.exists ? snap.data() : null;
            results.push({ repoFullName: name, url: data?.latestUrl || null, updatedAt: data?.updatedAt || null });
        });
        await Promise.all(tasks);
        results.sort((a, b) => {
            if (!a.updatedAt && !b.updatedAt)
                return 0;
            if (!a.updatedAt)
                return 1;
            if (!b.updatedAt)
                return -1;
            return a.updatedAt > b.updatedAt ? -1 : 1;
        });
        res.json({ items: results });
    }
    catch (e) {
        console.error('list deployments error', e);
        res.status(500).json({ error: 'Failed to list deployments' });
    }
});
// GitHub user profile
app.get('/github/setup', async (req, res) => {
    const { installation_id, state } = req.query;
    const uid = state;
    if (installation_id && uid) {
        try {
            await db.collection('userProfiles').doc(uid).set({
                githubInstallationId: installation_id,
            }, { merge: true });
            return res.send(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Installation Successful</title>
                    <style>
                        body { font-family: sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f0f2f5; }
                        .container { text-align: center; background-color: white; padding: 40px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
                        h1 { color: #2dce89; }
                        p { color: #525f7f; }
                        a { color: #5e72e4; text-decoration: none; }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <h1>Success!</h1>
                        <p>The GitHub App was installed successfully.</p>
                        <p>You can now close this window and return to the application.</p>
                    </div>
                </body>
                </html>
            `);
        }
        catch (error) {
            console.error('Failed to save installation ID', error);
            return res.status(500).send('Failed to save installation ID.');
        }
    }
    // Redirect to app homepage with an error if params are missing
    return res.redirect('/?error=installation_failed');
});
app.get('/github/installation-status', requireAuth, async (req, res) => {
    const uid = req.uid;
    try {
        // 1. Check for a saved installation ID first.
        const userProfileDoc = await db.collection('userProfiles').doc(uid).get();
        if (userProfileDoc.exists && userProfileDoc.data()?.githubInstallationId) {
            return res.json({ isInstalled: true });
        }
        // 2. Fallback to the old method (checking via GitHub API)
        const doc = await db.collection('githubTokens').doc(uid).get();
        if (!doc.exists) {
            return res.json({ isInstalled: false });
        }
        const token = doc.data().accessToken;
        const response = await fetch('https://api.github.com/user/installations', {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json'
            }
        });
        if (!response.ok) {
            // If the token is invalid or permissions are revoked, they'll need to re-auth.
            return res.json({ isInstalled: false });
        }
        const data = await response.json();
        const installation = data.installations.find(inst => inst.app_id === parseInt(GITHUB_APP_ID, 10));
        if (installation) {
            // If found, save the installation ID for future checks
            await db.collection('userProfiles').doc(uid).set({
                githubInstallationId: installation.id,
            }, { merge: true });
            return res.json({ isInstalled: true });
        }
        res.json({ isInstalled: false });
    }
    catch (e) {
        console.error('Failed to get installation status', e);
        res.status(500).json({ error: 'Failed to get installation status' });
    }
});
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
app.get('/github/workflow-status', requireAuth, async (req, res) => {
    const { repoFullName, runId } = req.query;
    if (!repoFullName || !runId) {
        return res.status(400).json({ error: 'repoFullName and runId are required' });
    }
    const uid = req.uid;
    const tokenDoc = await db.collection('githubTokens').doc(uid).get();
    if (!tokenDoc.exists)
        return res.status(400).json({ error: 'GitHub not linked' });
    const ghToken = tokenDoc.data().accessToken;
    try {
        const resp = await fetch(`https://api.github.com/repos/${repoFullName}/actions/runs/${runId}`, {
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
        });
        const data = await resp.json();
        if (!resp.ok)
            return res.status(resp.status).json(data);
        res.json({ status: data.status, conclusion: data.conclusion });
    }
    catch (e) {
        console.error('Failed to get workflow status', e);
        res.status(500).json({ error: 'Failed to get workflow status' });
    }
});
app.get('/github/workflow-logs', requireAuth, async (req, res) => {
    const { repoFullName, runId } = req.query;
    if (!repoFullName || !runId) {
        return res.status(400).json({ error: 'repoFullName and runId are required' });
    }
    const uid = req.uid;
    const tokenDoc = await db.collection('githubTokens').doc(uid).get();
    if (!tokenDoc.exists)
        return res.status(400).json({ error: 'GitHub not linked' });
    const ghToken = tokenDoc.data().accessToken;
    try {
        const resp = await fetch(`https://api.github.com/repos/${repoFullName}/actions/runs/${runId}/logs`, {
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
        });
        if (!resp.ok) {
            // Log URLs are often transient. If it fails, link to the run itself.
            const runResp = await fetch(`https://api.github.com/repos/${repoFullName}/actions/runs/${runId}`, {
                headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
            });
            const runData = await runResp.json();
            return res.status(200).json({ logs: `Could not retrieve logs. View them on GitHub: ${runData.html_url}` });
        }
        const logs = await resp.text();
        res.json({ logs });
    }
    catch (e) {
        console.error('Failed to get workflow logs', e);
        res.status(500).json({ error: 'Failed to get workflow logs' });
    }
});
// Jules session status and activities
app.get('/jules/status', requireAuth, async (req, res) => {
    const sessionId = req.query.session;
    if (!sessionId)
        return res.status(400).json({ error: 'session query required' });
    const julesApiKeyValue = (julesApiKey.value() || process.env.JULES_API_KEY || process.env.JULES_KEY || '').trim();
    if (!julesApiKeyValue)
        return res.status(400).json({ error: 'Jules not configured' });
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
        const { prompt } = req.body;
        if (!prompt || !prompt.trim())
            return res.status(400).json({ error: 'prompt required' });
        const apiKey = genaiApiKey.value() || process.env.GENAI_API_KEY || process.env.GOOGLE_GENAI_API_KEY || process.env.GEMINI_API_KEY || '';
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
        const julesApiKeyValue = (julesApiKey.value() || process.env.JULES_API_KEY || process.env.JULES_KEY || '').trim();
        if (!julesApiKeyValue)
            return res.status(500).json({ error: 'Jules not configured' });
        const url = `https://jules.googleapis.com/v1alpha/sessions/${encodeURIComponent(sessionId)}:sendMessage`;
        const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': julesApiKeyValue }, body: JSON.stringify({ prompt }) });
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
// Start deployment orchestration
app.post('/deploy', requireAuth, async (req, res) => {
    const { repoFullName } = req.body;
    if (!repoFullName)
        return res.status(400).json({ error: 'repoFullName required' });
    const [owner, repo] = repoFullName.split('/');
    try {
        const appToken = await getGitHubAppToken();
        const installationResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/installation`, {
            headers: {
                Authorization: `Bearer ${appToken}`,
                Accept: 'application/vnd.github+json',
            },
        });
        if (!installationResponse.ok) {
            return res.status(400).json({ error: 'GitHub App not installed on this repository' });
        }
        const installation = await installationResponse.json();
        const ghToken = await getInstallationAccessToken(installation.id);
        const repoResp = await fetch(`https://api.github.com/repos/${repoFullName}`, {
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
        });
        const repoMeta = await repoResp.json();
        const defaultBranch = repoResp.ok ? repoMeta.default_branch : 'main';
        const workflowPath = '.github/workflows/validation.yml';
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);
        const templatePath = path.join(__dirname, 'validation-workflow-template.yml');
        const workflowYml = fs.readFileSync(templatePath, 'utf8');
        const contentB64 = Buffer.from(workflowYml).toString('base64');
        await fetch(`https://api.github.com/repos/${repoFullName}/contents/${workflowPath}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${ghToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'chore: add validation workflow',
                content: contentB64,
                branch: defaultBranch
            })
        });
        await fetch(`https://api.github.com/repos/${repoFullName}/actions/workflows/validation.yml/dispatches`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${ghToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ ref: defaultBranch })
        });
        // Short delay to allow GitHub to initiate the run
        await new Promise(resolve => setTimeout(resolve, 2000));
        const runsResp = await fetch(`https://api.github.com/repos/${repoFullName}/actions/workflows/validation.yml/runs?per_page=1`, {
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
        });
        const runsData = await runsResp.json();
        const latestRun = runsData.workflow_runs?.[0];
        if (!latestRun) {
            throw new Error('Could not find validation workflow run.');
        }
        res.json({
            validationRunId: latestRun.id,
            deploymentUrl: `https://cloud-run-simulated.devyntra.app/${encodeURIComponent(repoFullName)}`
        });
    }
    catch (e) {
        console.error('Deployment start error', e);
        res.status(500).json({ error: 'Failed to start deployment' });
    }
});
app.post('/start-jules-analysis', requireAuth, async (req, res) => {
    const { repoFullName, logs } = req.body;
    if (!repoFullName || !logs) {
        return res.status(400).json({ error: 'repoFullName and logs are required' });
    }
    const [owner, repo] = repoFullName.split('/');
    try {
        const julesApiKeyValue = (julesApiKey.value() || process.env.JULES_API_KEY || '').trim();
        if (!julesApiKeyValue) {
            return res.status(500).json({ error: 'Jules AI is not configured on the backend.' });
        }
        const prompt = `You are a CI fixer agent. Your primary goal is to ensure the repository can be successfully deployed. The validation workflow failed with the following logs:

${logs}

**Your tasks are:**
1.  Analyze the logs to identify the root cause of the failure.
2.  Clone the repository.
3.  Install all necessary dependencies.
4.  Run the build and test scripts.
5.  Identify and fix any errors that prevent the application from building or running.
6.  If essential files like \`package.json\` are missing, create them with the necessary content.
7.  If build or test scripts are missing from \`package.json\`, add minimal, functional scripts.
8.  When you are finished, do not push the changes. Instead, output a list of all the files you have changed, in the following format:

\`\`\`json
[
  {
    "path": "path/to/file.ext",
    "content": "The full content of the file goes here."
  }
]
\`\`\`

Keep your changes as minimal as possible, but ensure they are sufficient to get the CI pipeline to pass.`;
        const julesResp = await fetch('https://jules.googleapis.com/v1alpha/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': julesApiKeyValue },
            body: JSON.stringify({
                prompt,
                sourceContext: { source: `sources/github/${owner}/${repo}`, githubRepoContext: { startingBranch: 'main' } },
                title: `Devyntra deploy: ${repoFullName}`
            })
        });
        if (!julesResp.ok) {
            const errorData = await julesResp.json();
            throw new Error(errorData.error?.message || 'Failed to start Jules session');
        }
        const julesData = await julesResp.json();
        res.json({ julesSessionId: (julesData.name || julesData.id || '').toString() });
    }
    catch (e) {
        console.error('Jules session error', e);
        res.status(500).json({ error: 'Failed to start Jules analysis' });
    }
});
app.post('/trigger-deployment', requireAuth, async (req, res) => {
    const { repoFullName } = req.body;
    if (!repoFullName)
        return res.status(400).json({ error: 'repoFullName required' });
    const uid = req.uid;
    const tokenDoc = await db.collection('githubTokens').doc(uid).get();
    if (!tokenDoc.exists)
        return res.status(400).json({ error: 'GitHub not linked' });
    const ghToken = tokenDoc.data().accessToken;
    const repoResp = await fetch(`https://api.github.com/repos/${repoFullName}`, {
        headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }
    });
    const repoMeta = await repoResp.json();
    const defaultBranch = repoResp.ok && repoMeta.default_branch ? repoMeta.default_branch : 'main';
    try {
        await fetch(`https://api.github.com/repos/${repoFullName}/actions/workflows/ci.yml/dispatches`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
            body: JSON.stringify({ ref: defaultBranch })
        });
        res.json({ ok: true });
    }
    catch (e) {
        console.error('workflow_dispatch error', e);
        res.status(500).json({ error: 'Failed to trigger deployment' });
    }
});
app.post('/apply-patch', requireAuth, async (req, res) => {
    const { repoFullName, julesSessionId } = req.body;
    if (!repoFullName || !julesSessionId)
        return res.status(400).json({ error: 'repoFullName and julesSessionId required' });
    const uid = req.uid;
    const tokenDoc = await db.collection('githubTokens').doc(uid).get();
    if (!tokenDoc.exists)
        return res.status(400).json({ error: 'GitHub not linked' });
    const ghToken = tokenDoc.data().accessToken;
    const newBranchName = `jules-patch-${Date.now()}`;
    try {
        const julesApiKeyValue = (julesApiKey.value() || process.env.JULES_API_KEY || '').trim();
        if (!julesApiKeyValue)
            return res.status(500).json({ error: 'Jules not configured' });
        const sessionResp = await fetch(`https://jules.googleapis.com/v1alpha/sessions/${encodeURIComponent(julesSessionId)}`, { headers: { 'X-Goog-Api-Key': julesApiKeyValue } });
        const session = await sessionResp.json();
        const summary = session.result?.summary;
        if (!summary)
            return res.status(500).json({ error: 'Jules session has no result' });
        const changedFiles = JSON.parse(summary);
        if (!changedFiles || !Array.isArray(changedFiles))
            return res.status(500).json({ error: 'Invalid patch format from Jules' });
        const [owner, repo] = repoFullName.split('/');
        const repoInfo = await fetch(`https://api.github.com/repos/${repoFullName}`);
        const repoData = await repoInfo.json();
        const mainBranch = repoData.default_branch || 'main';
        const branchInfo = await fetch(`https://api.github.com/repos/${repoFullName}/branches/${mainBranch}`);
        const branchData = await branchInfo.json();
        const latestCommitSha = branchData.commit.sha;
        await fetch(`https://api.github.com/repos/${repoFullName}/git/refs`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                ref: `refs/heads/${newBranchName}`,
                sha: latestCommitSha,
            }),
        });
        for (const file of changedFiles) {
            await fetch(`https://api.github.com/repos/${repoFullName}/contents/${file.path}`, {
                method: 'PUT',
                headers: { Authorization: `Bearer ${ghToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `Jules AI fix for ${file.path}`,
                    content: Buffer.from(file.content).toString('base64'),
                    branch: newBranchName,
                }),
            });
        }
        const prResponse = await fetch(`https://api.github.com/repos/${repoFullName}/pulls`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${ghToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                title: 'Jules AI Fixes',
                head: newBranchName,
                base: mainBranch,
                body: 'This PR contains automated fixes from the Jules AI agent.',
            }),
        });
        const prData = await prResponse.json();
        if (prData.message) {
            // If there are no changes, GitHub will return an error
            if (prData.message.includes('No commits between')) {
                res.json({ ok: true, message: 'No changes to apply' });
                return;
            }
            throw new Error(prData.message);
        }
        const mergeResponse = await fetch(`https://api.github.com/repos/${repoFullName}/pulls/${prData.number}/merge`, {
            method: 'PUT',
            headers: { Authorization: `Bearer ${ghToken}`, 'Content-Type': 'application/json' },
        });
        if (!mergeResponse.ok) {
            const mergeData = await mergeResponse.json();
            if (mergeData.message.includes('merge conflict')) {
                throw new Error('Merge conflict when applying Jules patch');
            }
            throw new Error(mergeData.message);
        }
        res.json({ ok: true });
    }
    catch (e) {
        console.error('Failed to apply patch', e);
        res.status(500).json({ error: 'Failed to apply patch' });
    }
    finally {
        // Clean up the temporary branch
        await fetch(`https://api.github.com/repos/${repoFullName}/git/refs/heads/${newBranchName}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${ghToken}` },
        });
    }
});
export const api = onRequest({
    region: 'us-central1',
    secrets: [genaiApiKey, julesApiKey, gcloudServiceKey, githubAppPrivateKey, githubAppClientSecret]
}, app);
