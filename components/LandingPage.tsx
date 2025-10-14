import React, { useState, useEffect, useRef } from 'react';
import { INITIAL_DEPLOYMENT_STEPS } from '../constants';
import { DeploymentStep, DeploymentStatus } from '../types';
import { GithubIcon, CheckCircleIcon, SpinnerIcon, DotIcon } from './icons/IconComponents';

interface LandingPageProps {
  onLogin: () => void;
  isAuthenticated?: boolean;
}

const Header: React.FC<{ onLogin: () => void; isAuthenticated?: boolean }> = ({ onLogin, isAuthenticated }) => {
    return (
        <header className="absolute inset-x-0 top-0 z-50">
            <nav className="flex items-center justify-between p-6 lg:px-8" aria-label="Global">
                <div className="flex lg:flex-1">
                    <a href="#" onClick={e => e.preventDefault()} className="-m-1.5 p-1.5 flex items-center gap-2">
                        <span className="material-symbols-outlined text-3xl text-blue-600">data_object</span>
                        <span className="text-2xl font-bold tracking-tight text-slate-900">Devyntra</span>
                    </a>
                </div>
                <div className="lg:flex lg:flex-1 lg:justify-end">
                    {!isAuthenticated && (
                      <button onClick={onLogin} className="text-sm font-semibold leading-6 text-slate-900">
                          Log in <span aria-hidden="true">&rarr;</span>
                      </button>
                    )}
                </div>
            </nav>
        </header>
    );
};

