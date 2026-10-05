# TigerIQ — Runtime Health Probe Guard

Status: CANONICAL OPS GUARD
Source: #4279
Scope: Core / Web Control / Coding Lane runtime health checks
Cost: zero
Mutation: none

## Problem

A loopback-only probe can produce a false negative when a TigerIQ service listens on a non-loopback address. On 2026-10-06, Web Control (8796) and Coding Lane (8797) were initially classified unavailable after probing `127.0.0.1`; the corrected probe against the actual listener address returned HTTP 200.

## Required probe order

1. Resolve the configured or currently listening address for the target service.
2. Probe the exact listener address and port.
3. Treat `127.0.0.1` as authoritative only when the service is confirmed to bind loopback.
4. A loopback failure alone MUST NOT classify a service as down when a non-loopback listener exists.
5. Restart or recovery action is allowed only after the exact listener endpoint fails or another independent health signal confirms failure.
6. Record the address used with the health result so later audits can distinguish service failure from probe-target error.

## Current service identities

- TigerIQ Core: port 8795.
- Web Control: port 8796.
- Coding Lane / NV API: port 8797.

The bind address is runtime state, not a permanent constant. Resolve it before each health conclusion rather than assuming loopback or a previously observed IP.

## Verification contract

A health audit passes this guard when:
- target service identity is resolved;
- actual listener/bind address is identified;
- the exact listener endpoint is probed;
- the reported status includes the probed address;
- no restart/recovery is triggered solely from a mismatched loopback probe.

STATE=RUNTIME_HEALTH_PROBE_BIND_ADDRESS_GUARD_V1
