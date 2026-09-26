# WO-042 — Owner Web Control login

## Goal
Allow the Owner to operate TigerIQ Web Control without typing a command secret or GitHub token in the browser.

## Security model
- Google OAuth is accepted only when the verified Google email equals `TIGERIQ_OWNER_EMAIL`.
- The browser receives only a short-lived, signed, HttpOnly, Secure owner-session cookie.
- GitHub write credentials remain server-side in `TIGERIQ_GITHUB_TOKEN`.
- If any required OAuth/session configuration is absent, Owner control is fail-closed. Public status/report screens remain read-only.
- Client-supplied GitHub tokens remain supported only for compatibility; the new UI never asks for one.

## Required Vercel environment variables
Set these in the existing TigerIQ AI Lab Vercel project. Do not store their values in GitHub, Drive, issues, screenshots, or chat.

- `TIGERIQ_OWNER_EMAIL=newsdayads@gmail.com`
- `TIGERIQ_OWNER_GOOGLE_CLIENT_ID`
- `TIGERIQ_OWNER_GOOGLE_CLIENT_SECRET`
- `TIGERIQ_OWNER_OAUTH_REDIRECT_URI=https://tigeriq-ai-lab.vercel.app/api/owner-auth?action=callback`
- `TIGERIQ_OWNER_SESSION_SECRET` (random high-entropy value)
- Existing server-side `TIGERIQ_GITHUB_TOKEN`

In Google Cloud OAuth settings, register exactly the redirect URI above. Use Production environment only after preview verification.

## Acceptance
1. Unconfigured deployment returns `configured:false` and never permits write operations.
2. Non-owner Google identity is rejected.
3. Owner session permits `work-order` and `canary` only while the signed session is valid.
4. No browser field contains a command secret or GitHub token.
