---
name: Ghost Fleet reply ownership
description: Durable constraints for roster rotation, duplicate prevention, and Telegram reply notifications.
---

Roster ownership must be based on both the persisted account state and the live Discord gateway state; a database row can remain Connected while its session is reconnecting. Duplicate claims should use Discord's message ID and happen only after all rule, roster, and admin gates pass. Telegram notifications should send plain text unless content is escaped for the selected parse mode, and the HTTP/API response must be checked rather than treating fetch completion as delivery.

**Why:** A disconnected active account can otherwise block healthy queued accounts, and Telegram rejects unescaped dynamic content while returning an HTTP response that fetch does not throw for.

Admin primary overrides are persisted preferences, not unconditional ownership. Promotion must still require a healthy account, valid token, ready gateway session, and current server membership; failed checks mark the row stale and force automatic rotation to skip it.

**Why:** An operator needs a reliable way to choose among healthy queued accounts without allowing an old or disconnected roster row to block a working replacement.

**How to apply:** Recompute a guild when gateway readiness changes, gateway sessions close, or an invalid-token REST response occurs; re-check ownership immediately before the delayed send; notify after Discord accepts the reply and log Telegram API failures.