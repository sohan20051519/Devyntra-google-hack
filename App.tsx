import React, { useState, useCallback, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import Dashboard from './components/Dashboard';
import { observeAuthState, signInWithGitHub, auth } from './firebase';
import { signOut } from 'firebase/auth';
import { exchangeCodeForToken } from './src/api';

const App: React.FC = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const handleAuthCallback = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const code = urlParams.get('code');
      if (code) {
        try {
          await exchangeCodeForToken(code);
          // The backend now has the token, Firebase auth state will change
          window.history.replaceState({}, document.title, "/"); // Clean URL
        } catch (error) {
          console.error("Failed to exchange code for token:", error);
          // Handle error state in UI if necessary
        }
      }
      setAuthChecked(true);
    };

    handleAuthCallback();

    const unsub = observeAuthState((user) => {
      setIsAuthenticated(!!user);
      setAuthChecked(true); // Also mark as checked when auth state is known
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