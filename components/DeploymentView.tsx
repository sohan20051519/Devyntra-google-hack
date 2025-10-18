import React from 'react';
import { DeploymentStep, DeploymentStatus } from '../types';
import { SpinnerIcon, CheckCircleIcon, DotIcon, TerminalIcon, RocketLaunchIcon } from './icons/IconComponents';

const DeploymentStepItem: React.FC<{ step: DeploymentStep; isActive: boolean }> = ({ step, isActive }) => {
  const getStatusIcon = () => {
    switch (step.status) {
      case DeploymentStatus.RUNNING:
        return <SpinnerIcon className="w-6 h-6 text-blue-600 animate-spin" />;
      case DeploymentStatus.COMPLETED:
        return <CheckCircleIcon className="w-6 h-6 text-green-600" style={{fontVariationSettings: "'FILL' 1"}} />;
      case DeploymentStatus.FAILED:
        return <span className="material-symbols-outlined text-red-500">error</span>;
      default:
        return <DotIcon className="w-6 h-6 text-gray-400" />;
    }
  };

  return (
    <div className={`p-4 rounded-lg transition-all duration-500 ${isActive ? 'bg-blue-50/70' : ''}`}>
      <div className="flex items-start sm:items-center gap-4">
        <div className="flex items-center justify-center w-8 h-8 shrink-0 mt-1 sm:mt-0">{getStatusIcon()}</div>
        <div>
          <h4 className={`font-medium ${step.status !== DeploymentStatus.PENDING ? 'text-slate-800' : 'text-gray-500'}`}>{step.title}</h4>
          <p className="text-sm text-slate-600">{step.details}</p>
        </div>
      </div>
      {isActive && step.log && step.status === DeploymentStatus.RUNNING && (
        <div className="mt-3 ml-4 sm:ml-12 p-3 bg-slate-100 rounded-lg">
          <pre className="text-xs text-slate-600 whitespace-pre-wrap font-mono animate-pulse">{`> ${step.log}`}</pre>
        </div>
      )}
    </div>
  );
};

interface DeploymentViewProps {
    selectedRepo: string;
    onRepoSelect: (repo: string) => void;
    isDeploying: boolean;
    deploymentSteps: DeploymentStep[];
    currentStepIndex: number;
    deployedLink: string | null;
    onDeploy: () => void;
    onNewDeployment: () => void;
    repos?: { id: string; name: string }[];
    error?: string;
    needsGithubAuth?: boolean;
    onAuthorizeGithub?: () => Promise<void> | void;
}

const DeploymentView: React.FC<DeploymentViewProps> = ({ 
  selectedRepo,
  onRepoSelect,
  isDeploying,
  deploymentSteps,
  currentStepIndex,
  deployedLink,
  onDeploy,
  onNewDeployment,
  repos,
  error,
  needsGithubAuth,
  onAuthorizeGithub
 }) => {
  
  const isDeploymentFinished = !!deployedLink;
  const showLogs = isDeploying;

  return (
    <div className="max-w-4xl mx-auto">
        {isDeploymentFinished ? (
            <div className="text-center p-8 bg-white rounded-2xl shadow-lg border border-green-200">
                <CheckCircleIcon className="w-16 h-16 text-6xl text-green-600 mx-auto mb-4" style={{fontVariationSettings: "'FILL' 1"}}/>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Deployment Successful!</h2>
                <p className="text-slate-600 mb-6">Your repository <span className="font-medium">{selectedRepo}</span> has been successfully deployed.</p>
                <div className="flex items-center justify-center gap-2 bg-green-50 p-3 rounded-lg border border-green-200">
                    <span className="material-symbols-outlined text-green-700">link</span>
                    <a href={deployedLink} target="_blank" rel="noopener noreferrer" className="text-green-800 font-medium hover:underline">{deployedLink}</a>
                </div>
                <button
                    onClick={onNewDeployment}
                    className="mt-8 flex items-center gap-2 mx-auto bg-blue-600 text-white font-medium py-3 px-6 rounded-full hover:bg-blue-700 transition-colors"
                >
                    <RocketLaunchIcon />
                    Start Another Deployment
                </button>
            </div>
        ) : (
            <div className="bg-white p-4 sm:p-6 rounded-2xl shadow-lg border border-gray-200">
                {error && (
                  <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
                    {error} {/** Optional link slot rendered by parent via error text */}
                  </div>
                )}
                {needsGithubAuth ? (
                  <div className="text-center p-6">
                    <span className="material-symbols-outlined text-5xl text-slate-400">lock</span>
                    <h3 className="mt-2 text-xl font-semibold text-slate-800">Authorize GitHub Access</h3>
                    <p className="mt-1 text-slate-600">We need permission to list your repositories for deployment.</p>
                    <button onClick={() => onAuthorizeGithub && onAuthorizeGithub()} className="mt-4 bg-blue-600 text-white font-medium py-2 px-6 rounded-full hover:bg-blue-700">Authorize GitHub</button>
                  </div>
                ) : (
                <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
                    <div className="flex-grow w-full">
                        <label htmlFor="repo-select" className="block text-sm font-medium text-slate-600 mb-1">
                            Select Repository
                        </label>
                        <select
                            id="repo-select"
                            value={selectedRepo}
                            onChange={(e) => onRepoSelect(e.target.value)}
                            disabled={isDeploying}
                            className="w-full p-3 bg-white border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-600 transition"
                        >
                            <option value="" disabled>Choose a repository...</option>
                            {(repos || []).map(repo => (
                                <option key={repo.id} value={repo.name}>{repo.name}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={onDeploy}
                        disabled={!selectedRepo || isDeploying}
                        className="w-full md:w-auto flex items-center justify-center gap-2 bg-blue-600 text-white font-medium py-3 px-8 rounded-full hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed md:self-end"
                    >
                        {isDeploying ? (
                            <>
                                <SpinnerIcon className="w-5 h-5 animate-spin"/>
                                Deploying...
                            </>
                        ) : (
                            <>
                                <RocketLaunchIcon/>
                                Deploy
                            </>
                        )}
                    </button>
                </div>
                )}
    
                {showLogs && (
                    <div className="mt-6 space-y-2 border-t border-gray-200 pt-6">
                         <div className="flex items-center gap-2 px-4 pb-2">
                             <TerminalIcon className="text-xl text-slate-500" />
                             <h3 className="text-lg font-medium text-slate-800">Deployment Log</h3>
                         </div>
                        {deploymentSteps.map((step, index) => (
                            <DeploymentStepItem key={step.id} step={step} isActive={index === currentStepIndex - 1} />
                        ))}
                    </div>
                )}
            </div>
        )}
    </div>
  );
};

export default DeploymentView;