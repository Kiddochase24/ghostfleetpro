---
name: App WebSocket and Mongo deployment
description: Deployment compatibility for the dashboard socket and legacy account guild data.
---

The dashboard WebSocket must accept both the artifact-prefixed path and root `/ws`, because Replit forwards the base path while common VPS reverse proxies mount the app at `/`.

**Why:** A healthy Discord account gateway does not imply the browser dashboard socket is reachable; a path mismatch makes the UI show disconnected even while account sessions remain active.

Legacy account guild payloads should be migrated at startup and projected to `{id, name}` on reads so old Mongo documents cannot recreate the previous heap pressure.

**Why:** Manual migration commands are easy to miss during a VPS deploy, and loading full Discord guild objects can exhaust Node memory before cleanup completes.

**How to apply:** After a VPS restart, confirm the log contains the Mongo guild migration completion message and test both the configured WebSocket path and `/ws` when diagnosing proxy differences.