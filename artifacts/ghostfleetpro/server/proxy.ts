/**
 * Per-account proxy routing for Discord HTTP and WebSocket traffic.
 *
 * Preferred mode is an explicit SOCKS/HTTP proxy pool. Each account leases
 * one URL for its lifetime and the URL is returned to the pool on release.
 * The legacy Proxy-Cheap single-endpoint mode remains supported as a fallback.
 */

import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";
import { SocksProxyAgent } from "socks-proxy-agent";
import type { Agent } from "node:http";

const MAX_PROXY_ACCOUNTS = 50;
const PROXY_KEYS = [
  "proxy_pool",
  "socks_proxies",
  "proxy_cheap_host",
  "proxy_cheap_port",
  "proxy_cheap_username",
  "proxy_cheap_password",
  "proxy_cheap_account_count",
];

type ProxyConfig = {
  host: string;
  port: number;
  username: string;
  password: string;
  accountCount: number;
  pool: string[];
};

type ProxyLease = {
  key: string;
  url: string;
  agent: Agent;
};

function parseProxyPool(raw: unknown): string[] {
  const value = String(raw ?? "").trim();
  if (!value) return [];

  let values: unknown[] = [];
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) values = parsed;
    } catch {
      // Fall through to delimiter parsing so one malformed JSON value does
      // not silently disable a correctly supplied newline-separated pool.
    }
  }
  if (values.length === 0) values = value.split(/[\n,;]+/);

  return Array.from(
    new Set(
      values
        .map((entry) => String(entry).trim())
        .filter((entry) => /^(socks4|socks4a|socks5|socks5h|http|https):\/\//i.test(entry)),
    ),
  );
}

function readEnvConfig(): ProxyConfig {
  const port = Number(process.env.PROXY_CHEAP_PORT || process.env.PROXY_PORT || 0);
  const accountCount = Number(
    process.env.PROXY_CHEAP_ACCOUNT_COUNT ||
      process.env.PROXY_ACCOUNT_COUNT ||
      1,
  );
  return {
    host: process.env.PROXY_CHEAP_HOST || process.env.PROXY_HOST || "",
    port: Number.isInteger(port) ? port : 0,
    username:
      process.env.PROXY_CHEAP_USERNAME || process.env.PROXY_USERNAME || "",
    password:
      process.env.PROXY_CHEAP_PASSWORD || process.env.PROXY_PASSWORD || "",
    accountCount:
      Number.isInteger(accountCount) && accountCount > 0
        ? Math.min(accountCount, MAX_PROXY_ACCOUNTS)
        : 1,
    pool: parseProxyPool(
      process.env.SOCKS_PROXIES ||
        process.env.PROXY_POOL ||
        process.env.SOCKS_PROXY_POOL,
    ),
  };
}

let proxyConfig = readEnvConfig();
const proxyLeases = new Map<string, ProxyLease>();
const freePoolKeys = new Set<string>();
let warnedAboutProxyExhaustion = false;

function resetFreePool(): void {
  freePoolKeys.clear();
  proxyConfig.pool.forEach((_, index) => freePoolKeys.add(String(index)));
}

resetFreePool();

export function isProxyConfigured(): boolean {
  return proxyConfig.pool.length > 0 || Boolean(proxyConfig.host && proxyConfig.port > 0);
}

export function validateProxySettings(
  settings: Record<string, unknown>,
): string | null {
  const pool = parseProxyPool(settings.proxy_pool ?? settings.socks_proxies);
  if (pool.length > MAX_PROXY_ACCOUNTS) {
    return `Proxy pool cannot contain more than ${MAX_PROXY_ACCOUNTS} entries`;
  }
  const host = String(settings.proxy_cheap_host ?? "").trim();
  const portValue = String(settings.proxy_cheap_port ?? "").trim();
  const countValue = String(settings.proxy_cheap_account_count ?? "").trim();

  if ((host && !portValue) || (!host && portValue)) {
    return "Proxy-Cheap host and port must be provided together";
  }
  if (portValue) {
    const port = Number(portValue);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return "Proxy-Cheap port must be between 1 and 65535";
    }
  }
  if (countValue) {
    const count = Number(countValue);
    if (!Number.isInteger(count) || count < 1 || count > MAX_PROXY_ACCOUNTS) {
      return `Proxy-Cheap account count must be between 1 and ${MAX_PROXY_ACCOUNTS}`;
    }
  }
  return null;
}

function proxyUrl(accountId?: string): string {
  if (proxyConfig.pool.length > 0) {
    return proxyLeases.get(accountId || "")?.url || proxyConfig.pool[0];
  }
  const sessionSuffix = accountId
    ? `-session-${accountId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48)}`
    : "";
  const username = proxyConfig.username
    ? encodeURIComponent(`${proxyConfig.username}${sessionSuffix}`)
    : "";
  const auth = username
    ? `${username}:${encodeURIComponent(proxyConfig.password)}@`
    : "";
  return `http://${auth}${proxyConfig.host}:${proxyConfig.port}`;
}

