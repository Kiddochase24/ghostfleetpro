/**
 * server/proxy.ts
 *
 * Central SOCKS5 proxy layer for all outbound Discord connections.
 *
 * Environment variables (set in .env on the VPS):
 *   PROXY_HOST       — SOCKS5 server hostname or IP
 *   PROXY_PORT       — SOCKS5 server port (e.g. 1080)
 *   PROXY_USERNAME   — optional username for authenticated proxies
 *   PROXY_PASSWORD   — optional password for authenticated proxies
 *
 * When these vars are absent the module is a no-op — direct connections are used.
 * No other file needs to be changed; call setupGlobalFetchProxy() once at boot and
 * every subsequent fetch() call is transparently tunnelled.
 */

import { createRequire } from "node:module";
import tls from "node:tls";

const require = createRequire(import.meta.url);
let SocksClient: any;
let SocksProxyAgent: any;

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function isProxyConfigured(): boolean {
  return !!(process.env.PROXY_HOST && process.env.PROXY_PORT);
}

function buildSocksUrl(): string {
  const host = process.env.PROXY_HOST!;
  const port = process.env.PROXY_PORT!;
  const user = process.env.PROXY_USERNAME;
  const pass = process.env.PROXY_PASSWORD;
  if (user && pass) {
    return `socks5://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;
  }
  return `socks5://${host}:${port}`;
}

// ─── WebSocket agent ──────────────────────────────────────────────────────────
// Returned value is passed directly to `new WebSocket(url, { agent })`.
// The ws package forwards it to the underlying TLS/TCP handshake.

// When PROXY_USERNAME_TEMPLATE is set (must contain "{session}"), each account
// gets its own agent with a per-account session id in the username — most
// residential proxy providers (IPRoyal, Decodo/Smartproxy, Oxylabs, Webshare…)
// use this pattern to pin each session to a DIFFERENT sticky exit IP.
// Example: PROXY_USERNAME_TEMPLATE="myuser-session-{session}"
// Without the template, all accounts share one agent (single exit IP).
const _wsAgents = new Map<string, any>();

function buildSocksUrlFor(sessionKey: string | undefined): string {
  const host = process.env.PROXY_HOST!;
  const port = process.env.PROXY_PORT!;
  const template = process.env.PROXY_USERNAME_TEMPLATE;
  const pass = process.env.PROXY_PASSWORD;
  if (template && sessionKey) {
    const user = template.replace("{session}", sessionKey);
    return `socks5://${encodeURIComponent(user)}:${encodeURIComponent(pass ?? "")}@${host}:${port}`;
  }
  return buildSocksUrl();
}

export function getWsAgent(accountId?: string): any {
  if (!isProxyConfigured()) return undefined;
  if (!SocksProxyAgent) {
    SocksProxyAgent = require("socks-proxy-agent").SocksProxyAgent;
  }
  const usePerAccount = !!(process.env.PROXY_USERNAME_TEMPLATE && accountId);
  const key = usePerAccount ? accountId! : "__shared__";
  let agent = _wsAgents.get(key);
  if (!agent) {
    agent = new SocksProxyAgent(buildSocksUrlFor(usePerAccount ? accountId : undefined), {
      keepAlive: true,
      // Reconnect quickly if the proxy socket drops
      timeout: 30_000,
    });
    _wsAgents.set(key, agent);
  }
  return agent;
}

// ─── Global fetch proxy ───────────────────────────────────────────────────────
// Replaces undici's default dispatcher so that every globalThis.fetch() call —
// in bot.ts, routes.ts, and anywhere else — is tunnelled through SOCKS5
// automatically, with no per-call changes needed.

export async function setupGlobalFetchProxy(): Promise<void> {
  if (!isProxyConfigured()) {
    console.log("[proxy] No PROXY_HOST/PROXY_PORT — using direct connections");
    return;
  }

  const { Agent, setGlobalDispatcher } = await import("undici");
  SocksClient = require("socks").SocksClient;
  SocksProxyAgent = require("socks-proxy-agent").SocksProxyAgent;

  const proxyHost = process.env.PROXY_HOST!;
  const proxyPort = parseInt(process.env.PROXY_PORT!, 10);
  const proxyUser = process.env.PROXY_USERNAME;
  const proxyPass = process.env.PROXY_PASSWORD ?? "";

  const dispatcher = new Agent({
    // undici calls this connect() once per new TCP connection.
    // We open a SOCKS5 tunnel to the destination and hand the socket back.
    connect: (
      options: any,
      callback: (err: Error | null, socket: any) => void,
    ) => {
      const hostname: string = options.hostname || options.host;
      const port: number =
        parseInt(options.port, 10) ||
        (options.protocol === "https:" ? 443 : 80);
      const servername: string = options.servername || hostname;

      SocksClient.createConnection({
        proxy: {
          host: proxyHost,
          port: proxyPort,
          type: 5,
          ...(proxyUser ? { userId: proxyUser, password: proxyPass } : {}),
        },
        command: "connect",
        destination: { host: hostname, port },
      })
        .then(({ socket }) => {
          if (options.protocol === "https:") {
            // Upgrade the raw SOCKS tunnel to TLS.
            // Cipher suite order + ECDH curve preference are chosen to match
            // Chrome's JA3/JA4 TLS fingerprint as closely as Node.js allows.
            // Node's own default order differs significantly and is trivially
            // identified by Cloudflare's TLS fingerprinting layer.
            const tlsSocket = tls.connect({
              socket,
              servername,
              rejectUnauthorized: true,
              // Chrome-like cipher preference order (TLS 1.3 first, then 1.2)
              ciphers: [
                "TLS_AES_128_GCM_SHA256",
                "TLS_AES_256_GCM_SHA384",
                "TLS_CHACHA20_POLY1305_SHA256",
                "ECDHE-ECDSA-AES128-GCM-SHA256",
                "ECDHE-RSA-AES128-GCM-SHA256",
                "ECDHE-ECDSA-AES256-GCM-SHA384",
                "ECDHE-RSA-AES256-GCM-SHA384",
                "ECDHE-ECDSA-CHACHA20-POLY1305",
                "ECDHE-RSA-CHACHA20-POLY1305",
                "ECDHE-RSA-AES128-SHA",
                "ECDHE-RSA-AES256-SHA",
                "AES128-GCM-SHA256",
                "AES256-GCM-SHA384",
                "AES128-SHA",
                "AES256-SHA",
              ].join(":"),
              // Chrome's ECDH curve priority: X25519 first (fastest), then NIST curves
              ecdhCurve: "X25519:P-256:P-384:P-521",
              // Chrome supports TLS 1.2 minimum, 1.3 preferred
              minVersion: "TLSv1.2" as any,
              maxVersion: "TLSv1.3" as any,
              // Do NOT honor server cipher order — Chrome doesn't (client-preferred)
              honorCipherOrder: false,
            });
            tlsSocket.once("secureConnect", () => callback(null, tlsSocket));
            tlsSocket.once("error", callback);
          } else {
            callback(null, socket);
          }
        })
        .catch((err: Error) => callback(err, null));
    },

    // Keep connections alive so the proxy tunnel is reused across requests
    // rather than torn down and rebuilt on every Discord API call.
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 50,
    pipelining: 1,
  });

  setGlobalDispatcher(dispatcher);

  const auth = proxyUser ? ` (authenticated as ${proxyUser})` : "";
  console.log(`[proxy] SOCKS5 active → ${proxyHost}:${proxyPort}${auth}`);
}
