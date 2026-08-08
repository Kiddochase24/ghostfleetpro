import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "..", "dist", "public");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`,
    );
  }

  // Serve static assets with default caching (filenames are hashed by Vite).
  // index: false so express.static never serves index.html directly — the
  // SPA fallback below handles it with explicit no-cache headers.
  app.use(express.static(distPath, { index: false }));

  // SPA fallback — serves index.html for any route not matched by static files.
  // Force no-cache on index.html so browsers always fetch the latest entry point,
  // which references the current hashed JS/CSS filenames after every deploy.
  app.use((_req, res) => {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.sendFile(path.resolve(distPath, "index.html"));
  });
}