function createAgent(url: string): Agent {
  if (/^socks/i.test(url)) {
    return new SocksProxyAgent(url);
  }
  return new HttpsProxyAgent(url, {
    keepAlive: true,
    timeout: 30_000,
  });
}

function getProxyLease(accountId?: string): ProxyLease {
  const leaseKey = accountId || "__bootstrap__";
  const existing = proxyLeases.get(leaseKey);
  if (existing) return existing;

  if (proxyConfig.pool.length > 0) {
    const poolKey = freePoolKeys.values().next().value as string | undefined;
    if (poolKey === undefined) {
      if (!warnedAboutProxyExhaustion) {
        warnedAboutProxyExhaustion = true;
        console.warn(
          `[proxy] No free proxy remains for account ${accountId || "bootstrap"}; ` +
            "refusing to fall back to the VPS IP",
        );
      }
      throw new Error("No free SOCKS proxy is available for this account");
    }
    freePoolKeys.delete(poolKey);
    const url = proxyConfig.pool[Number(poolKey)];
    const lease = { key: poolKey, url, agent: createAgent(url) };
    proxyLeases.set(leaseKey, lease);
    return lease;
  }

  const url = proxyUrl(accountId);
  const lease = { key: "__shared__", url, agent: createAgent(url) };
  proxyLeases.set(leaseKey, lease);
  return lease;
}

export function releaseProxy(accountId: string): void {
  const lease = proxyLeases.get(accountId);
  if (!lease) return;
  proxyLeases.delete(accountId);
  if (proxyConfig.pool.length > 0 && lease.key !== "__shared__") {
    freePoolKeys.add(lease.key);
    warnedAboutProxyExhaustion = false;
  }
  const destroy = (lease.agent as Agent & { destroy?: () => void }).destroy;
  destroy?.call(lease.agent);
  console.log(`[proxy] Released ${lease.url.replace(/\/\/.*@/, "//***@")} from account ${accountId}`);
}

export function getWsAgent(
  accountId?: string,
): Agent | undefined {
  if (!isProxyConfigured()) return undefined;
  return getProxyLease(accountId).agent;
}

/**
 * Use node-fetch here because its `agent` option accepts https-proxy-agent.
 * Native fetch/undici does not accept a Node HTTP agent on a per-request basis.
 */
export function proxyFetch(
  url: string,
  init: Record<string, any> = {},
  accountId?: string,
): Promise<any> {
  if (!isProxyConfigured()) return fetch(url, init as any);
  const lease = getProxyLease(accountId);
  return fetch(url, {
    ...init,
    agent: lease.agent,
  } as any);
}

export function applyProxySettings(settings: Record<string, unknown>): void {
  const hasProxySettings = PROXY_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(settings, key),
  );
  if (!hasProxySettings) return;

  const current = proxyConfig;
  const next: ProxyConfig = {
    host: String(settings.proxy_cheap_host ?? current.host).trim(),
    port: Number(settings.proxy_cheap_port ?? current.port) || 0,
    username: String(
      settings.proxy_cheap_username ?? current.username,
    ).trim(),
    password: String(settings.proxy_cheap_password ?? current.password),
    accountCount:
      Number(settings.proxy_cheap_account_count ?? current.accountCount) || 1,
    pool: parseProxyPool(
      settings.proxy_pool ??
        settings.socks_proxies ??
        current.pool.join("\n"),
    ),
  };

  for (const accountId of Array.from(proxyLeases.keys())) {
    if (accountId !== "__bootstrap__") releaseProxy(accountId);
  }
  const bootstrap = proxyLeases.get("__bootstrap__");
  if (bootstrap) {
    proxyLeases.delete("__bootstrap__");
    (bootstrap.agent as Agent & { destroy?: () => void }).destroy?.();
  }
  proxyConfig = {
    ...next,
    accountCount: Math.min(
      Math.max(1, Math.trunc(next.accountCount)),
      MAX_PROXY_ACCOUNTS,
    ),
  };
  resetFreePool();
  warnedAboutProxyExhaustion = false;
  console.log(
    isProxyConfigured()
      ? proxyConfig.pool.length > 0
        ? `[proxy] SOCKS proxy pool active (${proxyConfig.pool.length} free proxies)`
        : `[proxy] Proxy-Cheap active → ${proxyConfig.host}:${proxyConfig.port}`
      : "[proxy] Proxy-Cheap disabled — using direct connections",
  );
}

export async function setupGlobalFetchProxy(): Promise<void> {
  // Load values saved from the Configuration page when present. Environment
  // variables remain the fallback for VPS deployments that do not use the UI.
  try {
    const { storage } = await import("./storage");
    applyProxySettings(await storage.getConfig());
  } catch {
    // MongoDB may not be available during an early boot; env values still work.
  }

  if (!isProxyConfigured()) {
    console.log("[proxy] No proxy pool or Proxy-Cheap host/port — using direct connections");
  }
}