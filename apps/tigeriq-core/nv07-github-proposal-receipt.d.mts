export function verifyNv07GithubProposalEvidence(value?: Record<string, unknown>): Record<string, unknown>;
export const NV07_S6_GITHUB_SCOPE: string;
export function storeNv07GithubProposalWithLease(db: unknown, input?: {receipt?: Record<string, unknown>; evidence?: Record<string, unknown>; leaseToken?: string}): Promise<Record<string, unknown>>;
export function recordNv07GithubProposalReceipt(db: unknown, input?: {jobId?: string; pullRequestNumber?: number; leaseToken?: string}): Promise<Record<string, unknown>>;
export function executeNv07S6ProposalReceipt(db: unknown): Promise<Record<string, unknown>>;