const HeroSection: React.FC<{ onLogin: () => void; isAuthenticated?: boolean }> = ({ onLogin, isAuthenticated }) => {
    return (
        <div className="relative isolate px-6 pt-14 lg:px-8">
            <div className="absolute inset-x-0 -top-40 -z-10 transform-gpu overflow-hidden blur-3xl sm:-top-80" aria-hidden="true">
                <div className="relative left-[calc(50%-11rem)] aspect-[1155/678] w-[36.125rem] -translate-x-1/2 rotate-[30deg] bg-gradient-to-tr from-[#80caff] to-[#4f46e5] opacity-30 sm:left-[calc(50%-30rem)] sm:w-[72.1875rem]" style={{ clipPath: 'polygon(74.1% 44.1%, 100% 61.6%, 97.5% 26.9%, 85.5% 0.1%, 80.7% 2%, 72.5% 32.5%, 60.2% 62.4%, 52.4% 68.1%, 47.5% 58.3%, 45.2% 34.5%, 27.5% 76.7%, 0.1% 64.9%, 17.9% 100%, 27.6% 76.8%, 76.1% 97.7%, 74.1% 44.1%)' }}></div>
            </div>
            <div className="mx-auto max-w-2xl py-32 sm:py-48 lg:py-56">
                <div className="text-center">
                    <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">Deploy with Confidence, Powered by AI</h1>
                    <p className="mt-6 text-lg leading-8 text-gray-600">Devyntra analyzes your code, automatically fixes issues, and deploys your applications seamlessly to the cloud. Go from repository to production in minutes, not days.</p>
                    {!isAuthenticated && (
                      <div className="mt-10 flex items-center justify-center gap-x-6">
                          <button
                              onClick={onLogin}
                              className="flex items-center gap-3 rounded-md bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-600"
                          >
                              <GithubIcon className="w-5 h-5" />
                              Deploy with GitHub
                          </button>
                      </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const FeaturesSection: React.FC = () => {
  const features = [
    { icon: 'auto_awesome', title: 'AI-Powered Auto-Fix', description: 'Our AI analyzes your code, identifies bugs, and automatically pushes fixes back to your repository.' },
    { icon: 'model_training', title: 'Automated Stack Detection', description: 'No configuration needed. Devyntra intelligently detects your project\'s language and framework.' },
    { icon: 'hub', title: 'CI/CD Pipeline Generation', description: 'Automatically creates a complete GitHub Actions workflow for building, testing, and deploying your app.' },
    { icon: 'deployed_code', title: 'One-Click Cloud Deployment', description: 'Go from commit to a live URL on Google Cloud Platform with a single click.' },
    { icon: 'inventory_2', title: 'Containerization & Dockerization', description: 'Builds optimized, production-ready Docker images for your application behind the scenes.' },
    { icon: 'security', title: 'Seamless Git Integration', description: 'Works directly with your GitHub repositories, keeping your workflow centered around version control.' }
  ];
  return (
    <div className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl lg:text-center">
          <h2 className="text-base font-semibold leading-7 text-blue-600">Features</h2>
          <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Everything you need to deploy faster</p>
          <p className="mt-6 text-lg leading-8 text-gray-600">Devyntra automates the entire DevOps lifecycle, so you can focus on writing code.</p>
        </div>
        <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-16 text-base leading-7 text-gray-600 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.title}>
                <dt className="font-semibold text-gray-900 text-lg">
                  <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-blue-100">
                    <span className="material-symbols-outlined text-2xl text-blue-600">{feature.icon}</span>
                  </div>
                  {feature.title}
                </dt>
                <dd className="mt-1 text-gray-600">{feature.description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </div>
  );
};

const DeploymentWorkflowSection: React.FC = () => {
    const [steps, setSteps] = useState<DeploymentStep[]>(
        INITIAL_DEPLOYMENT_STEPS.map(step => ({...step, status: DeploymentStatus.PENDING }))
    );
    const [isAnimating, setIsAnimating] = useState(false);
    const sectionRef = useRef<HTMLDivElement>(null);
    const currentRunningStep = steps.find(s => s.status === DeploymentStatus.RUNNING);

    useEffect(() => {
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (entry.isIntersecting && !isAnimating) {
                    setIsAnimating(true);
                }
            }, { threshold: 0.2 }
        );

        const currentRef = sectionRef.current;
        if (currentRef) observer.observe(currentRef);
        return () => { if (currentRef) observer.unobserve(currentRef) };
    }, [isAnimating]);

    useEffect(() => {
        if (!isAnimating) return;

        let currentStepIndex = -1;
        const resetSteps = () => setSteps(INITIAL_DEPLOYMENT_STEPS.map(step => ({...step, status: DeploymentStatus.PENDING })));

        const runAnimation = () => {
            const interval = setInterval(() => {
                currentStepIndex++;
                if (currentStepIndex >= steps.length) {
                    clearInterval(interval);
                    setSteps(prev => prev.map(s => ({...s, status: DeploymentStatus.COMPLETED})));
                    setTimeout(() => {
                        resetSteps();
                        currentStepIndex = -1;
                        // A simple way to restart the animation loop
                        setTimeout(runAnimation, 500);
                    }, 4000);
                    return;
                }
                
                setSteps(prevSteps => prevSteps.map((step, index) => {
                    if (index < currentStepIndex) return {...step, status: DeploymentStatus.COMPLETED};
                    if (index === currentStepIndex) return {...step, status: DeploymentStatus.RUNNING};
                    return step;
                }));
            }, 1200);
            return interval;
        };

        const animationInterval = runAnimation();
        return () => clearInterval(animationInterval);

    }, [isAnimating, steps.length]);

    const getStatusIcon = (status: DeploymentStatus) => {
        switch (status) {
            case DeploymentStatus.RUNNING: return <SpinnerIcon className="w-5 h-5 text-blue-500 animate-spin" />;
            case DeploymentStatus.COMPLETED: return <CheckCircleIcon className="w-5 h-5 text-green-500" style={{fontVariationSettings: "'FILL' 1"}} />;
            default: return <DotIcon className="w-5 h-5 text-slate-400" />;
        }
    };
    
    const stepIcons = ['code', 'bug_report', 'auto_fix_high', 'upload_file', 'build_circle', 'inventory_2', 'account_tree', 'model_training', 'cloud_upload'];

    return (
        <div ref={sectionRef} className="bg-slate-50 py-24 sm:py-32">
            <div className="mx-auto max-w-7xl px-6 lg:px-8">
                <div className="mx-auto max-w-2xl lg:text-center">
                    <h2 className="text-base font-semibold leading-7 text-blue-600">Live Workflow</h2>
                    <p className="mt-2 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">See Devyntra in Action</p>
                    <p className="mt-6 text-lg leading-8 text-gray-600">From code analysis to a live URL, our AI handles every step of the deployment pipeline automatically and efficiently.</p>
                </div>

                <div className="mx-auto mt-16 max-w-2xl sm:mt-20 lg:mt-24 lg:max-w-none">
                    <div className="grid grid-cols-1 gap-y-12 lg:grid-cols-5 lg:gap-x-12">
                        
                        {/* Steps Column */}
                        <div className="lg:col-span-2">
                            <ul role="list" className="space-y-4">
                                {steps.map((step, index) => (
                                    <li key={step.id} className={`relative flex items-start gap-4 p-4 rounded-xl transition-all duration-500 ${step.status === DeploymentStatus.RUNNING ? 'bg-blue-50' : ''}`}>
                                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-500 ${step.status !== DeploymentStatus.PENDING ? 'bg-blue-600' : 'bg-slate-300'}`}>
                                            <span className="material-symbols-outlined text-xl text-white">{stepIcons[index] || 'data_object'}</span>
                                        </div>
                                        <div className={`pt-0.5 transition-opacity duration-500 ${step.status === DeploymentStatus.PENDING ? 'opacity-60' : 'opacity-100'}`}>
                                            <div className="flex items-center gap-2">
                                                {getStatusIcon(step.status)}
                                                <h3 className="text-sm font-semibold leading-6 text-gray-900">{step.title}</h3>
                                            </div>
                                            <p className="mt-1 text-sm text-gray-600">{step.details}</p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </div>
                        
                        {/* Terminal Column */}
                        <div className="lg:col-span-3">
                            <div className="sticky top-24">
                                <div className="bg-slate-900 rounded-xl shadow-2xl border border-slate-700">
                                    <div className="flex items-center gap-2 p-3 bg-slate-800 rounded-t-xl border-b border-slate-700">
                                        <div className="w-3 h-3 rounded-full bg-red-500"></div>
                                        <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                                        <div className="w-3 h-3 rounded-full bg-green-500"></div>
                                    </div>
                                    <div className="p-6 font-mono text-sm text-green-400 min-h-[24rem] overflow-x-auto">
                                        {currentRunningStep ? (
                                            <>
                                                <span className="text-slate-400">$</span> {currentRunningStep.log}
                                                <span className="inline-block w-2 h-4 bg-green-400 ml-1 animate-pulse"></span>
                                            </>
                                        ) : (
                                             <span className="text-slate-500">Waiting for deployment to start...</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
};


const Footer: React.FC = () => {
    return (
        <footer className="bg-white">
            <div className="mx-auto max-w-7xl overflow-hidden px-6 py-12 lg:px-8">
                <p className="text-center text-xs leading-5 text-gray-500">&copy; 2024 Devyntra, Inc. All rights reserved.</p>
            </div>
        </footer>
    );
};


const LandingPage: React.FC<LandingPageProps> = ({ onLogin }) => {
  return (
    <div className="bg-white">
      <Header onLogin={onLogin} />
      <main className="isolate">
        <HeroSection onLogin={onLogin} />
        <FeaturesSection />
        <DeploymentWorkflowSection />
      </main>
      <Footer />
    </div>
  );
};

export default LandingPage;