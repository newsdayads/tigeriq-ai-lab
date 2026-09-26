export interface GitHubChangeRequest {
  repository: string;
  baseBranch: string;
  headBranch: string;
  workOrderId: string;
}

export interface GitHubAdapterPolicy {
  allowDirectMainWrite: false;
  requirePullRequest: true;
}

export const githubAdapterPolicy: GitHubAdapterPolicy = {
  allowDirectMainWrite: false,
  requirePullRequest: true
};
