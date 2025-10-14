import React, { useState, useEffect, useCallback, useRef } from 'react';
import DeploymentView from './DeploymentView';
import { MOCK_DEPLOYMENT_HISTORY, MOCK_LOGS, INITIAL_DEPLOYMENT_STEPS } from '../constants';
import { DeploymentHistoryEntry, LogEntry, DeploymentStep, DeploymentStatus } from '../types';
import { GoogleGenAI } from "@google/genai";
import { fetchRepos, startDeployment, getGithubMe, getDeployStatus, devAiAsk, getJulesStatus, julesSend } from '../src/api';
import { auth, observeAuthState, signInWithGitHub } from '../firebase';
import { updateProfile } from 'firebase/auth';
import { linkGithub } from '../src/api';

type Page = 'new_deployment' | 'deployments' | 'dev_ai' | 'logs' | 'settings';

// --- Reusable Card Component ---
const Card: React.FC<{children: React.ReactNode, className?: string}> = ({children, className}) => (
    <div className={`bg-white p-4 sm:p-6 rounded-2xl shadow-lg border border-gray-200 ${className || ''}`}>
        {children}
    </div>
);

// --- New Page Components ---

const DeploymentsHistory: React.FC<{ 
    deployments: DeploymentHistoryEntry[],
    onRedeploy: (repoName: string) => void,
    onViewLogs: (deploymentId: string) => void,
    onDelete: (id: string) => void,
}> = ({ deployments, onRedeploy, onViewLogs, onDelete }) => {
    
    if (deployments.length === 0) {
        return (
            <div>
                 <h2 className="text-2xl font-bold text-slate-900 mb-6">Deployment History</h2>
                 <div className="text-center bg-white border-2 border-dashed border-slate-300 rounded-2xl p-8 sm:p-12">
                    <span className="material-symbols-outlined text-5xl text-slate-400">deployed_code</span>
                    <h3 className="mt-4 text-xl font-medium text-slate-800">No Deployments Yet</h3>
                    <p className="mt-2 text-slate-500">Your deployment history will appear here once you deploy a repository.</p>
                 </div>
            </div>
        );
    }

    const ActionButton: React.FC<{icon: string, label: string, onClick: () => void}> = ({icon, label, onClick}) => (
        <button 
            onClick={onClick}
            title={label}
            className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
        >
            <span className="material-symbols-outlined text-base">{icon}</span>
            <span className="hidden sm:inline">{label}</span>
        </button>
    );

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Deployment History</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {deployments.map((dep: DeploymentHistoryEntry) => (
                    <Card key={dep.id} className="flex flex-col">
                        <div className="flex-grow">
                            <div className="flex justify-between items-start mb-3">
                                <div>
                                    <p className="font-bold text-lg text-slate-800 break-all">{dep.repoName}</p>
                                    <p className="text-xs text-slate-500 font-mono flex items-center gap-1">
                                        <span className="material-symbols-outlined text-sm">commit</span>
                                        <span className="truncate">{dep.commitHash}</span>
                                    </p>
                                </div>
                                {dep.status === 'Success' ? (
                                    <span className="shrink-0 ml-2 inline-flex items-center gap-1.5 py-1 px-3 rounded-full text-xs font-medium bg-green-100 text-green-800">
                                        <span className="w-2 h-2 rounded-full bg-green-500"></span> Success
                                    </span>
                                ) : (
                                    <span className="shrink-0 ml-2 inline-flex items-center gap-1.5 py-1 px-3 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                        <span className="w-2 h-2 rounded-full bg-red-500"></span> Failed
                                    </span>
                                )}
                            </div>
                            <div className="text-sm text-slate-600 space-y-2">
                                <p className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-base text-slate-400">schedule</span>
                                    <span>{dep.deployedAt}</span>
                                </p>
                                {dep.status === 'Success' && dep.url && (
                                    <p className="flex items-start gap-2">
                                        <span className="material-symbols-outlined text-base text-slate-400 mt-0.5">link</span>
                                        <a href={dep.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline break-all">{dep.url}</a>
                                    </p>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-1 border-t border-slate-200 mt-4 pt-3 -mb-2 -mx-2 sm:-mx-4 px-2 sm:px-4">
                            {dep.status === 'Success' && dep.url && (
                                <a 
                                    href={dep.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    title="Visit Site"
                                    className="flex items-center gap-2 py-2 px-3 rounded-lg text-sm text-blue-600 hover:bg-blue-50 font-medium transition-colors"
                                >
                                    <span className="material-symbols-outlined text-base">open_in_new</span>
                                    <span className="hidden sm:inline">Visit Site</span>
                                </a>
                            )}
                            <div className="flex-grow"></div>
                            <ActionButton icon="replay" label="Redeploy" onClick={() => onRedeploy(dep.repoName)} />
                            <ActionButton icon="receipt_long" label="Logs" onClick={() => onViewLogs(dep.id)} />
                            <ActionButton icon="delete" label="Delete" onClick={() => onDelete(dep.id)} />
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
};

const LogsPage: React.FC<{ logs: LogEntry[], filter: string, onFilterChange: (value: string) => void }> = ({ logs, filter, onFilterChange }) => {
    const filteredLogs = logs.filter(log => 
        !filter || 
        log.deploymentId.toLowerCase().includes(filter.toLowerCase()) || 
        log.message.toLowerCase().includes(filter.toLowerCase())
    );
    
    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Application Logs</h2>
            <Card>
                <div className="mb-4">
                    <input 
                        type="text" 
                        placeholder="Filter by deployment ID or message..." 
                        value={filter}
                        onChange={e => onFilterChange(e.target.value)}
                        className="w-full p-2 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-600 transition" />
                </div>
                <div className="bg-slate-900 p-4 rounded-lg font-mono text-sm text-white/90 max-h-[40rem] overflow-y-auto overflow-x-auto">
                    {filteredLogs.length > 0 ? filteredLogs.map((log: LogEntry) => (
                        <p key={log.id} className="flex flex-wrap gap-x-4 whitespace-nowrap">
                            <span className="text-white/40">{log.timestamp}</span>
                            <span className={`${log.level === 'ERROR' ? 'text-red-400' : log.level === 'WARN' ? 'text-yellow-400' : 'text-green-400'}`}>{log.level}</span>
                            <span>{log.message}</span>
                            <span className="text-white/30">(ID: {log.deploymentId})</span>
                        </p>
                    )) : (
                        <p className="text-slate-400">No logs found. Run a deployment to see logs here.</p>
                    )}
                </div>
            </Card>
        </div>
    );
};

interface Message {
    role: 'user' | 'model';
    content: string;
}

const DevAiPage: React.FC = () => {
    const [messages, setMessages] = useState<Message[]>([
        { role: 'model', content: "Hello! I'm DevAI, your assistant for Devyntra. How can I help you today? Ask me about features, deployments, or how to get started." }
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, isLoading]);

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;

        const userMessage: Message = { role: 'user', content: input };
        setMessages(prev => [...prev, userMessage]);
        setInput('');
        setIsLoading(true);

        try {
            const text = await devAiAsk(input);
            const aiResponse: Message = { role: 'model', content: text };
            setMessages(prev => [...prev, aiResponse]);
        } catch (error) {
            console.error("Error calling Gemini API:", error);
            const errorMessage: Message = { role: 'model', content: "Sorry, I'm having trouble connecting right now. Please try again later." };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="max-w-3xl mx-auto h-full flex flex-col">
            <h2 className="text-2xl font-bold text-slate-900 mb-6 shrink-0">DevAI Assistant</h2>
            <div className="flex-1 flex flex-col bg-white rounded-2xl shadow-lg border border-gray-200 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 space-y-6 hide-scrollbar">
                    {messages.map((msg, index) => (
                        <div key={index} className={`flex items-start gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                            {msg.role === 'model' && <span className="material-symbols-outlined text-3xl text-blue-600 shrink-0">smart_toy</span>}
                            <div className={`max-w-lg p-3 px-4 rounded-2xl break-words ${msg.role === 'user' ? 'bg-blue-600 text-white rounded-br-none' : 'bg-slate-100 text-slate-800 rounded-bl-none'}`}>
                                <p className="text-sm leading-relaxed">{msg.content}</p>
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                         <div className="flex items-start gap-3">
                            <span className="material-symbols-outlined text-3xl text-blue-600 shrink-0">smart_toy</span>
                            <div className="max-w-lg p-3 px-4 rounded-2xl bg-slate-100 text-slate-800 rounded-bl-none">
                                <div className="flex items-center gap-2">
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: '0s' }}></span>
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }}></span>
                                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }}></span>
                                </div>
                            </div>
                        </div>
                    )}
                    <div ref={messagesEndRef} />
                </div>
                <div className="p-4 border-t border-slate-200 bg-white">
                    <form onSubmit={handleSendMessage} className="flex items-center gap-3">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder="Ask about Devyntra..."
                            className="flex-grow p-3 bg-slate-50 border border-slate-300 rounded-full focus:ring-2 focus:ring-blue-500 focus:border-blue-600 transition disabled:bg-slate-100"
                            disabled={isLoading}
                            autoFocus
                        />
                        <button
                            type="submit"
                            disabled={isLoading || !input.trim()}
                            className="w-12 h-12 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed shrink-0"
                            aria-label="Send message"
                        >
                            <span className="material-symbols-outlined">send</span>
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
};


import { User } from 'firebase/auth';

const SettingsPage: React.FC<{ userName?: string; userPhoto?: string; userEmail?: string; onNameUpdated: (name: string) => void; }> = ({ userName, userPhoto, userEmail, onNameUpdated }) => {
    const [nameInput, setNameInput] = useState<string>(userName || '');
    const [isSavingName, setIsSavingName] = useState(false);
    const [nameError, setNameError] = useState<string>('');

    const [ghLoading, setGhLoading] = useState<boolean>(true);
    const [ghError, setGhError] = useState<string>('');
    const [ghProfile, setGhProfile] = useState<{ login: string; name: string; avatar_url: string; html_url: string } | null>(null);

    useEffect(() => { setNameInput(userName || ''); }, [userName]);

    useEffect(() => {
        (async () => {
            try {
                setGhLoading(true);
                const me = await getGithubMe();
                setGhProfile(me);
                setGhError('');
            } catch (e) {
                setGhError('GitHub not connected');
                setGhProfile(null);
            } finally {
                setGhLoading(false);
            }
        })();
    }, []);

    const handleSaveName = async () => {
        if (!auth.currentUser) return;
        const newName = nameInput.trim();
        if (!newName) { setNameError('Name cannot be empty'); return; }
        try {
            setIsSavingName(true);
            setNameError('');
            await updateProfile(auth.currentUser, { displayName: newName });
            onNameUpdated(newName);
        } catch (e) {
            setNameError('Failed to save name');
        } finally {
            setIsSavingName(false);
        }
    };

    const handleReconnectGithub = async () => {
        try {
            const { githubAccessToken } = await signInWithGitHub();
            if (githubAccessToken) {
                await linkGithub(githubAccessToken);
                const me = await getGithubMe();
                setGhProfile(me);
                setGhError('');
            }
        } catch (e) {
            setGhError('Failed to reconnect GitHub');
        }
    };

    return (
        <div>
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Settings</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <Card>
                    <h3 className="text-lg font-medium mb-4">Profile</h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Name</label>
                            <input type="text" value={nameInput} onChange={(e) => setNameInput(e.target.value)} className="w-full p-2 bg-white border border-slate-300 rounded-lg" />
                            {nameError && <p className="text-sm text-red-600 mt-1">{nameError}</p>}
                            <button onClick={handleSaveName} disabled={isSavingName} className="mt-3 bg-blue-600 text-white py-2 px-4 rounded-full disabled:bg-slate-400">{isSavingName ? 'Saving...' : 'Save'}</button>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Email</label>
                            <input type="email" value={userEmail || ''} disabled className="w-full p-2 bg-gray-100 border border-slate-300 rounded-lg" />
                        </div>
                        {userPhoto && (
                          <div className="flex items-center gap-3">
                            <img src={userPhoto} alt="Avatar" className="w-12 h-12 rounded-full" />
                            <span className="text-slate-600 text-sm">Avatar</span>
                          </div>
                        )}
                    </div>
                </Card>
                 <Card>
                    <h3 className="text-lg font-medium mb-4">GitHub Integration</h3>
                    <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-lg">
                        <img src={ghProfile?.avatar_url || 'https://picsum.photos/40/40'} alt="GitHub Avatar" className="w-10 h-10 rounded-full" />
                        <div>
                            <p className="font-medium">{ghLoading ? 'Loading…' : (ghProfile?.name || ghProfile?.login || 'Not connected')}</p>
                            <p className="text-sm text-slate-500">{ghError ? ghError : 'Connected via GitHub OAuth'}</p>
                        </div>
                    </div>
                    <div className="flex gap-2 mt-4">
                      <a href={ghProfile?.html_url || '#'} target={ghProfile?.html_url ? '_blank' : undefined} rel="noopener noreferrer" className="flex-1 text-center bg-blue-100 text-blue-800 font-medium py-2 px-4 rounded-full hover:bg-blue-200">Manage on GitHub</a>
                      <button onClick={handleReconnectGithub} className="px-4 py-2 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-800">Reconnect</button>
                    </div>
                </Card>
            </div>
        </div>
    );
};


// --- Main Layout Components ---

const Sidebar: React.FC<{ 
    isCollapsed: boolean; 
    onToggle: () => void; 
    activePage: Page; 
    onNavigate: (page: Page) => void; 
    isDeploying: boolean;
    isMobileOpen: boolean;
}> = ({ isCollapsed, onToggle, activePage, onNavigate, isDeploying, isMobileOpen }) => {
    
    const NavItem: React.FC<{ page: Page; icon: string; label: string; showIndicator?: boolean }> = ({ page, icon, label, showIndicator }) => (
         <li>
            <a href="#" onClick={(e) => { e.preventDefault(); onNavigate(page); }} 
               className={`flex items-center gap-3 p-3 rounded-full font-medium transition-colors ${activePage === page ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100'}`}>
                <span className="material-symbols-outlined text-2xl">{icon}</span>
                <span className={`flex-1 whitespace-nowrap ${isCollapsed ? 'md:hidden' : ''}`}>{label}</span>
                 {showIndicator && (
                    <span className={`w-2 h-2 bg-blue-500 rounded-full animate-pulse ${isCollapsed ? 'md:hidden' : ''}`} aria-label="Deployment in progress"></span>
                )}
            </a>
        </li>
    );

    return (
        <aside className={`bg-white border-r border-slate-200 flex flex-col fixed inset-y-0 left-0 z-40 w-64 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isMobileOpen ? 'translate-x-0' : '-translate-x-full'} ${isCollapsed ? 'md:w-20' : 'md:w-64'}`}>
             <div className="h-16 flex items-center shrink-0 px-4 justify-between">
                 <div className={`flex items-center overflow-hidden ${isCollapsed ? 'md:justify-center md:w-full' : ''}`}>
                    <span className="material-symbols-outlined text-3xl text-blue-600 shrink-0">data_object</span>
                    <span className={`text-xl font-bold ml-2 truncate ${isCollapsed ? 'md:hidden' : ''}`}>Devyntra</span>
                 </div>
                 <button onClick={onToggle} className="p-2 rounded-full hover:bg-black/10 hidden md:inline-block">
                    <span className="material-symbols-outlined text-2xl text-slate-500">menu</span>
                </button>
            </div>
            <nav className="flex-grow p-2">
                <ul className="space-y-2">
                   <NavItem page="new_deployment" icon="rocket_launch" label="New Deployment" showIndicator={isDeploying} />
                   <NavItem page="deployments" icon="history" label="Deployments" />
                   <NavItem page="dev_ai" icon="smart_toy" label="DevAI" />
                   <NavItem page="logs" icon="receipt_long" label="Logs" />
                   <NavItem page="settings" icon="settings" label="Settings" />
                </ul>
            </nav>
            <div className={`p-2 shrink-0 hidden md:block ${isCollapsed ? 'md:hidden' : ''}`}>
                 <button onClick={onToggle} className="flex items-center gap-3 w-full p-3 rounded-full text-slate-600 hover:bg-slate-100">
                    <span className="material-symbols-outlined text-2xl">chevron_left</span>
                    <span>Collapse</span>
                </button>
            </div>
        </aside>
    );
};

const Header: React.FC<{onLogout: () => void; pageTitle: string; onMobileMenuClick: () => void; userName: string; userPhoto: string}> = ({onLogout, pageTitle, onMobileMenuClick, userName, userPhoto}) => {
    return (
        <header className="h-16 bg-white/80 backdrop-blur-sm border-b border-slate-200/80 flex items-center justify-between px-4 sm:px-6 shrink-0">
            <div className="flex items-center gap-2">
                <button onClick={onMobileMenuClick} className="p-2 rounded-full text-slate-600 hover:bg-slate-200 md:hidden -ml-2">
                     <span className="material-symbols-outlined">menu</span>
                </button>
                <h1 className="text-xl font-medium text-slate-900">{pageTitle}</h1>
            </div>
            <div className="flex items-center gap-4">
                <span className="text-sm hidden sm:block">{userName || 'Signed In'}</span>
                <img src={userPhoto || 'https://picsum.photos/40/40'} alt="User Avatar" className="w-8 h-8 rounded-full" />
                <button onClick={onLogout} title="Logout" className="p-2 rounded-full hover:bg-gray-200">
                     <span className="material-symbols-outlined text-slate-500">logout</span>
                </button>
            </div>
        </header>
    );
};

const Dashboard: React.FC<{onLogout: () => void}> = ({onLogout}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [activePage, setActivePage] = useState<Page>('new_deployment');
  const [deploymentHistory, setDeploymentHistory] = useState<DeploymentHistoryEntry[]>(MOCK_DEPLOYMENT_HISTORY);
  const [logs, setLogs] = useState<LogEntry[]>(MOCK_LOGS);
  const [logFilter, setLogFilter] = useState('');
  const [userName, setUserName] = useState<string>('');
  const [userPhoto, setUserPhoto] = useState<string>('');

  // State lifted from DeploymentView
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [repos, setRepos] = useState<{ id: string; name: string }[]>([]);
  const [needsGithubAuth, setNeedsGithubAuth] = useState<boolean>(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [deploymentSteps, setDeploymentSteps] = useState<DeploymentStep[]>(JSON.parse(JSON.stringify(INITIAL_DEPLOYMENT_STEPS)));
  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [deployedLink, setDeployedLink] = useState<string | null>(null);
  const [deployError, setDeployError] = useState<string>('');
  const [workflowStatus, setWorkflowStatus] = useState<string>('');
  const [workflowConclusion, setWorkflowConclusion] = useState<string | null>(null);
  const [workflowUrl, setWorkflowUrl] = useState<string | null>(null);
  const [pendingDeploymentUrl, setPendingDeploymentUrl] = useState<string | null>(null);
  const [julesSessionId, setJulesSessionId] = useState<string | null>(null);
  const [deployStartedAt, setDeployStartedAt] = useState<number>(0);
  const [sawInProgress, setSawInProgress] = useState<boolean>(false);
  const MIN_ANIMATION_MS = 15000;
  const [lastStepAdvanceAt, setLastStepAdvanceAt] = useState<number>(0);
  const [lastJulesMessage, setLastJulesMessage] = useState<string>('');

  const pageTitles: Record<Page, string> = {
      new_deployment: 'New Deployment',
      deployments: 'Deployment History',
      dev_ai: 'DevAI Assistant',
      logs: 'Application Logs',
      settings: 'Settings'
  };
  
  const handleNavigate = (page: Page) => {
    if (page !== 'logs') {
      setLogFilter('');
    }
    // Prevent navigation away during active deployment; show logs/settings allowed
    const canNavigate = !isDeploying || page === 'logs' || page === 'settings' || page === 'new_deployment';
    if (!canNavigate) return;
    setActivePage(page);
    setIsMobileSidebarOpen(false); // Close mobile sidebar on navigation
  };

  const resetState = useCallback(() => {
    setIsDeploying(false);
    setDeploymentSteps(JSON.parse(JSON.stringify(INITIAL_DEPLOYMENT_STEPS)));
    setCurrentStepIndex(-1);
    setDeployedLink(null);
  }, []);
  
  const handleNewDeployment = () => {
      setSelectedRepo('');
      resetState();
  }

  useEffect(() => {
    const unsub = observeAuthState((user) => {
      setUserName(user?.displayName || user?.email || '');
      setUserPhoto(user?.photoURL || '');
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    (async () => {
      if (!auth.currentUser) return;
      try {
        const list = await fetchRepos();
        setRepos(list);
        setNeedsGithubAuth(false);
      } catch (e) {
        console.error('Failed to fetch repos', e);
        setNeedsGithubAuth(true);
      }
    })();
  }, []);

  const handleDeploy = async () => {
    if (!selectedRepo || isDeploying) return;
    resetState();
    setIsDeploying(true);
    try {
      setDeployError('');
      const result = await startDeployment(selectedRepo);
      setPendingDeploymentUrl(result.deploymentUrl);
      if ((result as any).julesSessionId) setJulesSessionId((result as any).julesSessionId);
      // Enrich first steps with detected framework
      const framework = (result as any).detectedFramework as string | undefined;
      // Start at first step with running state
      const fresh = JSON.parse(JSON.stringify(INITIAL_DEPLOYMENT_STEPS)) as DeploymentStep[];
      if (fresh.length > 0) {
        fresh[0].status = DeploymentStatus.RUNNING;
        if (framework) {
          fresh[0].log = `repository_scan_initiated... detected ${framework}.`;
          fresh[0].details = `Detected ${framework} project.`;
        }
      }
      setDeploymentSteps(fresh);
      setCurrentStepIndex(0);
      setDeployStartedAt(Date.now());
      setSawInProgress(false);
      setLastStepAdvanceAt(Date.now());
    } catch (e) {
      const message = (e as Error)?.message || 'Deployment failed';
      console.error('Deployment failed', e);
      if (message.toLowerCase().includes('github not linked')) {
        setNeedsGithubAuth(true);
        setDeployError('GitHub is not authorized. Please authorize to continue.');
      } else {
        setDeployError(message);
      }
      setIsDeploying(false);
    }
  };
  
  const handleDeploymentComplete = (newDeployment: DeploymentHistoryEntry, newLogs: LogEntry[]) => {
      setDeploymentHistory(prev => [newDeployment, ...prev]);
      setLogs(prev => [...newLogs, ...prev]);
  };

  const handleDeleteDeployment = useCallback((id: string) => {
    if (window.confirm('Are you sure you want to delete this deployment history? This action cannot be undone.')) {
        setDeploymentHistory(prev => prev.filter(dep => dep.id !== id));
        // Also remove associated logs for cleanliness
        setLogs(prev => prev.filter(log => log.deploymentId !== id));
    }
  }, []);

  const handleRedeploy = useCallback((repoName: string) => {
      setActivePage('new_deployment');
      setSelectedRepo(repoName);
      resetState(); // This clears the deployment UI for the new deployment
  }, [resetState]);

  const handleViewLogs = useCallback((deploymentId: string) => {
      setLogFilter(deploymentId);
      setActivePage('logs');
  }, []);

  // Real-time polling of GitHub Actions run status
  useEffect(() => {
    if (!isDeploying || !selectedRepo) return;
    let isCancelled = false;
    let interval: any;

    const updateStepsForStatus = (status: string, conclusion: string | null) => {
      setDeploymentSteps(prev => {
        const steps = [...prev];
        // Basic mapping for visual feedback
        // 0: Prepare project, 1: Generate CI, 2: Build & Test, 3: Docker Build & Push, 4: Deploy
        if (status === 'queued') {
          steps.forEach((s, idx) => { s.status = idx === 0 ? DeploymentStatus.RUNNING : (s.status === DeploymentStatus.COMPLETED ? DeploymentStatus.COMPLETED : DeploymentStatus.PENDING); });
          setCurrentStepIndex(0);
        } else if (status === 'in_progress') {
          setSawInProgress(true);
          const now = Date.now();
          const canAdvance = now - (lastStepAdvanceAt || 0) > 3000; // advance every 3s
          if (canAdvance) {
            setLastStepAdvanceAt(now);
            setCurrentStepIndex(idx => {
              const nextIdx = Math.min(idx + 1, steps.length - 1);
              // complete previous
              if (idx >= 0 && idx < steps.length) steps[idx].status = DeploymentStatus.COMPLETED;
              // set running next
              if (nextIdx < steps.length) steps[nextIdx].status = DeploymentStatus.RUNNING;
              // attach latest live message to running step
              if (nextIdx < steps.length && lastJulesMessage) {
                steps[nextIdx].log = lastJulesMessage;
              }
              return nextIdx;
            });
          }
        } else if (status === 'completed') {
          if (conclusion === 'success') {
            // complete the current running step
            const runningIdx = steps.findIndex(s => s.status === DeploymentStatus.RUNNING);
            if (runningIdx >= 0) steps[runningIdx].status = DeploymentStatus.COMPLETED;
            // enrich final step with run URL if available
            const deployIdx = steps.findIndex(s => s.title.toLowerCase().includes('deploy to production'));
            if (deployIdx >= 0 && workflowUrl) {
              steps[deployIdx].details = 'Workflow completed successfully.';
              steps[deployIdx].log = `actions_run_url: ${workflowUrl}`;
            }
          } else {
            // Mark the current running step as failed
            const idx = steps.findIndex(s => s.status === DeploymentStatus.RUNNING) >= 0 ? steps.findIndex(s => s.status === DeploymentStatus.RUNNING) : steps.length - 1;
            if (idx >= 0) steps[idx].status = DeploymentStatus.FAILED;
          }
        }
        return steps;
      });
    };

    const poll = async () => {
      try {
        const res = await getDeployStatus(selectedRepo);
        if (isCancelled) return;
        setWorkflowStatus(res.status);
        setWorkflowConclusion(res.conclusion);
        setWorkflowUrl(res.html_url);
        updateStepsForStatus(res.status, res.conclusion);

          if (res.status === 'completed') {
          if (res.conclusion === 'success') {
            const deploymentUrlToUse = pendingDeploymentUrl || undefined;
            // Only show link if we actually saw progress or at least 10s elapsed
            const elapsed = Date.now() - (deployStartedAt || Date.now());
            const canReveal = sawInProgress || elapsed > 10000;
            if (deploymentUrlToUse && canReveal) setDeployedLink(deploymentUrlToUse);
            const newDeploymentEntry: DeploymentHistoryEntry = {
              id: `dep_${Date.now()}`,
              repoName: selectedRepo,
              status: 'Success',
              deployedAt: new Date().toLocaleString(),
              commitHash: (Math.random() + 1).toString(36).substring(7),
              url: deploymentUrlToUse || undefined
            } as any;
            const now = new Date();
            const newLogEntries: LogEntry[] = [
              { id: `log_${Date.now()}_start`, deploymentId: newDeploymentEntry.id, timestamp: now.toISOString().replace('T',' ').substring(0,19), level: 'INFO', message: `Workflow completed successfully.` },
            ];
            handleDeploymentComplete(newDeploymentEntry, newLogEntries);
          } else {
            const linkText = workflowUrl ? 'View workflow run' : '';
            setDeployError(`GitHub workflow failed. ${linkText}`.trim());
              // Ask Jules to fix and push, then the user can click Deploy again
              if (julesSessionId) {
                try {
                  await julesSend(julesSessionId, 'CI failed. Please fix the issues, commit, and push to the default branch, then reply DONE.');
                } catch {}
              }
          }
          // Enforce minimum animation duration
          const elapsed = Date.now() - (deployStartedAt || Date.now());
          const canFinish = sawInProgress || elapsed >= MIN_ANIMATION_MS;
          if (canFinish) {
            setIsDeploying(false);
          }
          clearInterval(interval);
        }
      } catch (e) {
        if (!isCancelled) {
          console.error('Status polling error', e);
        }
      }
    };

    // Kickoff immediately, then poll
    poll();
    interval = setInterval(poll, 5000);

    return () => { isCancelled = true; if (interval) clearInterval(interval); };
  }, [isDeploying, selectedRepo, pendingDeploymentUrl]);

  // Poll Jules activities for live logs
  useEffect(() => {
    if (!isDeploying || !julesSessionId) return;
    let isCancelled = false;
    let interval: any;
    const pollJules = async () => {
      try {
        const data = await getJulesStatus(julesSessionId);
        if (isCancelled) return;
        const activities = (data.activities?.activities || []) as any[];
        if (activities.length) {
          const now = new Date();
          const newLogs: LogEntry[] = activities.slice(0, 5).map((a, idx) => ({
            id: `jules_${Date.now()}_${idx}`,
            deploymentId: `dep_${selectedRepo}`,
            timestamp: new Date(now.getTime() - idx * 1000).toISOString().replace('T',' ').substring(0,19),
            level: 'INFO',
            message: (a?.summary || a?.title || a?.state || 'Activity update') as string
          }));
          setLogs(prev => [...newLogs, ...prev]);
          // update currently running step's log with latest activity summary
          const latest = (activities[0]?.summary || activities[0]?.title || activities[0]?.state) as string | undefined;
          if (latest) setLastJulesMessage(latest);
          setDeploymentSteps(prev => {
            const steps = [...prev];
            const runningIdx = steps.findIndex(s => s.status === DeploymentStatus.RUNNING);
            if (runningIdx >= 0 && latest) steps[runningIdx].log = latest;
            return steps;
          });
        }
      } catch {}
    };
    pollJules();
    interval = setInterval(pollJules, 4000);
    return () => { isCancelled = true; if (interval) clearInterval(interval); };
  }, [isDeploying, julesSessionId, selectedRepo]);


  const renderContent = () => {
      switch (activePage) {
          case 'new_deployment': return <DeploymentView 
            selectedRepo={selectedRepo}
            onRepoSelect={setSelectedRepo}
            isDeploying={isDeploying}
            deploymentSteps={deploymentSteps}
            currentStepIndex={currentStepIndex}
            deployedLink={deployedLink}
            onDeploy={handleDeploy}
            onNewDeployment={handleNewDeployment}
            repos={repos}
            error={deployError}
            needsGithubAuth={needsGithubAuth}
            onAuthorizeGithub={async () => {
              try {
                const { githubAccessToken } = await signInWithGitHub();
                if (githubAccessToken) {
                  await linkGithub(githubAccessToken);
                  const list = await fetchRepos();
                  setRepos(list);
                  setNeedsGithubAuth(false);
                }
              } catch (e) {
                setNeedsGithubAuth(true);
              }
            }}
            />;
          case 'deployments': return <DeploymentsHistory 
            deployments={deploymentHistory}
            onDelete={handleDeleteDeployment}
            onRedeploy={handleRedeploy}
            onViewLogs={handleViewLogs}
            />;
          case 'dev_ai': return <DevAiPage />;
          case 'logs': return <LogsPage 
            logs={logs}
            filter={logFilter}
            onFilterChange={setLogFilter} 
            />;
          case 'settings': return <SettingsPage userName={userName} userPhoto={userPhoto} userEmail={auth.currentUser?.email || ''} onNameUpdated={(n) => setUserName(n)} />;
          default: return <DeploymentView 
            selectedRepo={selectedRepo}
            onRepoSelect={setSelectedRepo}
            isDeploying={isDeploying}
            deploymentSteps={deploymentSteps}
            currentStepIndex={currentStepIndex}
            deployedLink={deployedLink}
            onDeploy={handleDeploy}
            onNewDeployment={handleNewDeployment}
            repos={repos}
            error={deployError}
            needsGithubAuth={needsGithubAuth}
          />;
      }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
       {isMobileSidebarOpen && (
        <div 
            className="fixed inset-0 bg-black/30 z-30 md:hidden" 
            onClick={() => setIsMobileSidebarOpen(false)}
            aria-hidden="true"
        ></div>
       )}
      <Sidebar 
        isCollapsed={isSidebarCollapsed} 
        onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        activePage={activePage}
        onNavigate={handleNavigate}
        isDeploying={isDeploying}
        isMobileOpen={isMobileSidebarOpen}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header 
            onLogout={onLogout} 
            pageTitle={pageTitles[activePage]}
            onMobileMenuClick={() => setIsMobileSidebarOpen(true)}
            userName={userName}
            userPhoto={userPhoto}
        />
        <main className="flex-1 overflow-y-auto p-4 md:p-8">
          {activePage === 'new_deployment' && (
            <DeploymentView 
              selectedRepo={selectedRepo}
              onRepoSelect={setSelectedRepo}
              isDeploying={isDeploying}
              deploymentSteps={deploymentSteps}
              currentStepIndex={currentStepIndex}
              deployedLink={deployedLink}
              onDeploy={handleDeploy}
              onNewDeployment={handleNewDeployment}
              repos={repos}
              error={deployError}
              needsGithubAuth={needsGithubAuth}
              onAuthorizeGithub={async () => {
                try {
                  const { githubAccessToken } = await signInWithGitHub();
                  if (githubAccessToken) {
                    await linkGithub(githubAccessToken);
                    const list = await fetchRepos();
                    setRepos(list);
                    setNeedsGithubAuth(false);
                  }
                } catch (e) {
                  setNeedsGithubAuth(true);
                }
              }}
            />
          )}
          {activePage !== 'new_deployment' && renderContent()}
        </main>
      </div>
    </div>
  );
};

export default Dashboard;