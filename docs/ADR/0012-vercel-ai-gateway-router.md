# ADR 0012 — Vercel AI Gateway Model Router

Status: ACCEPTED FOR IMPLEMENTATION
Date: 2026-08-30

## Decision
TigerIQ AI uses Vercel AI Gateway as the cloud model control plane. Deployment OIDC is preferred so no provider secret is committed to GitHub. Deterministic status, GitHub and Vercel operations remain tool-first and do not spend model tokens.

## Roles
- Chief of Staff: low-cost model first; classifies answer vs executable Work Order.
- Executor: strong implementation model with bounded timeout and explicit fallbacks.
- Independent Reviewer: provider/model distinct from Executor for high-risk work.
- Judge/Gate: independent final PASS/FAIL; cannot replace deterministic CI/test evidence.

## Required evidence
Every model-assisted execution records role, requested model, actual model when available, fallback path, latency, rate/quota failure, Work Order ID and gate result. Secrets and prompt credentials are never evidence.

## Failure policy
Timeout, quota and provider outage trigger only bounded configured fallback. No unbounded retries. If all cloud routes fail, the Work Order remains durable for later execution; PC01 is outside this implementation window.

## Promotion gate
Preview + CI + runtime verification are required before Production. Existing Web Control behavior must not regress.