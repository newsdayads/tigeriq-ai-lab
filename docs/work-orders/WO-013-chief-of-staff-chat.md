# WO-013 — TigerIQ AI Chief of Staff Chat

## Objective
Make TigerIQ AI the single conversational control surface for the Owner. Normal questions/discussion/planning must be answered conversationally; status stays deterministic/tool-first; ambiguous execution intent asks for clarification; only explicit executable instructions may create exactly one GitHub Work Order.

## Branch
`wo013/chief-of-staff-chat`

## Current implementation
- OpenAI-first Chief of Staff: primary `openai/gpt-5.6-sol`, fallback `google/gemini-3.6-flash` through Vercel AI Gateway.
- Vercel OIDC authentication obtained with official `@vercel/oidc` `getVercelOidcToken()` helper; optional `AI_GATEWAY_API_KEY` remains a fallback and is never committed.
- Strict Chief decision modes: `reply`, `status`, `clarify`, `work-order`.
- Conversation history is supplied from the browser for contextual commands such as `Làm` only when prior context is clear.
- AI failure is fail-safe: no implicit Work Order is created.
- Controller alone performs GitHub writes after Chief classifies an explicit execution request.
- Deterministic status remains outside the LLM path.
- GitHub authorization remains browser-scoped for write actions only.

## Gates before Production
1. Dependency lockfile synchronized and `npm ci` PASS.
2. Syntax/static Chief invariants PASS.
3. Existing TigerIQ typecheck/test/build gates PASS.
4. Vercel Preview READY.
5. Live Preview Chief smoke for `Bạn đang sử dụng mô hình nào để trao đổi với tôi?` returns `mode=reply` and no GitHub Issue is created.
6. A status question returns live deterministic status without creating an Issue.
7. An explicit execution instruction creates exactly one Work Order when GitHub write authorization is present.
8. Ambiguous execution intent returns `clarify` without creating an Issue.
9. Only after all applicable gates PASS may this branch be merged/promoted to Production.

## Current evidence
- Lockfile sync workflow completed successfully and produced branch commit `6908ffcd4f7c36ec02b3baceae8b3ae3daa0ec43`.
- Vercel Preview for the OIDC-helper implementation built successfully and reached READY.
- Previous smoke using direct `process.env.VERCEL_OIDC_TOKEN` failed with `ai_gateway_authorization_unavailable`; root cause was implementation-side token retrieval, not proof of missing user account authorization.
- Preview protection currently requires an authenticated request path for the final live Chief smoke; do not infer runtime PASS until that evidence is obtained.

No PC01/OpenClaw/Ollama changes are part of this Work Order.
