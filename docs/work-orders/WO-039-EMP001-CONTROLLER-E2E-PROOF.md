# WO-039 — EMP-001 Controller E2E Protocol Proof

Status: IN REVIEW

## Objective
Close the highest-value remote-only proof gap before physical EMP-001 activation: verify that one securely paired Android identity can use the same issued scoped credential through employee enrollment, authenticated heartbeat, generic task lease, structured result publication, and Workforce status projection.

## Scope
- Repository-only deterministic simulator proof.
- Real P-256/SHA256 pairing proof generation and verification.
- Paired credential scopes: `register`, `heartbeat`, `task:read`, `task:result`.
- EMP-001 enrollment and heartbeat.
- One bounded provider-independent task packet, lease and structured result.
- Evidence/status projection after completion.

## Non-claims
This WO does **not** prove PC01 is live, Tailscale is connected, stable signing material exists, a stable-signed APK is installed, a physical phone has paired, or Gemini UI/prompt/result automation has executed. Canonical physical deployment remains issue #100.

## Gates
- `npm test`
- `npm run build`
- Queue Hygiene
- Exact-head GitHub Actions
- Vercel-facing deployment is not required because this WO changes no Vercel runtime surface; do not consume quota for this proof.

## Expected outcome
On PASS, the generic Controller protocol is repository-proven end-to-end for the EMP-001 contract, reducing the physical session to deployment/signing/install/pairing and real-device evidence rather than discovering protocol integration defects on-device.
