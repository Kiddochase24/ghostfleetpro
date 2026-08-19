/**
 * Per-account Proxy-Cheap routing for Discord HTTP and WebSocket traffic.
 *
 * Proxy-Cheap uses an HTTP proxy URL. Appending `-session-accN` to the base
 * username gives each bot instance its own sticky session while keeping the
 * password and endpoint shared.
 */

import fetch from "node-fetch";
import { HttpsProxyAgent } from "https-proxy-agent";

const MAX_PROXY_ACCOUNTS = 50;
const PROXY_KEYS = [
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
};

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
  };
}

let proxyConfig = readEnvConfig();
const proxyAgents = new Map<string, HttpsProxyAgent<string>>();
const sessionSlots = new Map<string, number>();
let nextSessionSlot = 1;
let warnedAboutAccountLimit = false;

export function isProxyConfigured(): boolean {
  return Boolean(proxyConfig.host && proxyConfig.port > 0);
}

export function validateProxySettings(
  settings: Record<string, unknown>,
): string | null {
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
  const session = getSessionTag(accountId);
  const username = proxyConfig.username
    ? `${proxyConfig.username}-session-${session}`
    : "";
  const auth = username
    ? `${encodeURIComponent(username)}:${encodeURIComponent(proxyConfig.password)}@`
    : "";
  return `http://${auth}${proxyConfig.host}:${proxyConfig.port}`;
}

function getProxyAgent(accountId?: string): HttpsProxyAgent<string> {
  const key = accountId || "__unassigned__";
  let agent = proxyAgents.get(key);
  if (!agent) {
    agent = new HttpsProxyAgent(proxyUrl(accountId), {
      keepAlive: true,
      timeout: 30_000,
    });
    proxyAgents.set(key, agent);
  }
  return agent;
}

function getSessionTag(accountId?: string): string {
  if (!accountId) return "acc1";
  const existing = sessionSlots.get(accountId);
  if (existing) return `acc${existing}`;

  const slot = nextSessionSlot++;
  sessionSlots.set(accountId, slot);
  if (slot > proxyConfig.accountCount && !warnedAboutAccountLimit) {
    warnedAboutAccountLimit = true;
    console.warn(
      `[proxy] More than ${proxyConfig.accountCount} accounts are active; ` +
        "continuing with unique session tags beyond the configured count",
    );
  }
  return `acc${slot}`;
}

export function getWsAgent(
  accountId?: string,
): HttpsProxyAgent<string> | undefined {
  if (!isProxyConfigured()) return undefined;
  return getProxyAgent(accountId);
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
  return fetch(url, {
    ...init,
    ...(isProxyConfigured() ? { agent: getProxyAgent(accountId) } : {}),
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
  };

  proxyConfig = {
    ...next,
    accountCount: Math.min(
      Math.max(1, Math.trunc(next.accountCount)),
      MAX_PROXY_ACCOUNTS,
    ),
  };
  proxyAgents.clear();
  warnedAboutAccountLimit = false;
  console.log(
    isProxyConfigured()
      ? `[proxy] Proxy-Cheap active → ${proxyConfig.host}:${proxyConfig.port} ` +
        `(${proxyConfig.accountCount} session slots)`
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
    console.log("[proxy] No Proxy-Cheap host/port — using direct connections");
  }
}