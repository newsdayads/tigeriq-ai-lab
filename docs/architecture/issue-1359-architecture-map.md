# Architecture Map (Issue 1359)

## System Topology
- Control Plane: FastAPI management & routing layer
- Runtime Layer: Execution workers and task orchestrators
- Configuration Layer: Environment variables, YAML manifests, and overrides

## Overlap Points
- Dual worker dispatch mechanisms
- Overlapping configuration parsers
