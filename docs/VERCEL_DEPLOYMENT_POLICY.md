# TigerIQ Vercel Deployment Policy

Status: enforced by `vercel.json` and CI.

## Policy

- Automatic Git-triggered Vercel deployments are disabled globally.
- Work-order, audit, docs, test, PC01, Android, governance, and other engineering branches must use GitHub CI without creating Vercel Preview Deployments.
- Vercel Preview is created only when an online web/UI deployment is explicitly required for verification.
- Production deployment/promotion requires the applicable Owner release authorization/gate.
- A normal commit or pull request must never consume Vercel deployment quota by default.

## Enforcement

`vercel.json` must contain:

```json
"git": {
  "deploymentEnabled": false
}
```

`scripts/verify-vercel-deployment-policy.mjs` is executed by CI and fails if automatic Git deployments are re-enabled.

## Rationale

The repository produces frequent engineering commits across many branches. Automatic Preview Deployment on every push creates unnecessary Vercel deployment usage for changes that do not require a hosted web environment. Explicit deployment separates code verification from hosting and preserves deployment quota.
