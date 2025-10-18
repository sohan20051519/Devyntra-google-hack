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
    title: 'Code Analysis & Fix',
    details: 'Jules AI is analyzing your code, fixing errors, and pushing changes.',
    status: DeploymentStatus.PENDING,
    log: 'Jules AI agent deployed...'
  },
  {
    id: 2,
    title: 'Install Dependencies',
    details: 'Setting up virtual environment and installing required packages.',
    status: DeploymentStatus.PENDING,
    log: ''
  },
  {
    id: 3,
    title: 'Build & Test',
    details: 'Executing the CI/CD pipeline to ensure application integrity.',
    status: DeploymentStatus.PENDING,
    log: ''
  },
  {
    id: 4,
    title: 'Create Docker Image',
    details: 'Building a containerized Docker image for consistent deployment.',
    status: DeploymentStatus.PENDING,
    log: ''
  },
  {
    id: 5,
    title: 'Deploy to Production (Cloud Run)',
    details: 'Deploying the application to Google Cloud Run.',
    status: DeploymentStatus.PENDING,
    log: ''
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
