import express from 'express';
import fetch from 'node-fetch';
import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import cors from 'cors';
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
        // Store under deployments/{repo}/runs/{createdAt}
        await db.collection('deployments').doc(repoFullName).collection('runs').doc(createdAt).set({
            repoFullName,
            url,
            createdAt
        });
        // Also store latest pointer
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
        // 1) Fetch user's repos from GitHub (limit 100)
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
        // 2) For each repo, read latest deployment from Firestore if present
        const results = [];
        const tasks = fullNames.map(async (name) => {
            const snap = await db.collection('deployments').doc(name).get();
            const data = snap.exists ? snap.data() : null;
            results.push({ repoFullName: name, url: data?.latestUrl || null, updatedAt: data?.updatedAt || null });
        });
        await Promise.all(tasks);
        // 3) Sort by updatedAt desc (nulls last)
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
export const api = onRequest({
    region: 'us-central1',
    secrets: [genaiApiKey, julesApiKey]
}, app);
