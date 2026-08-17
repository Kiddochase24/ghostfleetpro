---
name: Invalid-token reconnect guard
description: How 1006 reconnect storms from dead tokens are prevented in the gateway close/reconnect path
---
Close code 1006 stays transient, but the reconnect timer must REST-verify the token (checkAccountToken) before scheduling a gateway open; a `false` verdict skips reconnect, clears resume data + retry counter, and leaves the account dead.

**Why:** A 401-dead token can never finish a handshake — it closes with 1006 forever and the fleet reconnect-storms the gateway identify limit.

**How to apply:**
- Bust the tokenHealth cache on any unexpected close so the check is fresh, and key cache entries to the token value (a replaced token must not inherit the old verdict).
- Keep the `pendingReconnects` marker until the token check AND the scheduling decision finish (delete in `finally`) — deleting it up-front lets the watchdog/syncSessions queue an unchecked open mid-verification.
- Only literal `false` blocks; `null` (unverifiable) must still reconnect.
