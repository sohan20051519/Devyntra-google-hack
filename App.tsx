import React, { useState, useCallback, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import { observeAuthState, signInWithGitHub, auth } from './firebase';
import { signOut } from 'firebase/auth';
import { linkGithub } from './src/api';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    const unsub = observeAuthState((user) => {
      setIsAuthenticated(!!user);
    });
    return () => unsub();
  }, []);

  const handleLogin = useCallback(async () => {
    try {
      const { githubAccessToken } = await signInWithGitHub();
      if (githubAccessToken) {
        await linkGithub(githubAccessToken);
      }
    } catch (e) {
      console.error('GitHub sign-in failed', e);
    }
  }, []);
  
  const handleLogout = useCallback(async () => {
    try {
      await signOut(auth);
      setIsAuthenticated(false);
    } catch (e) {
      console.error('Sign out failed', e);
    }
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {isAuthenticated ? <Dashboard onLogout={handleLogout} /> : <LandingPage onLogin={handleLogin} isAuthenticated={isAuthenticated} />}
    </div>
  );
};

export default App;