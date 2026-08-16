---
name: Gateway recovery session state
description: Non-obvious Discord gateway reconnect state that must survive socket replacement.
---

Resume state belongs to the account recovery flow, not only to the current WebSocket object. A replacement socket must carry the saved session metadata until RESUMED succeeds, while an INVALID_SESSION event must clear both copies before the close handler runs.

**Why:** Close events are asynchronous and can save whatever metadata remains on the live session. Clearing only the pending map can accidentally re-save an invalid session, while clearing only the live socket loses resumability after a successful RESUME.

**How to apply:** Preserve session ID, resume URL, and sequence when creating a replacement gateway session; clear all three before deliberately closing after an invalid-session response.