---
name: AI classifier gate
description: Keyword rules use an always-on relevance classifier after the cheap keyword prefilter.
---

Keyword rules always run the relevance classifier after a keyword match. “Any Message” rules intentionally skip that gate because they are explicit direct triggers. The classifier uses OpenAI when configured and a local fallback otherwise; low-confidence keyword matches are blocked according to the existing crypto/general thresholds.

**Why:** The user expects keyword rules to avoid replying to irrelevant keyword mentions while keeping the behavior consistent without a per-rule opt-in.

**How to apply:** Keep the Rules wizard explicit about the two-stage keyword-plus-AI flow, and do not reintroduce an opt-in gate unless the product behavior is intentionally changed end to end.