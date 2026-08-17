import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { storage } from "./storage";
import { initBotEngine, sendTestMessage, getGatewayStatus, refreshSessions, invalidateRulesCache, getDevFleetEnabled, setDevFleetEnabled, syncRosterFromRules, setPrimaryAccount, clearPrimaryAccount, recomputeRotation, getRosterHealthSnapshot } from "./bot";
import { z } from "zod";
import os from "os";
import crypto from "crypto";

const DISCORD_API = "https://discord.com/api/v10";

// Active WebSocket clients
const wsClients = new Set<WebSocket>();

function broadcast(event: string, data: any) {
  const msg = JSON.stringify({ event, data, ts: Date.now() });
  wsClients.forEach(client => {
    if (client.readyState !== WebSocket.OPEN) return;
    // Never let a slow admin/dashboard browser build an unbounded outbound
    // buffer or throw while the gateway is broadcasting recovery events.
    if (client.bufferedAmount > 1024 * 1024) {
      try { client.terminate(); } catch {}
      wsClients.delete(client);
      return;
    }
    try { client.send(msg); } catch { wsClients.delete(client); }
  });
}

// Build per-account browser-authentic headers for REST calls.
// Mirrors what bot.ts makeHeaders() produces — token-tagged requests (guild
// list, channel list) must carry the same fingerprint as the gateway session.
function accountHeaders(accountId: string, token: string): Record<string, string> {
  // Inline the same fingerprint logic used in bot.ts so routes.ts stays
  // self-contained (avoids a circular import through bot.ts exports).
  const CHROME_POOL_R = [
    "130.0.0.0","131.0.0.0","132.0.0.0","133.0.0.0",
    "134.0.0.0","135.0.0.0","136.0.0.0","137.0.0.0",
  ];
  const LOCALE_POOL_R = ["en-US","en-US","en-US","en-US","en-GB","en-CA","en-AU"];
  const TZ_POOL_R = [
    "America/New_York","America/New_York","America/Chicago",
    "America/Los_Angeles","Europe/London","Europe/Paris","Europe/Berlin",
  ];
  const BUILD_POOL_R = [354780,362019,369371,378453,385467,392021,397104,403028];
  function h32(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  }
  const hv = h32(accountId);
  const chrome  = CHROME_POOL_R[hv % CHROME_POOL_R.length];
  const locale  = LOCALE_POOL_R[(hv >>> 6) % LOCALE_POOL_R.length];
  const tz      = TZ_POOL_R[(hv >>> 12) % TZ_POOL_R.length];
  const build   = BUILD_POOL_R[(hv >>> 9) % BUILD_POOL_R.length];
  const major   = chrome.split(".")[0];
  const ua      = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  const superProps = Buffer.from(JSON.stringify({
    os: "Windows", browser: "Chrome", device: "",
    system_locale: locale, has_client_mods: false,
    browser_user_agent: ua, browser_version: chrome, os_version: "10.0.0",
    referrer: "", referring_domain: "", referrer_current: "",
    referring_domain_current: "", release_channel: "stable",
    client_build_number: build, client_event_source: null,
  })).toString("base64");
  return {
    "Authorization": token,
    "User-Agent": ua,
    "Accept": "*/*",
    "Accept-Language": `${locale},en;q=0.9`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "sec-ch-ua": `"Google Chrome";v="${major}", "Chromium";v="${major}", "Not/A)Brand";v="8"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "X-Discord-Locale": locale,
    "X-Discord-Timezone": tz,
    "X-Super-Properties": superProps,
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/channels/@me",
  };
}

async function discordFetch(path: string, token: string, accountId?: string) {
  const start = Date.now();
  const headers = accountId
    ? accountHeaders(accountId, token)
    : {
        "Authorization": token,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "sec-ch-ua": '"Google Chrome";v="137", "Chromium";v="137", "Not/A)Brand";v="8"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        "Origin": "https://discord.com",
        "Referer": "https://discord.com/channels/@me",
      };
  const res = await fetch(`${DISCORD_API}${path}`, { headers });
  return { res, latency: Date.now() - start };
}

// System stats
let sysStats = { cpu: 0, mem: 0, latency: 0 };

async function collectSysStats() {
  const cpuUsage = os.loadavg()[0];
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  sysStats = {
    cpu: Math.min(100, Math.round(cpuUsage * 10)),
    mem: Math.round(((totalMem - freeMem) / totalMem) * 100),
    latency: 0,
  };
}

setInterval(collectSysStats, 2000);
setInterval(() => broadcast("sysStats", sysStats), 2000);

// Console buffer
const consoleBuffer: string[] = [];
const responseCache = new Map<string, {
  value?: any;
  expiresAt: number;
  pending?: Promise<any>;
}>();

/** Delete every cache entry whose key starts with the given prefix. */
function bustCache(prefix: string) {
  for (const key of responseCache.keys()) {
    if (key.startsWith(prefix)) responseCache.delete(key);
  }
}

async function cachedResponse<T>(
  key: string,
  ttlMs: number,
  load: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const existing = responseCache.get(key);
  if (existing?.value !== undefined && existing.expiresAt > now) {
    return existing.value as T;
  }
  if (existing?.pending) return existing.pending as Promise<T>;

  const pending = load().then((value) => {
    responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }).finally(() => {
    const current = responseCache.get(key);
    if (current?.pending === pending) {
      responseCache.set(key, {
        value: current.value,
        expiresAt: current.expiresAt,
      });
    }
  });
  responseCache.set(key, {
    value: existing?.value,
    expiresAt: existing?.expiresAt ?? 0,
    pending,
  });
  return pending;
}

function logToConsole(msg: string, workspaceId?: number) {
  const ts = new Date().toISOString();
  const wsTag = workspaceId ? `[WS:${workspaceId}] ` : "";
  const line = `[${ts}] ${wsTag}${msg}`;
  consoleBuffer.push(line);
  if (consoleBuffer.length > 200) consoleBuffer.shift();
  broadcast("console", line);
}

// Get workspace ID from request header
function getWorkspaceId(req: Request): number | undefined {
  const header = req.headers["x-workspace-id"];
  if (header) {
    const n = parseInt(header as string);
    if (!isNaN(n)) return n;
  }
  return undefined;
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {

  // === 24-HOUR HISTORY PURGE ===
  // Runs immediately on startup, then every 24 hours.
  // Keeps memory and DB footprint small — Telegram already has the full log.
  const runHistoryPurge = async () => {
    try {
      const deleted = await storage.deleteOldHistory(24 * 60 * 60 * 1000);
      if (deleted > 0) logToConsole(`MAINTENANCE: Purged ${deleted} history record(s) older than 24h`);
    } catch (e: any) {
      logToConsole(`MAINTENANCE ERR: history purge failed — ${e.message}`);
    }
  };
  runHistoryPurge();
  setInterval(runHistoryPurge, 24 * 60 * 60 * 1000);

  // === WEBSOCKET ===
  const wsPath = `${(process.env.BASE_PATH || "/").replace(/\/+$/, "")}/ws` || "/ws";
  const wss = new WebSocketServer({ server: httpServer, path: wsPath });
  wss.on("connection", (ws) => {
    wsClients.add(ws);
    (ws as any).isAlive = true;
    const socket = (ws as any)._socket as {
      setKeepAlive?: (enable: boolean, initialDelay?: number) => void;
      setNoDelay?: (noDelay?: boolean) => void;
    } | undefined;
    socket?.setKeepAlive?.(true, 30000);
    socket?.setNoDelay?.(true);

    // Low-level pong (keeps connection alive through proxies)
    ws.on("pong", () => { (ws as any).isAlive = true; });

    // App-level ping/pong — client sends {type:"ping",ts}, server echoes
    ws.on("message", (raw) => {
      try {
        const m = JSON.parse(raw.toString());
        if (m && m.type === "ping") {
          (ws as any).isAlive = true;
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: "pong", data: { ts: m.ts ?? Date.now() }, ts: Date.now() }));
          }
        }
      } catch {}
    });

    ws.send(JSON.stringify({ event: "connected", data: { msg: "Ghost Fleet connected." }, ts: Date.now() }));
    consoleBuffer.slice(-30).forEach(line => ws.send(JSON.stringify({ event: "console", data: line, ts: Date.now() })));
    ws.on("close", () => wsClients.delete(ws));
    ws.on("error", () => wsClients.delete(ws));
  });

  // Heartbeat sweep — terminate dead sockets, ping live ones every 30s
  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((client: any) => {
      if (client.isAlive === false) {
        wsClients.delete(client);
        try { client.terminate(); } catch {}
        return;
      }
      client.isAlive = false;
      try { client.ping(); } catch {}
    });
  }, 30000);
  wss.on("close", () => clearInterval(heartbeatTimer));

  // === WORKSPACES ===
  app.get("/api/workspaces", async (req, res) => {
    const wsList = await storage.getWorkspaces();
    // Return names only (no passwords)
    res.json(wsList.map(w => ({ id: w.id, name: w.name, createdAt: w.createdAt })));
  });

  app.post("/api/workspaces", async (req, res) => {
    try {
      const { name, password } = z.object({
        name: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Only letters, numbers, _ and - allowed"),
        password: z.string().optional(),
      }).parse(req.body);

      const existing = await storage.getWorkspaceByName(name);
      if (existing) return res.status(409).json({ error: "Workspace name already taken" });

      const ws = await storage.createWorkspace({ name, password: password || null });
      logToConsole(`WORKSPACE CREATED: ghostx${name} (ID: ${ws.id})`);
      res.status(201).json({ id: ws.id, name: ws.name, createdAt: ws.createdAt });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/workspaces/login", async (req, res) => {
    try {
      const { name, password } = z.object({ name: z.string(), password: z.string().optional() }).parse(req.body);
      const ws = await storage.getWorkspaceByName(name);
      if (!ws) return res.status(404).json({ error: "Workspace not found" });
      if (ws.password && ws.password !== password) return res.status(401).json({ error: "Invalid password" });
      logToConsole(`WORKSPACE LOGIN: ghostx${ws.name} (ID: ${ws.id})`);
      res.json({ id: ws.id, name: ws.name, createdAt: ws.createdAt });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/workspaces/:id", async (req, res) => {
    await storage.deleteWorkspace(parseInt(req.params.id));
    res.status(204).send();
  });

  // === WORKSPACE EXPORT / IMPORT ===
  app.get("/api/workspace/export", async (req, res) => {
    try {
      const wsId = getWorkspaceId(req);
      const [accs, rulesList] = await Promise.all([
        storage.getAccounts(wsId),
        storage.getRules(wsId),
      ]);
      res.json({
        version: 1,
        exportedAt: new Date().toISOString(),
        accounts: accs.map(a => ({
          id: a.id,
          name: a.name,
          token: a.token,
          avatar: a.avatar,
          username: a.username,
          discriminator: a.discriminator,
          guilds: a.guilds,
          status: a.status,
        })),
        rules: rulesList.map(r => ({
          label: r.label,
          triggerCondition: r.triggerCondition,
          keyword: r.keyword,
          profileId: r.profileId,
          selectedServers: r.selectedServers,
          selectedChannels: r.selectedChannels,
          allChannels: r.allChannels,
          actionType: r.actionType,
          message: r.message,
          delayMode: r.delayMode,
          delayMs: r.delayMs,
          deleteDelayMs: r.deleteDelayMs,
          isActive: r.isActive,
          telegramEnabled: r.telegramEnabled,
          telegramToken: r.telegramToken,
          telegramChatId: r.telegramChatId,
          crossServerCheck: r.crossServerCheck,
          crossServerGuildId: r.crossServerGuildId,
          profileConfigs: r.profileConfigs,
          botMode: r.botMode,
          replyInThread: r.replyInThread,
          adminGuardEnabled: r.adminGuardEnabled,
          adminRoleId: r.adminRoleId,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/workspace/import", async (req, res) => {
    try {
      const wsId = getWorkspaceId(req);
      const { accounts: importAccounts = [], rules: importRules = [] } = req.body as {
        accounts: any[];
        rules: any[];
      };

      let accountsImported = 0;
      let accountsSkipped = 0;
      let rulesImported = 0;

      for (const acc of importAccounts) {
        try {
          const existing = await storage.getAccount(acc.id);
          if (existing) {
            accountsSkipped++;
            continue;
          }
          await storage.createAccount({
            id: acc.id,
            name: acc.name,
            token: acc.token,
            status: acc.status || "Connected",
            avatar: acc.avatar,
            username: acc.username,
            discriminator: acc.discriminator,
            workspaceId: wsId,
          });
          if (acc.guilds?.length) {
            await storage.updateAccountGuilds(acc.id, acc.guilds);
          }
          accountsImported++;
        } catch { accountsSkipped++; }
      }

      for (const rule of importRules) {
        try {
          await storage.createRule({
            label: rule.label,
            triggerCondition: rule.triggerCondition || "keyword",
            keyword: rule.keyword,
            profileId: rule.profileId || "all",
            selectedServers: rule.selectedServers || [],
            selectedChannels: rule.selectedChannels || [],
            allChannels: rule.allChannels || false,
            actionType: rule.actionType || "text",
            message: rule.message,
            delayMode: rule.delayMode || "instant",
            delayMs: rule.delayMs || 0,
            deleteDelayMs: rule.deleteDelayMs || 0,
            isActive: rule.isActive !== false,
            telegramEnabled: rule.telegramEnabled || false,
            telegramToken: rule.telegramToken,
            telegramChatId: rule.telegramChatId,
            crossServerCheck: rule.crossServerCheck || false,
            crossServerGuildId: rule.crossServerGuildId,
            profileConfigs: rule.profileConfigs || {},
            botMode: rule.botMode || false,
            replyInThread: rule.replyInThread || false,
            adminGuardEnabled: rule.adminGuardEnabled || false,
            adminRoleId: rule.adminRoleId,
            workspaceId: wsId,
          });
          rulesImported++;
        } catch { }
      }

      logToConsole(`IMPORT: ${accountsImported} accounts + ${rulesImported} rules imported (${accountsSkipped} accounts skipped — already exist)`, wsId);
      refreshSessions();
      res.json({ accountsImported, accountsSkipped, rulesImported });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // === ACCOUNTS ===
  app.get("/api/accounts", async (req, res) => {
    const wsId = getWorkspaceId(req);
    const key = `accounts:${wsId ?? "all"}`;
    res.json(await cachedResponse(key, 15_000, () => storage.getAccounts(wsId)));
  });

  app.post("/api/accounts", async (req, res) => {
    try {
      const wsId = getWorkspaceId(req);
      const { token, name } = z.object({ token: z.string().min(1), name: z.string().min(1) }).parse(req.body);

      const start = Date.now();
      // Use a temporary fingerprint keyed on the token itself (account ID not known yet)
      const tempHeaders = accountHeaders(crypto.createHash("md5").update(token).digest("hex"), token);
      const meRes = await fetch(`${DISCORD_API}/users/@me`, { headers: tempHeaders });
      const latency = Date.now() - start;

      if (!meRes.ok) {
        return res.status(401).json({ error: `Discord rejected token (${meRes.status}). Make sure it's a valid user token.` });
      }

      const user = await meRes.json() as any;
      const avatarUrl = user.avatar
        ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
        : `https://cdn.discordapp.com/embed/avatars/${parseInt(user.discriminator || "0") % 5}.png`;

      let guilds: any[] = [];
      try {
        // Now we have the real account ID — use proper per-account fingerprint
        const guildsRes = await fetch(`${DISCORD_API}/users/@me/guilds`, {
          headers: accountHeaders(user.id, token),
        });
        if (guildsRes.ok) guilds = await guildsRes.json();
      } catch {}

      const acc = await storage.createAccount({
        id: user.id,
        name,
        token,
        status: "Connected",
        avatar: avatarUrl,
        username: user.username,
        discriminator: user.discriminator || "0",
        workspaceId: wsId,
      });
      await storage.updateAccountGuilds(user.id, guilds);

      logToConsole(`ACCOUNT LINKED: ${name} (@${user.username}) | ${guilds.length} servers | ${latency}ms`, wsId);
      broadcast("accountLinked", { id: user.id, name, username: user.username });
      bustCache("accounts:");
      refreshSessions();

      res.status(201).json({ ...acc, guilds });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message });
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/accounts/:id", async (req, res) => {
    const wsId = getWorkspaceId(req);
    await storage.deleteAccount(req.params.id);
    bustCache("accounts:");
    logToConsole(`ACCOUNT REMOVED: ${req.params.id}`, wsId);
    res.status(204).send();
  });

  app.post("/api/accounts/:id/refresh", async (req, res) => {
    try {
      const acc = await storage.getAccount(req.params.id);
      if (!acc) return res.status(404).json({ error: "Account not found" });

      const { res: guildsRes } = await discordFetch("/users/@me/guilds", acc.token, acc.id);
      if (!guildsRes.ok) {
        await storage.updateAccountStatus(acc.id, "Disconnected");
        return res.status(401).json({ error: "Token invalid or expired" });
      }
      const guilds = await guildsRes.json() as any[];
      await storage.updateAccountGuilds(acc.id, guilds);
      await storage.updateAccountStatus(acc.id, "Connected");
      bustCache("accounts:");
      logToConsole(`GUILDS REFRESHED: ${acc.name} | ${guilds.length} servers`);
      res.json({ guilds });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/accounts/:id/guilds/:guildId/channels", async (req, res) => {
    try {
      const acc = await storage.getAccount(req.params.id);
      if (!acc) return res.status(404).json({ error: "Account not found" });

      const { res: chanRes } = await discordFetch(`/guilds/${req.params.guildId}/channels`, acc.token, acc.id);
      if (!chanRes.ok) return res.status(chanRes.status).json({ error: "Failed to fetch channels" });

      const channels = await chanRes.json() as any[];
      const textChannels = channels
        .filter((c: any) => c.type === 0)
        .sort((a: any, b: any) => a.position - b.position)
        .map((c: any) => ({ id: c.id, name: c.name, type: c.type, position: c.position }));
      res.json(textChannels);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // === RULES ===
  app.get("/api/rules", async (req, res) => {
    const wsId = getWorkspaceId(req);
    const key = `rules:${wsId ?? "all"}`;
    res.json(await cachedResponse(key, 15_000, () => storage.getRules(wsId)));
  });

  app.post("/api/rules", async (req, res) => {
    try {
      const wsId = getWorkspaceId(req);
      const body = req.body;
      const allChan = body.allChannels || false;
      // Strip selectedChannels when allChannels=true — avoids massive payloads
      // When allChannels is true per profileConfig, strip those channel lists too
      let profileConfigs = body.profileConfigs || null;
      if (profileConfigs && typeof profileConfigs === "object") {
        profileConfigs = Object.fromEntries(
          Object.entries(profileConfigs).map(([k, v]: [string, any]) => [
            k,
            v.allChannels ? { ...v, selectedChannels: [] } : v,
          ])
        );
      }
      const rule = await storage.createRule({
        label: body.label,
        triggerCondition: body.triggerCondition || "keyword",
        keyword: body.keyword || null,
        profileId: body.profileId || "all",
        selectedServers: body.selectedServers || [],
        selectedChannels: allChan ? [] : (body.selectedChannels || []),
        allChannels: allChan,
        actionType: body.actionType || "text",
        message: body.message,
        delayMode: body.delayMode || "instant",
        delayMs: parseInt(body.delayMs) || 0,
        isActive: body.isActive !== false,
        telegramEnabled: body.telegramEnabled || false,
        telegramToken: body.telegramToken || null,
        telegramChatId: body.telegramChatId || null,
        crossServerCheck: body.crossServerCheck || false,
        crossServerGuildId: body.crossServerGuildId || null,
        botMode: body.botMode || false,
        workspaceId: wsId,
        profileConfigs,
        aiFilterEnabled: body.aiFilterEnabled ?? false,
      });
      invalidateRulesCache();
      bustCache("rules:");
      logToConsole(`RULE CREATED: "${rule.label}" (ID: ${rule.id})`, wsId);
      broadcast("ruleCreated", rule);
      res.status(201).json(rule);
      // Fire-and-forget: sync the global roster so any newly-checked servers
      // get a joinedAt timestamp = right now, and rotation recomputes
      syncRosterFromRules().catch((e) => logToConsole(`ROSTER SYNC ERR: ${e.message}`));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.put("/api/rules/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const body = req.body;
      // Strip selectedChannels when allChannels=true, same as POST
      if (body.allChannels) body.selectedChannels = [];
      if (body.profileConfigs && typeof body.profileConfigs === "object") {
        body.profileConfigs = Object.fromEntries(
          Object.entries(body.profileConfigs).map(([k, v]: [string, any]) => [
            k,
            v.allChannels ? { ...v, selectedChannels: [] } : v,
          ])
        );
      }
      const updated = await storage.updateRule(id, body);
      invalidateRulesCache();
      bustCache("rules:");
      logToConsole(`RULE UPDATED: ID ${id} "${updated.label}"`);
      res.json(updated);
      // Fire-and-forget: any newly checked server gets joinedAt = right now,
      // any unchecked server rolls its roster entry to "left" + rotates
      syncRosterFromRules().catch((e) => logToConsole(`ROSTER SYNC ERR: ${e.message}`));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/rules/:id", async (req, res) => {
    const id = parseInt(req.params.id);
    const wsId = getWorkspaceId(req);
    await storage.deleteRule(id);
    invalidateRulesCache();
    bustCache("rules:");
    logToConsole(`RULE DELETED: ID ${id}`, wsId);
    res.status(204).send();
    syncRosterFromRules().catch((e) => logToConsole(`ROSTER SYNC ERR: ${e.message}`));
  });

  // === HISTORY ===
  app.get("/api/history", async (req, res) => {
    const wsId = getWorkspaceId(req);
    const key = `history:${wsId ?? "all"}`;
    res.json(await cachedResponse(key, 30_000, () => storage.getHistory(wsId)));
  });

  // === CONFIG ===
  app.get("/api/config", async (req, res) => {
    res.json(await storage.getConfig());
  });

  app.post("/api/config", async (req, res) => {
    try {
      const entries = Object.entries(req.body) as [string, string][];
      for (const [key, value] of entries) {
        if (typeof value === "string") await storage.setConfig(key, value);
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // === STATS ===
  app.get("/api/stats", async (req, res) => {
    const wsId = getWorkspaceId(req);
    const key = `stats:${wsId ?? "all"}`;
    const stats = await cachedResponse(key, 30_000, () => storage.getStats(wsId));
    res.json({ ...stats, ...sysStats });
  });

  app.get("/api/system", async (_req, res) => res.json(sysStats));
  app.get("/api/console", async (_req, res) => res.json(consoleBuffer.slice(-50)));

  app.post("/api/verify-token", async (req, res) => {
    try {
      const { token } = z.object({ token: z.string() }).parse(req.body);
      const start = Date.now();
      const verifyHeaders = accountHeaders(
        crypto.createHash("md5").update(token).digest("hex"),
        token,
      );
      const meRes = await fetch(`${DISCORD_API}/users/@me`, { headers: verifyHeaders });
      const latency = Date.now() - start;
      if (!meRes.ok) return res.json({ valid: false, latency });
      const user = await meRes.json() as any;
      res.json({ valid: true, user, latency });
    } catch {
      res.json({ valid: false, latency: 0 });
    }
  });

  // === LICENSE SYSTEM ===
  const ADMIN_SECRET = process.env.ADMIN_SECRET || "";

  function requireAdmin(req: Request, res: Response): boolean {
    const key = req.headers["x-admin-key"] as string || req.body?.adminKey || "";
    if (!ADMIN_SECRET || key !== ADMIN_SECRET) {
      res.status(403).json({ error: "Forbidden" });
      return false;
    }
    return true;
  }

  function generateLicenseCode(): string {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const seg = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
    return `${seg()}-${seg()}-${seg()}-${seg()}`;
  }

  // Check if device fingerprint is licensed
  app.post("/api/license/check", async (req, res) => {
    try {
      const { fingerprint } = req.body;
      if (!fingerprint || fingerprint.length < 8) return res.json({ licensed: false });
      const lic = await storage.getLicenseByFingerprint(fingerprint);
      res.json({ licensed: !!lic });
    } catch (err: any) {
      res.status(500).json({ licensed: false, error: err.message });
    }
  });

  // Activate a license code for a device fingerprint
  app.post("/api/license/activate", async (req, res) => {
    try {
      const { code, fingerprint } = req.body;
      if (!code || !fingerprint) return res.status(400).json({ success: false, message: "Missing code or fingerprint" });

      const normalizedCode = String(code).trim().toUpperCase();
      const lic = await storage.getLicense(normalizedCode);

      if (!lic) return res.json({ success: false, message: "Invalid license key. Please check and try again." });
      if (!lic.isActive) return res.json({ success: false, message: "This license key has been revoked." });

      // Already bound to another device
      if (lic.fingerprint && lic.fingerprint !== fingerprint) {
        return res.json({ success: false, message: "This license is already registered to another device." });
      }

      // Activate (or confirm for same device)
      await storage.activateLicense(normalizedCode, fingerprint);
      res.json({ success: true, message: "License activated successfully." });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // === ADMIN — License Management (requires X-Admin-Key header) ===
  app.get("/api/admin/licenses", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const lics = await storage.getLicenses();
      res.json(lics);
    } catch (err: any) {
      console.error("[admin] getLicenses failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/licenses/generate", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { count = 1, label = "" } = req.body;
      const n = Math.min(Math.max(parseInt(count) || 1, 1), 50);
      const created = [];
      for (let i = 0; i < n; i++) {
        let code = generateLicenseCode();
        while (await storage.getLicense(code)) code = generateLicenseCode();
        const lic = await storage.createLicense(code, label || undefined);
        created.push(lic);
      }
      res.json({ created });
    } catch (err: any) {
      console.error("[admin] generate failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.delete("/api/admin/licenses/:code", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await storage.revokeLicense(req.params.code.toUpperCase());
      res.json({ ok: true });
    } catch (err: any) {
      console.error("[admin] revoke failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // === NOWPAYMENTS IPN WEBHOOK ===
  app.post("/api/webhook/purchase", async (req, res) => {
    const ipnSignature = req.headers["x-nowpayments-sig"] as string;
    const secret = process.env.NOWPAYMENTS_IPN_SECRET;

    if (!secret) {
      console.error("[NowPayments] NOWPAYMENTS_IPN_SECRET is not set");
      return res.status(500).send("Server misconfiguration");
    }

    // Verify HMAC-SHA512 signature
    const hmac = crypto.createHmac("sha512", secret);
    // NowPayments requires sorted keys for the signature
    const sortedBody = JSON.stringify(
      Object.keys(req.body).sort().reduce((acc: Record<string, unknown>, k) => {
        acc[k] = req.body[k];
        return acc;
      }, {})
    );
    hmac.update(sortedBody);
    const signature = hmac.digest("hex");

    if (signature !== ipnSignature) {
      console.warn("[NowPayments] Invalid IPN signature — possible spoofed request");
      return res.status(403).send("Invalid signature");
    }

    if (req.body.payment_status === "finished") {
      try {
        const orderId = String(req.body.order_id || req.body.payment_id || "");
        const label = orderId || `NowPayments #${req.body.payment_id}`;

        let code = generateLicenseCode();
        while (await storage.getLicense(code)) code = generateLicenseCode();
        const lic = await storage.createLicense(code, label);

        console.log(`[NowPayments] Payment confirmed for order: ${orderId} — License generated: ${lic.code}`);
      } catch (err: any) {
        console.error("[NowPayments] License generation failed:", err.message);
        return res.status(500).send("License generation failed");
      }
    } else {
      console.log(`[NowPayments] IPN received — status: ${req.body.payment_status} (no action)`);
    }

    res.status(200).send("OK");
  });

  // === BOT ENGINE ===
  app.post("/api/rules/:id/test", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const result = await sendTestMessage(id);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.get("/api/gateway/status", async (_req, res) => {
    res.json(getGatewayStatus());
  });

  app.post("/api/gateway/refresh", async (_req, res) => {
    refreshSessions();
    res.json({ ok: true });
  });

  // Dev-mode fleet toggle (no effect in production — always active there)
  app.get("/api/dev-mode", (_req, res) => {
    res.json({
      enabled: getDevFleetEnabled(),
      production: process.env.NODE_ENV === "production",
    });
  });

  app.post("/api/dev-mode", (req, res) => {
    try {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
      const next = setDevFleetEnabled(enabled);
      logToConsole(`DEV MODE: fleet ${next ? "ENABLED" : "DISABLED"} via dashboard`);
      res.json({ enabled: next, production: process.env.NODE_ENV === "production" });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: err.issues[0]?.message });
      res.status(500).json({ error: err.message });
    }
  });

  // ── Admin: Server Roster — cross-workspace server presence queue (admin only) ─
  app.get("/api/admin/server-roster", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { guildId, accountId } = req.query as { guildId?: string; accountId?: string };
      if (guildId) {
        await recomputeRotation(guildId);
        const refreshedQueue = await storage.getServerQueue(guildId);
        const health = await getRosterHealthSnapshot(refreshedQueue);
        return res.json(refreshedQueue.map((entry: any) => ({
          ...entry,
          health: health.get(`${entry.guildId}:${entry.accountId}`),
        })));
      }
      if (accountId) {
        const entries = await storage.getRosterByAccount(accountId);
        return res.json(entries);
      }
       const db = await (await import("./db")).getDb();

       // Build a map of guildId → { name, ruleCount } from ALL active rules across all
      // workspaces — includes both single-account rules (rule.selectedServers) and
      // fleet-wide "all" rules (per-account servers live in rule.profileConfigs)
      const activeRules = await db.collection("rules")
        .find({ isActive: true }, { projection: { selectedServers: 1, profileId: 1, profileConfigs: 1 } })
        .toArray();

      const ruleServerMap = new Map<string, { name: string; ruleCount: number }>();
      const addServer = (id: unknown, name: unknown) => {
        if (typeof id !== "string") return;
        const prev = ruleServerMap.get(id);
        ruleServerMap.set(id, { name: (name as string) || prev?.name || id, ruleCount: (prev?.ruleCount ?? 0) + 1 });
      };
      for (const rule of activeRules) {
        if (rule.profileId === "all" && rule.profileConfigs) {
          for (const cfg of Object.values(rule.profileConfigs) as any[]) {
            if (!Array.isArray(cfg?.selectedServers)) continue;
            for (const s of cfg.selectedServers) {
              addServer(s && typeof s === "object" ? s.id : s, s && typeof s === "object" ? s.name : s);
            }
          }
        } else if (Array.isArray(rule.selectedServers)) {
          for (const s of rule.selectedServers) {
            addServer(s && typeof s === "object" ? s.id : s, s && typeof s === "object" ? s.name : s);
          }
        }
      }

       // Recompute each visible guild before returning it so an old active row
       // cannot remain displayed as primary while a healthy queued account waits.
      const guildIds = [...ruleServerMap.keys()];
       await Promise.all(guildIds.map((id) => recomputeRotation(id)));
      const rosterDocs = guildIds.length > 0
        ? await db.collection("server_roster").find({ guildId: { $in: guildIds } }).sort({ joinedAt: 1 }).toArray()
        : [];

      // Group roster docs by guildId
      const byGuild = new Map<string, any[]>();
      for (const doc of rosterDocs) {
        const arr = byGuild.get(doc.guildId) ?? [];
        arr.push(doc);
        byGuild.set(doc.guildId, arr);
      }

      // Build response — every rule-active server is listed, even with 0 accounts
       const response = guildIds.map(guildId => {
        const meta    = ruleServerMap.get(guildId)!;
         const rawEntries = (byGuild.get(guildId) ?? []).map(({ _id, ...rest }) => rest);
         const healthMapPromise = getRosterHealthSnapshot(rawEntries);
         const active = rawEntries.filter((entry: any) => entry.status === "active").length;
        return {
          guildId,
           guildName: rawEntries[0]?.guildName || meta.name,
           total: rawEntries.length,
          active,
          ruleCount: meta.ruleCount,
           entries: rawEntries,
           healthMapPromise,
        };
      });

       const hydratedResponse = await Promise.all(response.map(async (server) => {
         const health = await server.healthMapPromise;
         return {
           guildId: server.guildId,
           guildName: server.guildName,
           total: server.total,
           active: server.active,
           ruleCount: server.ruleCount,
           entries: server.entries.map((entry: any) => ({
             ...entry,
             health: health.get(`${entry.guildId}:${entry.accountId}`),
           })),
         };
       }));

      // Sort: covered first (has active accounts), then by guild name
       hydratedResponse.sort((a, b) => {
        if (b.active !== a.active) return b.active - a.active;
        return a.guildName.localeCompare(b.guildName);
      });

       res.json(hydratedResponse);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/admin/server-roster/:guildId/primary", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const { accountId } = z.object({ accountId: z.string().min(1) }).parse(req.body);
      await setPrimaryAccount(req.params.guildId, accountId);
      logToConsole(`ROSTER: admin selected ${accountId} as preferred primary for ${req.params.guildId}`);
      res.json({ ok: true });
    } catch (e: any) {
      if (e instanceof z.ZodError) return res.status(400).json({ error: e.issues[0]?.message });
      res.status(400).json({ error: e.message });
    }
  });

  app.delete("/api/admin/server-roster/:guildId/primary", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await clearPrimaryAccount(req.params.guildId);
      logToConsole(`ROSTER: cleared admin primary override for ${req.params.guildId}`);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Force a full roster re-sync + rotation recompute across all guilds.
  // Useful when accounts are stuck as "queued" after a fresh deployment.
  app.post("/api/admin/roster-sync", async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      await syncRosterFromRules();
      logToConsole("ROSTER: manual sync triggered via admin endpoint");
      res.json({ ok: true, message: "Roster sync complete — rotations recomputed." });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Init bot engine with broadcast + console functions
  initBotEngine(broadcast, logToConsole);
  logToConsole("GHOST FLEET PRO — System online. All modules ready.");
  return httpServer;
}
