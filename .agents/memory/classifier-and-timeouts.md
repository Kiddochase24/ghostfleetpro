---
name: Classifier confidence + hang-proof timeouts
description: Local classifier keyword scoring pitfall and required timeouts around OpenAI + client API calls
---
- Local classifier confidence must NOT be divided by total keyword count: rules with long keyword lists scored near-zero even for genuine issues that matched a keyword. Correct: any keyword match → confidence = min(100, issueScore*25).
- The OpenAI classify call runs inside the serialized per-channel send queue — it must carry a per-request timeout (15s) with maxRetries 0, or one hung request stalls every reply on that channel.
- Client `apiRequest` carries a 30s AbortController timeout so mutations ("Update Rule") can never spin forever; hooks in client/src/hooks/use-*.ts that import @shared/routes are DEAD code (never imported) — pages call apiRequest directly.
- Storage purge (old history + orphaned roster) also runs 60s after boot, not only on the 24h interval — pm2 crash loops otherwise never purge and Mongo fills up.
