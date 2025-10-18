import { initializeApp } from 'firebase/app';
import { getAuth, GithubAuthProvider, signInWithPopup, onAuthStateChanged, User } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyDYfGFH5-tMEGVoPsTqBgHYX4qcZbY8WkE",
  authDomain: "devyntra-500e4.firebaseapp.com",
  projectId: "devyntra-500e4",
  storageBucket: "devyntra-500e4.firebasestorage.app",
  messagingSenderId: "583516794481",
  appId: "1:583516794481:web:ffd1dcc966bb04f27275d0",
  measurementId: "G-SWF3LQFBR0"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

export const githubProvider = new GithubAuthProvider();
githubProvider.addScope('repo');
githubProvider.addScope('workflow');
githubProvider.setCustomParameters({ allow_signup: 'true' });

export async function signInWithGitHub() {
  const GITHUB_APP_CLIENT_ID = 'Iv23li892YlZShywCzP3';
  const redirect_uri = `https://devyntra-500e4.web.app/auth/callback`;
  const url = `https://github.com/login/oauth/authorize?client_id=${GITHUB_APP_CLIENT_ID}&redirect_uri=${encodeURIComponent(
    redirect_uri
  )}&scope=repo,workflow`;
  window.location.href = url;
}

export function observeAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}


