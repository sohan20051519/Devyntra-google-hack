import React from 'react';

const GitHubAppInstallation: React.FC = () => {
  return (
    <div className="bg-gray-800 shadow-md rounded-lg p-6 max-w-lg mx-auto mt-10">
      <h2 className="text-xl font-semibold text-white mb-4">Installation Required</h2>
      <p className="text-gray-300 mb-6">
        To continue, you must install the Devyntra GitHub App. This is a required step that allows our service to analyze your repositories, create CI/CD workflows, and manage deployments on your behalf.
      </p>
      <a
        href="https://github.com/apps/devyntra-deployment-agent"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block bg-indigo-600 text-white font-bold py-2 px-4 rounded hover:bg-indigo-700 transition duration-300"
      >
        Install the GitHub App
      </a>
    </div>
  );
};

export default GitHubAppInstallation;
