import React from 'react';
import { GithubIcon } from './icons/IconComponents';

const GitHubAppInstallation: React.FC = () => {
  const installationUrl = 'https://github.com/apps/devyntra-deployment-agent';

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 text-slate-800 p-4">
      <div className="w-full max-w-lg text-center p-8 bg-white rounded-xl shadow-lg border border-slate-200">
        <div className="mb-6">
          <span className="material-symbols-outlined text-6xl text-blue-600">extension</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-4">
          Installation Required
        </h1>
        <p className="text-slate-600 text-lg mb-8">
          To continue, you must install the Devyntra GitHub App. This is a required step that allows our service to analyze your repositories, create CI/CD workflows, and manage deployments on your behalf.
        </p>
        <a
          href={installationUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-3 w-full rounded-md bg-slate-900 px-6 py-4 text-lg font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600 transition-colors"
        >
          <GithubIcon className="w-6 h-6" />
          Install the GitHub App
        </a>
        <p className="text-xs text-slate-500 mt-6">
          You will be redirected to GitHub to complete the installation. After you're done, please return to this page.
        </p>
      </div>
    </div>
  );
};

export default GitHubAppInstallation;
