import React, { useState, useCallback, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import { observeAuthState, signInWithGitHub, auth } from './firebase';
import { signOut } from 'firebase/auth';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const unsub = observeAuthState((user) => {
      setIsAuthenticated(!!user);
      setAuthChecked(true);
    });
    return () => unsub();
  }, []);

  const handleLogin = useCallback(async () => {
    try {
      await signInWithGitHub();
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

  if (!authChecked) {
    return <div>Loading...</div>; // Or a proper spinner component
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {isAuthenticated ? <Dashboard onLogout={handleLogout} /> : <LandingPage onLogin={handleLogin} isAuthenticated={isAuthenticated} />}
    </div>
  );
};

export default App;