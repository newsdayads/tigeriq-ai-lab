# TigerIQ Inference Gateway — Optional Adapter V1

Status: Architecture correction for TigerIQ V1; no MAIN/Production.

## Purpose

This document narrows the role of PR #127. The Inference Gateway is an **optional server-side AI execution adapter**, not a mandatory path for every AI Employee.

## Execution ownership

TigerIQ V1 supports three execution locations:
- `pc01-local` — local model/runtime on PC01;
- `pc01-server` — provider call intentionally executed by a PC01/server adapter;
- `employee-device` — the phone/device executes the AI request itself and owns its provider authentication locally.

The Coordinator may select any eligible endpoint but does not require a provider credential.

## Credential invariant

For `employee-device` execution:
- PC01/Server sends JOB + Prompt through the approved transport;
- the device calls its configured provider directly;
- the device returns the standardized result/evidence envelope;
- PC01/Server does not need, proxy, copy, log, or persist that provider credential.

For `pc01-server` execution only, #127's server-side credential handling remains applicable to that explicit endpoint.

## Compatibility rule

Any older statement in `AI_INFERENCE_GATEWAY_V1.md` that says provider credentials exist only in the Gateway server environment applies only to jobs actually routed through the Gateway. It must not be interpreted as requiring device-owned provider credentials to move to the server.

Canonical distributed execution contract is supplied by the current AI Coordinator/Prompt Architect V1 stack (`TIGERIQ_JOB_EXECUTION_V1`). PR #127 must be refreshed onto that coordinator head before current-stack integration readiness is claimed.

## Independence and evidence

Provider/model remains execution metadata, not employee identity. Executor/Reviewer/Judge independence is evaluated by concrete backend identity under the Coordinator gate.

No secret is part of the standardized request/result evidence envelope. No live provider, phone, PC01, Tailscale, or JOB-001 runtime success is claimed by this document.
