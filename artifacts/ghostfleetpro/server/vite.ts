import { type Express } from "express";
import { createServer as createViteServer, createLogger } from "vite";
import { type Server } from "http";
import viteConfig from "../vite.config";
import fs from "fs";
import path from "path";
import { nanoid } from "nanoid";

const viteLogger = createLogger();

export async function setupVite(server: Server, app: Express) {
  // In the Replit environment the preview is served through a proxy — the
  // browser can't reach a raw port so HMR must either piggyback on the main
  // HTTP server (when no REPLIT_DEV_DOMAIN) or be disabled entirely.
  // We also set strictPort:false so a stale zombie process holding 24678 never
  // crashes the server.
  const hmrConfig = process.env.REPLIT_DEV_DOMAIN
    ? false
    : { server, path: "/vite-hmr", strictPort: false };

  const serverOptions = {
    middlewareMode: true,
    hmr: hmrConfig,
    allowedHosts: true as const,
    strictPort: false,
  };

  const vite = await createViteServer({
    ...viteConfig,
    configFile: false,
    customLogger: {
      ...viteLogger,
      error: (msg, options) => {
        viteLogger.error(msg, options);
        // Don't crash the whole server for non-fatal Vite errors such as
        // an HMR WebSocket port conflict — those are recoverable.
        if (
          msg.includes("WebSocket server error") ||
          msg.includes("is already in use")
        ) {
          return;
        }
        process.exit(1);
      },
    },
    server: serverOptions,
    appType: "custom",
  });

  app.use(vite.middlewares);

  app.use(/(.*)/, async (req, res, next) => {
    const url = req.originalUrl;

    try {
      const clientTemplate = path.resolve(
        import.meta.dirname,
        "..",
        "client",
        "index.html",
      );

      // always reload the index.html file from disk incase it changes
      let template = await fs.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`,
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e as Error);
      next(e);
    }
  });
}
