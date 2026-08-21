---
name: Proxy-Cheap session routing
description: Non-obvious constraints for per-account Proxy-Cheap HTTP and WebSocket routing.
---

Per-account Discord requests must use a dedicated `https-proxy-agent` whose proxy username is the configured base username plus `-session-accN`. Native `fetch`/undici does not accept a Node HTTP agent per request, so account-aware Discord REST calls use `node-fetch`; the gateway WebSocket passes the same agent directly.

**Why:** A single global dispatcher would reuse one sticky proxy session for the whole fleet, while account creation and token verification do not know the Discord account ID until the first request succeeds.

**How to apply:** Keep the bootstrap request on the shared `acc1` session, then pass the persisted account ID to every later Discord REST call and gateway WebSocket. Validate the configured account count as 1–50, preserve the lease across Discord-only gateway closes, replace/quarantine it only after proxy transport/auth failure, fail closed rather than silently switching configured accounts to the VPS IP, and surface lease/agent startup failures as dead sessions eligible for watchdog recovery.

**Why:** Silent direct fallback breaks sticky routing and concentrates the fleet behind one Discord-facing IP; a synchronous proxy failure must not leave an account permanently marked as connecting.