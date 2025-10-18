import { auth } from '../firebase';

// Backend API base URL
// Prefer build-time env (set via Vite: VITE_API_BASE_URL), fallback to last-known URL
const baseUrl: string = (import.meta as any)?.env?.VITE_API_BASE_URL || 'https://api-mcwd6yzjia-uc.a.run.app';

async function authHeader() {
  const user = auth.currentUser;
  if (!user) throw new Error('Not authenticated');
  const idToken = await user.getIdToken();
  return { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' };
}

export async function linkGithub(accessToken: string) {
  const headers = await authHeader();
  const res = await fetch(`${baseUrl}/auth/github`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ accessToken })
  });
  if (!res.ok) throw new Error('Failed to link GitHub');
  return res.json();
}

export async function triggerDeployment(repoFullName: string): Promise<{ ok: boolean }>{
  const headers = await authHeader();
  const res = await fetch(`${baseUrl}/trigger-deployment`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ repoFullName })
  });
  if (!res.ok) {
    try {
      const data = await res.json();
      throw new Error(data?.error || 'Failed to trigger deployment');
    } catch {
      throw new Error('Failed to trigger deployment');
    }
  }
  return res.json();
}

export async function fetchRepos(): Promise<{ id: string; name: string }[]> {
  const headers = await authHeader();
  const res = await fetch(`${baseUrl}/repos`, { headers });
  if (!res.ok) throw new Error('Failed to fetch repos');
  return res.json();
}

export async function startDeployment(repoFullName: string): Promise<{ deploymentUrl: string; detectedStack: string }>{
  const headers = await authHeader();
  const res = await fetch(`${baseUrl}/deploy`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ repoFullName })
  });
  if (!res.ok) {
    try {
      const data = await res.json();
      throw new Error(data?.error || 'Failed to start deployment');
    } catch {
      throw new Error('Failed to start deployment');
    }
  }
  return res.json();
}


export async function getGithubMe(): Promise<{ login: string; name: string; avatar_url: string; html_url: string }> {
  const headers = await authHeader();
  const res = await fetch(`${baseUrl}/github/me`, { headers });
  if (!res.ok) throw new Error('Failed to load GitHub profile');
  return res.json();
}

export async function getDeployStatus(repoFullName: string): Promise<{ status: string; conclusion: string | null; html_url: string | null }>{
  const headers = await authHeader();
  const url = `${baseUrl}/deploy/status?repo=${encodeURIComponent(repoFullName)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Failed to fetch deploy status');
  return res.json();
}

export async function listDeployments(): Promise<{ repoFullName: string; url: string | null; updatedAt: string | null }[]> {
  const headers = await authHeader();
  const res = await fetch(`${baseUrl}/deployments`, { headers });
  if (!res.ok) throw new Error('Failed to list deployments');
  const data = await res.json();
  return data.items as any[];
}

export async function devAiAsk(prompt: string): Promise<string> {
  const headers = await authHeader();
  const res = await fetch(`${baseUrl}/devai`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || 'DevAI request failed');
  return data.text as string;
}

export async function getJulesStatus(sessionId: string): Promise<{ session: any; activities: any }>{
  const headers = await authHeader();
  const url = `${baseUrl}/jules/status?session=${encodeURIComponent(sessionId)}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Failed to fetch Jules status');
  return res.json();
}

export async function julesSend(sessionId: string, prompt: string): Promise<void> {
  const headers = await authHeader();
  const res = await fetch(`${baseUrl}/jules/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId, prompt })
  });
  if (!res.ok) {
    try { const data = await res.json(); throw new Error(data?.error || 'Failed to send to Jules'); }
    catch { throw new Error('Failed to send to Jules'); }
  }
}

