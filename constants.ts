import { Repository, DeploymentStep, DeploymentStatus, DeploymentHistoryEntry, LogEntry, Testimonial, PricingPlan } from './types';

export const MOCK_REPOS: Repository[] = [
  { id: 'repo1', name: 'acme-corp/frontend-app' },
  { id: 'repo2', name: 'acme-corp/backend-service' },
  { id: 'repo3', name: 'acme-corp/data-pipeline' },
  { id: 'repo4', name: 'personal-project/portfolio-site' },
  { id: 'repo5', name: 'startup-inc/mobile-api-gateway' },
];

export const INITIAL_DEPLOYMENT_STEPS: DeploymentStep[] = [
  {
    id: 1,
    title: 'Detect Language & Framework',
    details: 'Analyzing repository structure to identify technology stack.',
    status: DeploymentStatus.PENDING,
    log: 'repository_scan_initated... found package.json... detected React.js v18.2 with TypeScript.'
  },
  {
    id: 2,
    title: 'Code Analysis',
    details: 'Scanning for potential errors, vulnerabilities, and code smells.',
    status: DeploymentStatus.PENDING,
    log: 'static_analysis_started... 124 files scanned... found 3 potential null pointer exceptions and 1 deprecated API call.'
  },
  {
    id: 3,
    title: 'AI-Powered Auto-Fix',
    details: 'Using AI to automatically fix identified issues and improve code quality.',
    status: DeploymentStatus.PENDING,
    log: 'ai_fix_agent_deployed... patching null pointer checks... refactoring deprecated call to new API... generating explanations for changes.'
  },
  {
    id: 4,
    title: 'Push Changes to Main',
    details: 'Committing and pushing automated fixes back to the main branch.',
    status: DeploymentStatus.PENDING,
    log: 'git_commit_-m_"fix(ai):_automated_code_quality_improvements"... git_push_origin_main... push_successful.'
  },
  {
    id: 5,
    title: 'Install Dependencies',
    details: 'Setting up virtual environment and installing required packages.',
    status: DeploymentStatus.PENDING,
    log: 'virtual_machine_provisioned... running_npm_install... found 1257 packages... dependencies installed successfully.'
  },
  {
    id: 6,
    title: 'Create Docker Image',
    details: 'Building a containerized Docker image for consistent deployment.',
    status: DeploymentStatus.PENDING,
    log: 'writing_dockerfile... RUN_npm_install... EXPOSE_3000... docker_build_-t_app:latest_... image created successfully.'
  },
  {
    id: 7,
    title: 'Generate CI/CD Pipeline',
    details: 'Automatically creating a GitHub Actions workflow for continuous integration.',
    status: DeploymentStatus.PENDING,
    log: 'creating_.github/workflows/main.yml... on:push:branches:main... jobs:build,test,deploy... workflow file generated.'
  },
  {
    id: 8,
    title: 'Run Pipeline (Build, Test, Stage)',
    details: 'Executing the CI/CD pipeline to ensure application integrity.',
    status: DeploymentStatus.PENDING,
    log: 'pipeline_triggered... build job OK... test job OK (128/128 passed)... staging deployment OK... all checks passed.'
  },
  {
    id: 9,
    title: 'Deploy to Production (GCP)',
    details: 'Deploying the application to Google Cloud Platform.',
    status: DeploymentStatus.PENDING,
    log: 'authenticating_with_gcp... creating_cloud_run_service... routing_traffic... deployment to production successful.'
  },
];

export const MOCK_DEPLOYMENT_HISTORY: DeploymentHistoryEntry[] = [];

export const MOCK_LOGS: LogEntry[] = [];

export const MOCK_TESTIMONIALS: Testimonial[] = [
    { quote: "Devyntra has revolutionized our deployment process. What used to take days of manual work now happens in minutes. Truly a game-changer for our team.", author: "Jane Doe", company: "CTO, Acme Corp" },
    { quote: "The AI auto-fix feature is pure magic. It catches and corrects subtle bugs before they even become problems, saving us countless hours of debugging.", author: "John Smith", company: "Lead Engineer, Startup Inc." },
    { quote: "As a solo developer, Devyntra is my secret weapon. It handles all the complex DevOps tasks, letting me focus on what I love: building great features.", author: "Emily White", company: "Founder, Personal Project" }
];

export const MOCK_PRICING_PLANS: PricingPlan[] = [
    { name: "Starter", price: "$0", priceDetails: "For individuals and hobby projects", features: ["1 Connected Repository", "AI Code Analysis", "Automated CI/CD Generation", "Community Support"], isFeatured: false },
    { name: "Pro", price: "$49", priceDetails: "per user / month", features: ["Up to 10 Repositories", "AI Auto-Fix & Commit", "Priority GCP Deployments", "Email & Chat Support"], isFeatured: true },
    { name: "Enterprise", price: "Contact Us", priceDetails: "For large teams and organizations", features: ["Unlimited Repositories", "Advanced Security Scans", "Dedicated Infrastructure", "24/7 Premium Support"], isFeatured: false }
];