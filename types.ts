export enum DeploymentStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export interface DeploymentStep {
  id: number;
  title: string;
  details: string;
  status: DeploymentStatus;
  log?: string;
}

export interface Repository {
  id: string;
  name: string;
}

export interface DeploymentHistoryEntry {
    id: string;
    repoName: string;
    status: 'Success' | 'Failed';
    deployedAt: string;
    commitHash: string;
    url?: string;
}

export interface LogEntry {
    id: string;
    timestamp: string;
    level: 'INFO' | 'WARN' | 'ERROR';
    message: string;
    deploymentId: string;
}

export interface Testimonial {
    quote: string;
    author: string;
    company: string;
}

export interface PricingPlan {
    name: string;
    price: string;
    priceDetails: string;
    features: string[];
    isFeatured: boolean;
}