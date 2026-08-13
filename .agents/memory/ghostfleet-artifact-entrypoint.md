---
name: Ghost Fleet artifact entrypoint
description: The Ghost Fleet artifact has a separate client source tree and must serve that tree instead of the scaffold placeholder.
---

The Ghost Fleet web artifact must use `client/` as its Vite root and serve its Express API through the managed web service. The artifact root can contain a leftover scaffold app that looks healthy but is not the product UI. When mounted under an artifact prefix, the proxy forwards that prefix to Express, so the server must strip `BASE_PATH` before API routing and the client must prefix API URLs.

**Why:** The preview previously served the scaffold placeholder, so product routes appeared blank or 404 even though the real Rules page existed elsewhere.

**How to apply:** When changing Ghost Fleet UI or debugging preview behavior, verify the active Vite root and managed service command before debugging component code. Keep API requests and WebSocket URLs under the artifact base path in the browser, and strip that prefix once at the server boundary. Production PM2 must rebuild the Vite bundle after pulling source changes.