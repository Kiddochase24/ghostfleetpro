import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { EventEmitter } from "events";
import { setupGlobalFetchProxy } from "./proxy";

// ── Proxy-Cheap setup: load persisted/env settings before bot sessions open ──
// Discord HTTP calls use account-specific https-proxy-agent instances and
// gateway WebSockets use the matching agent.
await setupGlobalFetchProxy();

// Raise the global listener limit — 100 WebSocket sessions × multiple emitters
// easily exceeds Node's default of 10, causing false "memory leak" warnings.
EventEmitter.defaultMaxListeners = 512;

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// The Replit artifact proxy forwards the preview prefix to this service
// (for example /ghostfleetpro/api/...); Express routes are registered at
// /api/... internally. Strip only the configured artifact prefix so both
// proxied artifact traffic and root PM2 deployments work.
const basePath = (process.env.BASE_PATH || "/").replace(/\/+$/, "") || "/";
if (basePath !== "/") {
  app.use((req, _res, next) => {
    if (req.url === basePath || req.url.startsWith(`${basePath}/`)) {
      req.url = req.url.slice(basePath.length) || "/";
    }
    next();
  });
}

if (process.env.NODE_ENV !== "production") {
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    next();
  });
}

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        // Truncate large responses so guild arrays / history blobs don't flood pm2 logs.
        // Full payload is always available via MongoDB or the API directly.
        const raw = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${raw.length > 500 ? raw.slice(0, 500) + "…" : raw}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // Ensure a founder license exists (seeds both dev and production on first boot)
  try {
    const { storage } = await import("./storage");
    const seedLicenses = [
      { code: "GFLT-PRO1-FNDR-2026", label: "FOUNDER" },
      { code: "GFLT-U001-ACTV-2026", label: "BETA" },
      { code: "GFLT-U002-ACTV-2026", label: "BETA" },
      { code: "GFLT-U003-ACTV-2026", label: "BETA" },
      { code: "GFLT-U004-ACTV-2026", label: "BETA" },
      { code: "GFLT-U005-ACTV-2026", label: "BETA" },
      { code: "GFLT-U006-ACTV-2026", label: "BETA" },
      { code: "GFLT-U007-ACTV-2026", label: "BETA" },
      { code: "GFLT-U008-ACTV-2026", label: "BETA" },
      { code: "GFLT-U009-ACTV-2026", label: "BETA" },
      { code: "GFLT-U010-ACTV-2026", label: "BETA" },
      { code: "GFLT-U011-ACTV-2026", label: "BETA" },
      { code: "GFLT-U012-ACTV-2026", label: "BETA" },
      { code: "GFLT-U013-ACTV-2026", label: "BETA" },
      { code: "GFLT-U014-ACTV-2026", label: "BETA" },
    ];
    for (const { code, label } of seedLicenses) {
      const existing = await storage.getLicense(code);
      if (!existing) {
        await storage.createLicense(code, label);
        console.log(`[startup] License seeded: ${code}`);
      }
    }
  } catch (e: any) {
    console.warn(`[startup] Could not seed licenses: ${e.message}`);
  }

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  // Replace all your app.listen calls with this:
  const PORT = Number(process.env.PORT) || 5000;
  httpServer.listen(PORT, "0.0.0.0", () => {
    log(`serving on port ${PORT} (env=${process.env.NODE_ENV || "development"}, base=${basePath})`);
  });
})();