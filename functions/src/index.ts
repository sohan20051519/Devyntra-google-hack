import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import express, { Request, Response, NextFunction } from "express";
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

interface AuthenticatedRequest extends Request {
  user?: admin.auth.DecodedIdToken;
}

const optionalAuthenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
    const idToken = req.headers.authorization.split('Bearer ')[1];
    try {
      const decodedIdToken = await admin.auth().verifyIdToken(idToken);
      req.user = decodedIdToken;
    } catch (e) {
      // Ignore error, user is not authenticated
    }
  }
  next();
};


app.get("/", (req: Request, res: Response) => res.status(200).send("Hey there!"));

app.post("/auth/github", optionalAuthenticate, async (req: AuthenticatedRequest, res: Response) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).send({ error: "Missing authorization code." });
  }

  try {
    const githubResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID.value(),
        client_secret: GITHUB_CLIENT_SECRET.value(),
        code,
      }),
    });

    const githubData = await githubResponse.json();

    if (githubData.error) {
      return res.status(400).send({ error: githubData.error_description });
    }

    const accessToken = githubData.access_token;

    // Use the access token to get the user's details
    const octokit = new Octokit({ auth: accessToken });
    const { data: githubUser } = await octokit.users.getAuthenticated();

    // Create or update the user in Firebase Auth
    const firebaseUser = await admin.auth().getUserByEmail(githubUser.email || "").catch(() => null);
    let uid = firebaseUser?.uid;
    if (!uid) {
        const newUser = await admin.auth().createUser({
            email: githubUser.email || '',
            displayName: githubUser.name,
            photoURL: githubUser.avatar_url,
            emailVerified: true
        });
        uid = newUser.uid;
    }

    // Store the token securely, associated with the Firebase user
    await db.collection("githubTokens").doc(uid).set({
      accessToken,
      githubUsername: githubUser.login,
      githubUserId: githubUser.id,
    }, { merge: true });

    const customToken = await admin.auth().createCustomToken(uid);

    res.status(200).send({ customToken });
  } catch (error) {
    console.error("Error exchanging code for token:", error);
    res.status(500).send({ error: "Internal server error." });
  }
});

const authenticate = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
    return res.status(403).send('Unauthorized');
  }
  const idToken = req.headers.authorization.split('Bearer ')[1];
  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedIdToken;
    next();
  } catch (e) {
    res.status(403).send('Unauthorized');
  }
};

// All routes below this require authentication
app.use(authenticate);


app.get("/repos", async (req: AuthenticatedRequest, res: Response) => {
    const { uid } = req.user!;
    try {
        const tokenDoc = await db.collection('githubTokens').doc(uid).get();
        if (!tokenDoc.exists) {
            return res.status(401).send({ error: 'GitHub token not found.' });
        }
        const { accessToken } = tokenDoc.data()!;
        const octokit = new Octokit({ auth: accessToken });
        const { data: repos } = await octokit.repos.listForAuthenticatedUser();
        res.status(200).send(repos.map(repo => ({ id: repo.id, name: repo.full_name })));
    } catch (error) {
        console.error('Error fetching repositories:', error);
        res.status(500).send({ error: 'Failed to fetch repositories.' });
    }
});

app.post("/deploy", async (req: AuthenticatedRequest, res: Response) => {
    const { repoFullName } = req.body;
    // For simplicity, we'll just log the deployment request for now.
    console.log(`Deployment requested for ${repoFullName}`);
    // In a real application, this is where you would trigger the CI/CD pipeline.
    res.status(200).send({ message: "Deployment started", validationRunId: 12345, deploymentUrl: `https://${repoFullName}.example.dev` });
});

app.get("/github/workflow-status", (req: Request, res: Response) => res.status(200).send({ status: "completed", conclusion: "success" }));
app.get("/github/workflow-logs", (req: Request, res: Response) => res.status(200).send({ logs: "Workflow completed successfully." }));
app.post("/start-jules-analysis", (req: Request, res: Response) => res.status(200).send({ julesSessionId: "jules-123" }));

app.get("/github/me", async (req: AuthenticatedRequest, res: Response) => {
    const { uid } = req.user!;
    try {
        const tokenDoc = await db.collection('githubTokens').doc(uid).get();
        if (!tokenDoc.exists) {
            return res.status(401).send({ error: 'GitHub token not found.' });
        }
        const { accessToken } = tokenDoc.data()!;
        const octokit = new Octokit({ auth: accessToken });
        const { data: user } = await octokit.users.getAuthenticated();
        res.status(200).send(user);
    } catch (error) {
        console.error('Error fetching GitHub user:', error);
        res.status(500).send({ error: 'Failed to fetch GitHub user.' });
    }
});

app.get("/github/installation-status", (req: Request, res: Response) => res.status(200).send({ isInstalled: true }));
app.get("/github/installation-and-repos", async (req: AuthenticatedRequest, res: Response) => {
    const { uid } = req.user!;
    try {
        const tokenDoc = await db.collection('githubTokens').doc(uid).get();
        if (!tokenDoc.exists) {
            return res.status(401).send({ error: 'GitHub token not found.' });
        }
        const { accessToken } = tokenDoc.data()!;
        const octokit = new Octokit({ auth: accessToken });
        const { data: repos } = await octokit.repos.listForAuthenticatedUser();
        res.status(200).send({ installed: true, repos: repos.map(repo => ({ id: repo.id, name: repo.full_name })) });
    } catch (error) {
        console.error('Error fetching repositories:', error);
        res.status(500).send({ error: 'Failed to fetch repositories.' });
    }
});

app.get("/deploy/status", (req: Request, res: Response) => res.status(200).send({ status: "completed", conclusion: "success", html_url: "https://github.com" }));

app.get("/deployments", (req: Request, res: Response) => res.status(200).send({ items: [] }));

app.post("/devai", async (req: AuthenticatedRequest, res: Response) => {
    const { prompt } = req.body;
    try {
        const genAI = new GoogleGenerativeAI(GENAI_API_KEY.value());
        const model = genAI.getGenerativeModel({ model: "gemini-pro"});
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        res.status(200).send({ text });
    } catch (error) {
        console.error("Error with DevAI:", error);
        res.status(500).send({ error: "Failed to get response from DevAI." });
    }
});

app.get("/jules/status", (req: Request, res: Response) => res.status(200).send({ session: { state: "COMPLETED" }, activities: [] }));
app.post("/jules/send", (req: Request, res: Response) => res.status(200).send({ success: true }));
app.post("/trigger-deployment", (req: Request, res: Response) => res.status(200).send({ success: true }));
app.post("/apply-patch", (req: Request, res: Response) => res.status(200).send({ success: true }));

const api = functions.https.onRequest(app);

export { api };
