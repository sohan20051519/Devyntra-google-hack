import { https } from "firebase-functions";
import admin from "firebase-admin";
import express from "express";
import cors from "cors";
import { Octokit } from "@octokit/rest";
import { defineString } from 'firebase-functions/params';
import { GoogleGenerativeAI } from "@google/generative-ai";
const GITHUB_CLIENT_ID = defineString('GITHUB_CLIENT_ID');
const GITHUB_CLIENT_SECRET = defineString('GITHUB_CLIENT_SECRET');
const GENAI_API_KEY = defineString('GENAI_API_KEY');
admin.initializeApp();
const db = admin.firestore();
const app = express();
app.use(cors({ origin: true }));
app.use(express.json());
const authenticate = async (req, res, next) => {
    if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
        return res.status(403).send('Unauthorized');
    }
    const idToken = req.headers.authorization.split('Bearer ')[1];
    try {
        const decodedIdToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedIdToken;
        next();
    }
    catch (e) {
        res.status(403).send('Unauthorized');
    }
};
app.get("/", (req, res) => res.status(200).send("Hey there!"));
app.post("/auth/github", authenticate, async (req, res) => {
    const { accessToken } = req.body;
    const { uid } = req.user;
    if (!accessToken) {
        return res.status(400).send({ error: "Missing access token." });
    }
    try {
        // Store the token securely, associated with the Firebase user
        await db.collection("githubTokens").doc(uid).set({
            accessToken,
        }, { merge: true });
        res.status(200).send({ success: true });
    }
    catch (error) {
        console.error("Error storing access token:", error);
        res.status(500).send({ error: "Internal server error." });
    }
});
// All routes below this require authentication
app.use(authenticate);
app.get("/repos", async (req, res) => {
    const { uid } = req.user;
    try {
        const tokenDoc = await db.collection('githubTokens').doc(uid).get();
        if (!tokenDoc.exists) {
            return res.status(401).send({ error: 'GitHub token not found.' });
        }
        const { accessToken } = tokenDoc.data();
        const octokit = new Octokit({ auth: accessToken });
        const { data: repos } = await octokit.repos.listForAuthenticatedUser();
        res.status(200).send(repos.map(repo => ({ id: repo.id, name: repo.full_name })));
    }
    catch (error) {
        console.error('Error fetching repositories:', error);
        res.status(500).send({ error: 'Failed to fetch repositories.' });
    }
});
app.post("/deploy", async (req, res) => {
    const { repoFullName } = req.body;
    // For simplicity, we'll just log the deployment request for now.
    console.log(`Deployment requested for ${repoFullName}`);
    // In a real application, this is where you would trigger the CI/CD pipeline.
    res.status(200).send({ message: "Deployment started", validationRunId: 12345, deploymentUrl: `https://${repoFullName}.example.dev` });
});
app.get("/github/workflow-status", (req, res) => res.status(200).send({ status: "completed", conclusion: "success" }));
app.get("/github/workflow-logs", (req, res) => res.status(200).send({ logs: "Workflow completed successfully." }));
app.post("/start-jules-analysis", (req, res) => res.status(200).send({ julesSessionId: "jules-123" }));
app.get("/github/me", async (req, res) => {
    const { uid } = req.user;
    try {
        const tokenDoc = await db.collection('githubTokens').doc(uid).get();
        if (!tokenDoc.exists) {
            return res.status(401).send({ error: 'GitHub token not found.' });
        }
        const { accessToken } = tokenDoc.data();
        const octokit = new Octokit({ auth: accessToken });
        const { data: user } = await octokit.users.getAuthenticated();
        res.status(200).send(user);
    }
    catch (error) {
        console.error('Error fetching GitHub user:', error);
        res.status(500).send({ error: 'Failed to fetch GitHub user.' });
    }
});
app.get("/github/installation-status", (req, res) => res.status(200).send({ isInstalled: true }));
app.get("/github/installation-and-repos", async (req, res) => {
    const { uid } = req.user;
    try {
        const tokenDoc = await db.collection('githubTokens').doc(uid).get();
        if (!tokenDoc.exists) {
            return res.status(401).send({ error: 'GitHub token not found.' });
        }
        const { accessToken } = tokenDoc.data();
        const octokit = new Octokit({ auth: accessToken });
        const { data: repos } = await octokit.repos.listForAuthenticatedUser();
        res.status(200).send({ installed: true, repos: repos.map(repo => ({ id: repo.id, name: repo.full_name })) });
    }
    catch (error) {
        console.error('Error fetching repositories:', error);
        res.status(500).send({ error: 'Failed to fetch repositories.' });
    }
});
app.get("/deploy/status", (req, res) => res.status(200).send({ status: "completed", conclusion: "success", html_url: "https://github.com" }));
app.get("/deployments", (req, res) => res.status(200).send({ items: [] }));
app.post("/devai", async (req, res) => {
    const { prompt } = req.body;
    try {
        const genAI = new GoogleGenerativeAI(GENAI_API_KEY.value());
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        res.status(200).send({ text });
    }
    catch (error) {
        console.error("Error with DevAI:", error);
        res.status(500).send({ error: "Failed to get response from DevAI." });
    }
});
app.get("/jules/status", (req, res) => res.status(200).send({ session: { state: "COMPLETED" }, activities: [] }));
app.post("/jules/send", (req, res) => res.status(200).send({ success: true }));
app.post("/trigger-deployment", (req, res) => res.status(200).send({ success: true }));
app.post("/apply-patch", (req, res) => res.status(200).send({ success: true }));
const api = https.onRequest(app);
export { api };
