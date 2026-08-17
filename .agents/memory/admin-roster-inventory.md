---
name: Admin roster inventory
description: The admin Server Roster is an account/server inventory as well as a rule-rotation view.
---

The admin Server Roster must include servers reported by linked accounts even when those servers are not currently selected by an active rule or do not yet have a persisted server_roster slot. Rule counts and rotation entries remain separate from account visibility.

**Why:** Limiting the cards to active-rule servers made the roster appear empty or incomplete while account guild lists already contained the servers.

**How to apply:** Build the visible server set from both linked-account guilds and active rule selections; only count rule references as rules and only show persisted roster rows as rotation entries.