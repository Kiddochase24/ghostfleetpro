import WebSocket from "ws";
import OpenAI from "openai";
import { storage } from "./storage";
import { getDb } from "./db";
import {
  getWsAgent,
  invalidateProxySession,
  proxyFetch,
  recordProxyFailure,
  recordProxySuccess,
  releaseProxy,
  replaceProxySession,
} from "./proxy";

// OpenAI client — lazy singleton so that adding OPENAI_API_KEY after startup
// is picked up on the next classify call without a server restart.
let openai: InstanceType<typeof OpenAI> | null = null;
let _openaiKey: string | undefined;

function getOpenAIClient(): InstanceType<typeof OpenAI> | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  if (openai && apiKey === _openaiKey) return openai;
  try {
    openai = new OpenAI({ apiKey });
    _openaiKey = apiKey;
    return openai;
  } catch (_) {
    openai = null;
    return null;
  }
}

const DISCORD_GATEWAY = "wss://gateway.discord.gg/?v=10&encoding=json";
const DISCORD_API = "https://discord.com/api/v10";
const TELEGRAM_API = "https://api.telegram.org";

// ─── Per-account client fingerprint ──────────────────────────────────────────
// Each account gets a deterministic but unique browser identity derived from its
// accountId so Discord sees a diverse fleet, not a clone array.
interface ClientFingerprint {
  userAgent: string;
  chromeVersion: string;
  chromeMajor: string;
  osVersion: string;
  locale: string;
  timezone: string;
  buildNumber: number;
  capabilities: number;
  deviceId: string;         // stable pseudo-UUID per account
  screenWidth: number;      // e.g. 1920, 2560, 1366
  screenHeight: number;     // e.g. 1080, 1440, 768
  hardwareConcurrency: number; // logical CPU cores: 2, 4, 8, 12, 16
  deviceMemory: number;     // GB: 2, 4, 8, 16
}

// Real Chrome stable releases Oct 2024 – Jul 2025.
// Using actual minor/patch version strings (not "X.0.0.0") because Discord's
// Cloudflare layer cross-checks UA strings against Chrome release changelogs.
// A UA of "Chrome/133.0.0.0" is never sent by real Chrome — it always has a
// full build like "133.0.6943.141". Mismatched or template-looking UAs flag the session.
const CHROME_POOL = [
  "130.0.6723.91",   // Oct 2024
  "131.0.6778.264",  // Nov 2024
  "132.0.6834.159",  // Jan 2025
  "133.0.6943.141",  // Feb 2025
  "134.0.6998.178",  // Mar 2025
  "135.0.7049.114",  // Apr 2025
  "136.0.7103.114",  // May 2025
  "137.0.7151.55",   // Jun 2025
];
// Weighted: Windows 10 majority, Windows 11 minority — matches real telemetry
const OS_POOL   = ["10.0.0", "10.0.0", "10.0.0", "10.0.0", "11.0.0", "11.0.0"];
const LOCALE_POOL = ["en-US", "en-US", "en-US", "en-US", "en-GB", "en-CA", "en-AU"];
// Timezones weighted toward US/EU where most Discord users are
const TIMEZONE_POOL = [
  "America/New_York", "America/New_York", "America/Chicago",
  "America/Los_Angeles", "America/Denver",
  "Europe/London", "Europe/Paris", "Europe/Berlin",
  "Asia/Singapore", "Asia/Tokyo", "Australia/Sydney",
];
// Discord desktop build numbers: Oct 2024 – Jul 2025 release cadence
const BUILD_POOL = [354780, 362019, 369371, 378453, 385467, 392021, 397104, 403028];
// Client capabilities bitfield — 30717 is stable for mid-2025 web client
const CAPABILITIES_POOL = [30717, 30717, 30717, 30717, 16381];

// Real-world screen resolutions weighted by global market share (StatCounter 2025)
const SCREEN_POOL: [number, number][] = [
  [1920, 1080], [1920, 1080], [1920, 1080], // most common desktop
  [2560, 1440], [2560, 1440],               // 1440p gaming/work
  [1366, 768],  [1366, 768],               // budget laptops
  [1536, 864],                              // Surface-style
  [1440, 900],                              // older MacBook-size
  [2560, 1600],                             // MacBook Pro 14" scaling
  [3840, 2160],                             // 4K
  [1280, 720],                              // older / low-end
];

// CPU core counts weighted toward common consumer hardware
const CPU_POOL  = [4, 4, 4, 8, 8, 8, 8, 12, 16, 16, 2];
// Device memory (GB) — navigator.deviceMemory rounds to 0.25/0.5/1/2/4/8 GB
const MEM_POOL  = [4, 4, 8, 8, 8, 16, 16, 2];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// Derive a stable pseudo-UUID from accountId — consistent across restarts
function deriveDeviceId(accountId: string): string {
  const h1 = hashStr(accountId + "device");
  const h2 = hashStr(accountId + "uuid2");
  const h3 = hashStr(accountId + "uuid3");
  const h4 = hashStr(accountId + "uuid4");
  const toHex = (n: number, len: number) => (n >>> 0).toString(16).padStart(len, "0");
  return `${toHex(h1, 8)}-${toHex(h2 & 0xffff, 4)}-4${toHex((h2 >>> 16) & 0xfff, 3)}-${toHex(0x8000 | (h3 & 0x3fff), 4)}-${toHex(h3 >>> 16, 4)}${toHex(h4, 8)}`;
}

function getFingerprint(accountId: string): ClientFingerprint {
  const h = hashStr(accountId);
  const chrome   = CHROME_POOL[h % CHROME_POOL.length];
  const os       = OS_POOL[(h >>> 3) % OS_POOL.length];
  const locale   = LOCALE_POOL[(h >>> 6) % LOCALE_POOL.length];
  const build    = BUILD_POOL[(h >>> 9) % BUILD_POOL.length];
  const tz       = TIMEZONE_POOL[(h >>> 12) % TIMEZONE_POOL.length];
  const caps     = CAPABILITIES_POOL[(h >>> 15) % CAPABILITIES_POOL.length];
  const screen   = SCREEN_POOL[(h >>> 18) % SCREEN_POOL.length];
  const cpuCores = CPU_POOL[(h >>> 21) % CPU_POOL.length];
  const memGb    = MEM_POOL[(h >>> 24) % MEM_POOL.length];
  const major    = chrome.split(".")[0];
  const ua = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
  return {
    userAgent: ua,
    chromeVersion: chrome,
    chromeMajor: major,
    osVersion: os,
    locale,
    timezone: tz,
    buildNumber: build,
    capabilities: caps,
    deviceId: deriveDeviceId(accountId),
    screenWidth: screen[0],
    screenHeight: screen[1],
    hardwareConcurrency: cpuCores,
    deviceMemory: memGb,
  };
}

// Encode Discord's X-Super-Properties header — sent on every REST call.
// This is a base64 JSON of client identity properties. Discord cross-checks
// it against the gateway IDENTIFY payload; a mismatch flags the session.
function buildSuperProperties(fp: ClientFingerprint): string {
  const props = {
    os: "Windows",
    browser: "Chrome",
    device: "",
    system_locale: fp.locale,
    has_client_mods: false,
    browser_user_agent: fp.userAgent,
    browser_version: fp.chromeVersion,
    os_version: fp.osVersion,
    referrer: "",
    referring_domain: "",
    referrer_current: "",
    referring_domain_current: "",
    release_channel: "stable",
    client_build_number: fp.buildNumber,
    client_event_source: null,
    // Hardware signals — Discord uses these to classify the "device profile".
    // Two accounts on the same IP with different screen/CPU/memory look like
    // two different people's computers on the same home network.
    native_build_number: null,
    design_id: 0,
  };
  return Buffer.from(JSON.stringify(props)).toString("base64");
}

// Build the per-account presence state as reported in the IDENTIFY payload.
// Also used when logging into the science telemetry endpoint.
function getHardwareContext(fp: ClientFingerprint) {
  return {
    screen_dimensions: `${fp.screenWidth}x${fp.screenHeight}`,
    hardware_concurrency: fp.hardwareConcurrency,
    device_memory: fp.deviceMemory,
  };
}

// Full Chrome-authentic header set.
// Every header Chrome actually sends on fetch() calls from discord.com.
// Missing headers (especially sec-ch-ua / X-Super-Properties) are primary
// detection signals Discord's Cloudflare layer uses to classify requests.
function makeHeaders(fp: ClientFingerprint): Record<string, string> {
  return {
    "User-Agent": fp.userAgent,
    "Accept": "*/*",
    "Accept-Language": `${fp.locale},en;q=0.9`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    // Client Hints — Chrome 90+ always sends these; their absence = bot signal
    "sec-ch-ua": `"Google Chrome";v="${fp.chromeMajor}", "Chromium";v="${fp.chromeMajor}", "Not/A)Brand";v="8"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-ch-ua-platform-version": `"${fp.osVersion}"`,
    // Fetch metadata — Chrome sends on every cross-origin fetch
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    // Discord-specific authenticity headers
    "X-Discord-Locale": fp.locale,
    "X-Discord-Timezone": fp.timezone,
    "X-Super-Properties": buildSuperProperties(fp),
    "Origin": "https://discord.com",
    "Referer": "https://discord.com/channels/@me",
  };
}

// Fallback headers for API calls without a specific account context
const HEADERS = makeHeaders(getFingerprint("default-context"));

// Generate a Discord-compatible snowflake nonce (same algorithm the web client uses)
function discordNonce(): string {
  const DISCORD_EPOCH = 1420070400000n;
  return ((BigInt(Date.now()) - DISCORD_EPOCH) << 22n).toString();
}

interface GatewaySession {
  accountId: string;
  accountName: string;
  token: string;
  ws: WebSocket;
  heartbeatTimer: NodeJS.Timeout | null;
  initialHeartbeatTimer: NodeJS.Timeout | null;
  heartbeatAcked: boolean;
  sessionId: string | null;
  resumeUrl: string | null;
  seq: number | null;
  reconnectTimer: NodeJS.Timeout | null;
  identifyTimer: NodeJS.Timeout | null;
  // Guards against hung TCP handshakes that never receive a HELLO (op 10).
  // Cleared as soon as HELLO arrives; terminates the socket if it never does.
  helloTimer: NodeJS.Timeout | null;
  // False when the session is being closed because the account was disabled or
  // removed. A deliberate close must never enter the reconnect path.
  shouldReconnect: boolean;
  isReady: boolean;
  guildIds: string[];
  discordUserId: string | null;
  guildNames: Map<string, string>; // guildId → guild name
  channelNames: Map<string, string>; // channelId → channel name
  // Admin guard: tracks which userIds have the watched role per guild
  // Key: `${guildId}:${roleId}` → Set of userIds with that role
  adminRoleMembers: Map<string, Set<string>>;
  // Admin guard: tracks which admin-role members are currently online per guild
  // Key: `${guildId}:${roleId}` → Set of userIds currently online/idle/dnd
  adminOnlineMembers: Map<string, Set<string>>;
  // Member role cache: userId → Set of roleIds (populated from GUILD_MEMBER_UPDATE)
  memberRoles: Map<string, Set<string>>;
  // Rate-limited send queue (heartbeats bypass this)
  sendQueue: string[];
  sendProcessing: boolean;
  // Stable per-account browser fingerprint — varies between accounts
  fingerprint: ClientFingerprint;
}

// ─── 24-hour purge — clears old history and orphaned roster entries ──────────
async function runStoragePurge() {
  try {
    const histDeleted = await storage.deleteOldHistory(24 * 60 * 60 * 1000);
    logFn(`PURGE: removed ${histDeleted} old history entries`);
  } catch (e: any) {
    logFn(`PURGE ERR: ${e.message}`);
  }
}
setInterval(runStoragePurge, 24 * 60 * 60 * 1000);
// Run once shortly after boot too — a process that restarts more often than
// every 24h (pm2 crash loops) would otherwise never purge and Mongo fills up.
setTimeout(runStoragePurge, 60_000);

// ─── First-message tracker — logs the first post by users who just joined ─────
// key: `${accountId}:${guildId}:${userId}`, value: { guildName, joinedAt }
const newJoiners = new Map<
  string,
  { guildName: string; username: string; joinedAt: number }
>();
const NEW_JOINER_TTL = 3 * 60 * 60 * 1000; // 3 hours

// Cleanup old joiner entries every 10 minutes
setInterval(
  () => {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, val] of newJoiners.entries()) {
      if (now - val.joinedAt > NEW_JOINER_TTL) {
        newJoiners.delete(key);
        cleaned++;
      }
    }
    if (cleaned > 0) logFn(`MEMORY: Cleaned ${cleaned} old joiner entries`);

    // Also log session memory usage for monitoring
    let totalMemory = 0;
    for (const s of sessions.values()) {
      totalMemory +=
        s.guildNames.size +
        s.channelNames.size +
        s.memberRoles.size +
        s.adminRoleMembers.size +
        s.adminOnlineMembers.size;
    }
    logFn(
      `MEMORY: Sessions using ${totalMemory} cache entries (${sessions.size} accounts)`,
    );
  },
  10 * 60 * 1000,
);

// ─── Rule cache — singleton promise prevents concurrent DB fetches ────────────
let rulesCacheData: any[] = [];
let rulesCacheTs = 0;
let rulesCachePending: Promise<any[]> | null = null;
const RULES_CACHE_TTL = 6000; // 6 seconds

async function getCachedRules(): Promise<any[]> {
  if (!isFleetActive()) return [];
  const now = Date.now();
  if (now - rulesCacheTs < RULES_CACHE_TTL) return rulesCacheData;
  if (rulesCachePending) return rulesCachePending;
  rulesCachePending = storage
    .getRules()
    .then((data) => {
      rulesCacheData = data;
      rulesCacheTs = Date.now();
      rulesCachePending = null;
      // Rebuild tracked-guilds cache whenever rules refresh
      rebuildTrackedGuilds(data);
      // Re-seed admin guard subscriptions for all active sessions
      refreshAdminGuardSubscriptions().catch(() => {});
      return data;
    })
    .catch((e) => {
      rulesCachePending = null;
      throw e;
    });
  return rulesCachePending;
}

export function invalidateRulesCache() {
  rulesCacheTs = 0;
  rulesCachePending = null;
}

// ─── Tracked guilds cache — rebuilt from rules, avoids per-event DB hits ─────
// Set of guild IDs across all active rules' selectedServers / profileConfigs
let trackedGuildIds = new Set<string>();

function rebuildTrackedGuilds(rules: any[]) {
  const ids = new Set<string>();
  for (const rule of rules) {
    if (!rule.isActive) continue;
    const servers =
      rule.profileId === "all" && rule.profileConfigs
        ? Object.values(rule.profileConfigs as any).flatMap(
            (cfg: any) => cfg.selectedServers || [],
          )
        : rule.selectedServers || [];
    for (const srv of servers) if (srv.id) ids.add(srv.id);
  }
  trackedGuildIds = ids;
}

// ─── resolveChannelName in-flight dedup — prevents racing REST calls ─────────
const channelResolvePending = new Map<string, Promise<string>>();

// ─── Local keyword classifier — used when AI is unavailable ──────────────────
function localClassifyMessage(
  messageContent: string,
  keywords: string[],
): { confidence: number; generalIssueConfidence: number; reasoning: string; isCrypto: boolean } {
  const text = messageContent.toLowerCase();

  // Hard-block noise patterns — hype, greetings, reactions
  const noisePatterns = [
    /\blfg\b/, /\bwagmi\b/, /\bngmi\b/, /\bto the moon\b/, /\bmoon\b/,
    /\bgm\b/, /\bgn\b/, /\bgood morning\b/, /\bgood night\b/, /\bhey guys\b/,
    /\bbased\b/, /\btrue\b/, /\bexactly\b/, /\bsame\b/, /\blmao\b/, /\blol\b/,
    /\bgg\b/, /\bwow\b/, /\bhype\b/, /\bbullish\b/, /\bbearish\b/,
    /\bjust dropped\b/, /\bnew listing\b/, /\bpartnership\b/, /\bannounced\b/,
    /\bto the moon\b/, /\b100x\b/, /\bpump\b/, /\bdump\b/, /\bhodl\b/,
    /\bsoon\b.*\$/, /^\s*[🚀🔥💎🙌👀❤️😂🤣]+\s*$/,
  ];
  const isNoise = noisePatterns.some((p) => p.test(text));
  if (isNoise) {
    return { confidence: 0, generalIssueConfidence: 0, reasoning: "Local: noise/hype pattern detected", isCrypto: false };
  }

  // Block people who are OFFERING help — they are helpers, not users in need.
  // Must run before issue patterns so a helper asking "what's your issue?" isn't caught.
  const offeringHelpPatterns = [
    /\bi can help\b/, /\bi('ll| will) help\b/, /\bi('m| am) here to help\b/,
    /\bhappy to (help|assist)\b/, /\bfeel free to (ask|dm|message) me\b/,
    /\blet me (help|know|walk you|guide)\b/, /\bi('ll| will) (assist|walk you|guide)\b/,
    /\bdm me (if|for)\b/, /\breach out to me\b/, /\bi work in support\b/,
    /\bi('ve| have) (done|been through|dealt with) (this|it|that)\b/,
    /\banyone (who )?needs? (help|assistance|support)\b/,
    /\bi('ll| will) (take care|handle|sort)\b/,
  ];
  const isOfferingHelp = offeringHelpPatterns.some((p) => p.test(text));
  if (isOfferingHelp) {
    return { confidence: 0, generalIssueConfidence: 0, reasoning: "Local: user is offering help, not seeking it", isCrypto: false };
  }

  // Genuine issue signals — questions, errors, help requests, confusion
  const issuePatterns = [
    /\?/, /\bwhy\b/, /\bhow\b/, /\bcan'?t\b/, /\bwon'?t\b/, /\bdoesn'?t\b/,
    /\bdon'?t\b/, /\bnot working\b/, /\bbroken\b/, /\bbug\b/, /\berror\b/,
    /\bissue\b/, /\bproblem\b/, /\bhelp\b/, /\bassist\b/, /\bfailed\b/,
    /\bfailing\b/, /\bstuck\b/, /\bconfused\b/, /\bwhere\b/, /\bwhen\b/,
    /\bwhat\b/, /\bunable\b/, /\bcannot\b/, /\brefund\b/, /\bmissing\b/,
    /\blost\b/, /\bstolen\b/, /\bfrozen\b/, /\blocked\b/, /\bsupport\b/,
    /\bplease\b/, /\btransaction\b/, /\bwallet\b/, /\bwithdraw\b/, /\bdeposit\b/,
    // Confusion / directionless / uncertainty signals
    /\bnot sure\b/, /\bno idea\b/, /\bdon'?t know\b/, /\bhave no idea\b/,
    /\bnew here\b/, /\bjust joined\b/, /\bwhat do i\b/, /\bwhat should i\b/,
    /\bwhere do i\b/, /\bhow do i\b/, /\bwhere can i\b/, /\bwhat now\b/,
    /\bi'?m lost\b/, /\ba bit confused\b/, /\bstruggling\b/, /\bhaving trouble\b/,
    /\bcan'?t figure\b/, /\bnot really sure\b/, /\bunfamiliar\b/,
  ];
  const issueScore = issuePatterns.filter((p) => p.test(text)).length;
  const generalIssueConfidence = Math.min(100, issueScore * 15);

  // Keyword match score
  const lowerKeywords = keywords.map((k) => k.toLowerCase());
  const matchedKeywords = lowerKeywords.filter((kw) => text.includes(kw));
  const keywordScore = matchedKeywords.length / Math.max(1, lowerKeywords.length);

  // Confidence = issue signal strength when ANY keyword matched.
  // Do NOT divide by total keyword count — rules with long keyword lists were
  // getting near-zero confidence even for genuine issues that matched a keyword.
  const confidence =
    issueScore > 0 && matchedKeywords.length > 0
      ? Math.min(100, issueScore * 25)
      : 0;

  // Crypto detection
  const cryptoWords = ["crypto", "token", "coin", "wallet", "blockchain", "defi", "nft", "eth", "btc", "sol", "usdt", "usdc", "swap", "dex", "contract", "transaction", "tx"];
  const isCrypto = cryptoWords.some((w) => text.includes(w));

  const reasoning = issueScore > 0
    ? `Local: ${issueScore} issue signal(s) detected, ${matchedKeywords.length}/${lowerKeywords.length} keywords matched`
    : "Local: no genuine issue signals found";

  return { confidence, generalIssueConfidence, reasoning, isCrypto };
}

// ─── AI message classifier — checks if message is a genuine issue ────────────
async function aiClassifyMessage(
  messageContent: string,
  keywords: string[],
): Promise<{
  confidence: number;
  generalIssueConfidence: number;
  reasoning: string;
  isCrypto: boolean;
}> {
  // Try AI first — fall back to local classifier if unavailable.
  // getOpenAIClient() is evaluated lazily so a key added after startup is picked up.
  const client = getOpenAIClient();
  if (client) {
    try {
      const response = await client.chat.completions.create({
        model: "gpt-4.1-mini",
        messages: [
          {
            role: "system",
            content: `You are a community support triage system. Your job is to detect any message where a user needs human support attention — whether they are explicitly reporting a problem, asking a question, sounding confused, or simply seeming like they don't know where to start or what to do.

Return ONLY a JSON object with:
- confidence: integer 0-100 (keyword topic relevance — only for real questions/problems about that topic)
- generalIssueConfidence: integer 0-100 (does this person need support attention, for any reason?)
- isCrypto: boolean (is this a real crypto-related question or problem)
- reasoning: string (brief 1-sentence explanation)

ALWAYS score 0 on BOTH metrics for:
- Hype, excitement, or bullish statements ("LFG", "to the moon", "this is huge", "wagmi")
- Announcements, news, or project updates ("just dropped", "new listing", "partnership announced")
- Memes, GIFs, emojis-only, or joke messages
- Casual greetings or small talk with no underlying need ("gm", "good morning", "hey guys", "what's up")
- Price speculation without a question ("$X soon", "100x incoming")
- Congratulations or cheerleading messages
- Simple agreement or reactions ("based", "true", "exactly", "same")
- Bot commands or macros (e.g. !faucet, !work, !help)
- Spam or promotional content ("i'll help 10k people earn $50k today")
- ANYONE OFFERING TO HELP OR VOLUNTEERING ASSISTANCE — this is critical. Score 0 even if they ask a question, because their question is asked in order to help someone else, not because they need help themselves. Examples:
  • "I can help anyone who needs X" / "DM me if you need assistance" / "let me know if you need help"
  • "anyone need help with X? I've done it before" / "happy to assist"
  • "what do you need help with?" (asked by someone offering their support)
  • "I'll walk you through it" / "I can guide you" / "reach out to me"
  • "I work in support, feel free to ask me"
  • Questions asked with helper intent: "what's the issue?" / "can you explain what happened?" asked by someone who is trying to assist, not by someone who is lost

Score HIGH (generalIssueConfidence 60-100) for ANY of the following — you do not need an explicit problem report:

1. EXPLICIT ISSUES — errors, bugs, crashes, failed transactions, things not working, account/access problems, complaints about funds.

2. QUESTIONS & UNCERTAINTY — the user is asking something, even if it sounds simple or casual. If they don't know something and are reaching out to find out, that's a support signal.
   • "how do i…" / "where do i…" / "what is…" / "which one should i…"
   • "is there a way to…" / "can i…" / "do i need to…"
   • "when will…" / "why does…" / "what happens if…"

3. LOST OR DIRECTIONLESS — the user seems unsure what to do, where to go, or how to proceed. They may not even form a proper question.
   • "i don't know where to start" / "not sure what to do" / "a bit confused"
   • "just joined, what now?" / "new here" / "i'm lost"
   • Messages that trail off or feel uncertain even without a clear ask

4. SEEKING HELP OR GUIDANCE — any signal that someone wants a hand, even if politely or indirectly.
   • "could someone help me?" / "anyone around?" / "any chance someone can explain?"
   • "struggling with" / "having trouble" / "can't figure out"
   • Passive requests: "would be great if someone could…" / "hoping to get some help"

5. CASUAL PROBLEM EXPRESSIONS — people rarely describe issues formally. Read between the lines.
   • "it just keeps loading" / "won't load" / "stuck" / "nothing is happening"
   • "can't see it" / "not showing up" / "it disappeared"
   • "tried everything" / "still not working" / "been waiting forever"
   • "is it down?" / "anyone else having this?" / "it's broken for me"
   • Frustration, repeated attempts, or resignation implied by phrasing

Use good judgment. Read the whole message holistically — ask yourself: "does this person need someone to talk to them?" If yes, score high. Do not require technical language or a clear statement of a problem. A user saying "not really sure what i'm doing here" deserves the same attention as one saying "i found a bug". Do not penalise vagueness or informality.`,
          },
          {
            role: "user",
            content: `Keywords to match: ${keywords.join(", ")}

Discord message to analyze:
"${messageContent.substring(0, 500)}"

Return JSON only.`,
          },
        ],
        response_format: { type: "json_object" },
        max_completion_tokens: 1000,
      }, {
        // Hard cap — a hung OpenAI request must never stall the per-channel
        // send queue (which serialises every reply for that channel).
        timeout: 15_000,
        maxRetries: 0,
      });

      const raw = response.choices[0]?.message?.content;
      if (!raw || !raw.trim()) {
        throw new Error("AI returned empty response");
      }
      const result = JSON.parse(raw);
      return {
        confidence: Math.max(0, Math.min(100, Math.round(Number(result.confidence) || 0))),
        generalIssueConfidence: Math.max(0, Math.min(100, Math.round(Number(result.generalIssueConfidence) || 0))),
        isCrypto: result.isCrypto !== false,
        reasoning: String(result.reasoning || "No reasoning provided").substring(0, 200),
      };
    } catch (e: any) {
      // Always log the real error so pm2 logs show exactly why AI failed.
      // Previously 404s were swallowed silently — that hid key/model mismatches on the VPS.
      logFn(`AI CLASSIFY ERR: ${e.message ?? String(e)} — falling back to local classifier`);
    }
  }

  // Local classifier fallback
  const local = localClassifyMessage(messageContent, keywords);
  logFn(`AI CLASSIFY [local]: crypto=${local.confidence}% general=${local.generalIssueConfidence}% — ${local.reasoning}`);
  return local;
}


// ─── Per-channel send queue — serialises messages with a safety gap ──────────
// Prevents rate-limit hits when many rules fire on the same channel at once.
const channelQueues = new Map<string, Promise<void>>();
const CHANNEL_SEND_GAP_MS = 1300; // ~4.6 msg/5s — safely under Discord's 5/5s limit

// ─── 403 channel reporting ───────────────────────────────────────────────────
// Keep failure counts for diagnostics, but never use them to gate a reply.
const channelBlacklist = new Map<string, { failures: number; until: number }>();
const BLACKLIST_THRESHOLD = 3;       // 403s before we give up on a channel
const BLACKLIST_DURATION_MS = 60 * 60 * 1000; // 1 hour cooldown

function record403(accountId: string, channelId: string, accountName: string, channelName: string, guildName: string) {
  const key = `${accountId}:${channelId}`;
  const entry = channelBlacklist.get(key) ?? { failures: 0, until: 0 };
  entry.failures += 1;
  if (entry.failures >= BLACKLIST_THRESHOLD) {
    entry.until = Date.now() + BLACKLIST_DURATION_MS;
    logFn(`⚠ 403 REPORT [${accountName}] in #${channelName} (${guildName}) — ${entry.failures} failures recorded; replies remain ungated`);
  }
  channelBlacklist.set(key, entry);
}

// ─── Telegram failure rate-limiter — max 1 alert per (rule+channel) per hour ──
// Stops flooding Telegram when a broken channel gets many matching messages.
const tgFailureSent = new Map<string, number>();
const TG_FAILURE_COOLDOWN_MS = 60 * 60 * 1000;

function shouldSendTgFailure(ruleId: string, channelId: string): boolean {
  const key = `${ruleId}:${channelId}`;
  const last = tgFailureSent.get(key) ?? 0;
  if (Date.now() - last < TG_FAILURE_COOLDOWN_MS) return false;
  tgFailureSent.set(key, Date.now());
  return true;
}

// ─── Per-message dedup — guarantees ONE fire per (msgId,ruleId) GLOBALLY ─────
// Two layers:
//   1. In-memory Map (fast path, single-process)
//   2. Mongo `processed_messages` with unique _id (cross-process — protects
//      against duplicates when multiple deployments / instances are running
//      with the same Discord tokens. The TTL index in db.ts auto-cleans
//      entries after 10 minutes.)
// Returns true if this (msgId,ruleId) was ALREADY claimed by anyone.
const firedMessages = new Map<string, number>();
const FIRED_TTL_MS = 10 * 60 * 1000;
async function alreadyFired(msgId: string, ruleId: string): Promise<boolean> {
  const key = `${msgId}:${ruleId}`;
  const now = Date.now();
  if (firedMessages.size > 5000) {
    for (const [k, t] of firedMessages) {
      if (now - t > FIRED_TTL_MS) firedMessages.delete(k);
    }
  }
  if (firedMessages.has(key)) return true;
  firedMessages.set(key, now);
  // Cross-process claim — insert with key as _id. Duplicate key = someone
  // else already claimed it (another instance/deployment). Fail-open on
  // any other DB error so we don't block legit messages.
  try {
    const db = await getDb();
    await db.collection("processed_messages").insertOne({
      _id: key as any,
      ts: new Date(),
    });
    return false; // we claimed it
  } catch (e: any) {
    if (e?.code === 11000) return true; // already claimed by another process
    return false; // other errors — proceed (fail-open)
  }
}

function enqueueChannelSend(
  channelId: string,
  delayMs: number,
  fn: () => Promise<void>,
) {
  const existing = channelQueues.get(channelId) ?? Promise.resolve();
  const next = existing
    .then(async () => {
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      await fn();
    })
    .catch(() => {});
  channelQueues.set(channelId, next);
  // Self-clean: once this chain resolves and nothing new was queued,
  // remove the entry so the Map doesn't hold resolved promises forever.
  next.then(() => {
    if (channelQueues.get(channelId) === next) channelQueues.delete(channelId);
  });
}

function humanReplyDelayMs(rule: any): number {
  const configured = Number(rule.delayMs) || 0;
  // Even "Instant" gets a short, randomized pause. Very small configured
  // values are raised to a practical floor so replies do not arrive at
  // machine cadence, while longer custom delays retain their intent.
  const base = Math.max(500, configured);
  const jitter = base * (0.2 + Math.random() * 0.35);
  return Math.max(350, Math.round(base - base * 0.2 + jitter));
}

// Per-session gateway status (separate from DB account status)
export const gatewayStatus: Map<string, "connecting" | "ready" | "dead"> =
  new Map();

const sessions = new Map<string, GatewaySession>();
// RESUME data saved when a session closes so next openSession can RESUME instead of re-IDENTIFY
const pendingResumes = new Map<
  string,
  { sessionId: string; resumeUrl: string; seq: number | null }
>();
// Exponential backoff retry counter per account
const retryCount = new Map<string, number>();
// Names are retained while a socket is reconnecting so the dashboard can show
// the account instead of making it disappear when sessions.delete() runs.
const gatewayAccountNames = new Map<string, string>();
// Track accounts that have a pending reconnect timer so the watchdog
// doesn't race and open a second session.
const pendingReconnects = new Set<string>();

// Discord's gateway should not receive a fleet-wide connection burst. Keep the
// queue shared by initial opens, watchdog recovery, and scheduled reconnects so
// no caller can bypass the connection limit.
// Discord can close an entire fleet when too many sessions identify during
// the same gateway window. Open one socket at a time and leave a full window
// between opens so recovery does not immediately create another 1006 storm.
const GATEWAY_OPEN_BATCH_SIZE = 1;
const GATEWAY_OPEN_BATCH_DELAY_MIN_MS = 5000;
const GATEWAY_OPEN_BATCH_DELAY_MAX_MS = 7000;
const RECONNECT_BACKOFF_MS = [7000, 15000, 30000, 60000, 90000];
const RECONNECT_JITTER_MS = 3000;
const TCP_KEEPALIVE_DELAY_MS = 30000;
const gatewayOpenQueue = new Map<
  string,
  { accountId: string; accountName: string; token: string }
>();
let gatewayOpenPumpTimer: NodeJS.Timeout | null = null;
let gatewayOpenPumpRunning = false;

let broadcastFn: (event: string, data: any) => void = () => {};
let logFn: (msg: string, wsId?: number) => void = () => {};

// ── Global cross-workspace rotation engine ──────────────────────────────────
// The roster's `joinedAt` timestamp is set the moment an (account, server) pair
// becomes active inside an ACTIVE rule — never Discord gateway join time. This
// keeps rotation ordering purely a function of "when was this account queued up
// via rule config", exactly as configured across the whole GhostFleet, ignoring
// which workspace the rule/account belongs to.

// ── Message gating ──────────────────────────────────────────────────────────
// The roster and gateway health are not consulted on the message hot path.
// Once a configured rule matches, keyword and AI classification are the only
// content gates before the send attempt.

// Roster rotation is disabled — kept as a no-op so existing call sites stay valid.
async function recomputeAccountRotations(_accountId: string): Promise<void> {
  return;
}

export type RosterHealth = {
  accountStatus: string;
  gatewayReady: boolean;
  inServer: boolean;
  tokenValid: boolean | null;
  tokenCheckedAt: Date | null;
  healthy: boolean;
  stale: boolean;
  reason: string;
};

const tokenHealth = new Map<string, { valid: boolean; checkedAt: number; token: string }>();
const tokenHealthInFlight = new Map<string, Promise<boolean | null>>();
const TOKEN_HEALTH_TTL_MS = 60_000;
const TOKEN_HEALTH_TIMEOUT_MS = 5_000;

async function checkAccountToken(account: any): Promise<boolean | null> {
  // Cache entries are keyed to the token value — a replaced token must never
  // inherit the old token's cached verdict (stale false blocks a fresh valid
  // token; stale true lets a revoked one through).
  let cached = tokenHealth.get(account.id);
  if (cached && cached.token !== account.token) {
    tokenHealth.delete(account.id);
    cached = undefined;
  }
  if (cached && Date.now() - cached.checkedAt < TOKEN_HEALTH_TTL_MS) return cached.valid;

  const running = tokenHealthInFlight.get(account.id);
  if (running) return running;

  const check = (async (): Promise<boolean | null> => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TOKEN_HEALTH_TIMEOUT_MS);
      try {
        const response = await proxyFetch(`${DISCORD_API}/users/@me`, {
          headers: { ...makeHeaders(getFingerprint(account.id)), Authorization: account.token },
          signal: controller.signal,
        }, account.id);
        if (response.ok) {
          tokenHealth.set(account.id, { valid: true, checkedAt: Date.now(), token: account.token });
          return true;
        }
        if (response.status === 401 || response.status === 403) {
          tokenHealth.set(account.id, { valid: false, checkedAt: Date.now(), token: account.token });
          await storage.updateAccountStatus(account.id, "Disconnected");
          releaseProxy(account.id);
          closeSession(account.id);
          return false;
        }
        return cached?.valid ?? null;
      } finally {
        clearTimeout(timeout);
      }
    } catch {
      // A transient network failure is not proof that a token is invalid.
      return cached?.valid ?? null;
    }
  })();
  tokenHealthInFlight.set(account.id, check);
  try {
    return await check;
  } finally {
    if (tokenHealthInFlight.get(account.id) === check) {
      tokenHealthInFlight.delete(account.id);
    }
  }
}

async function getRosterHealth(
  entry: any,
  accounts: Map<string, any>,
  verifyToken = true,
): Promise<RosterHealth> {
  const account = accounts.get(entry.accountId);
  const session = sessions.get(entry.accountId);
  const gatewayReady = !!session &&
    gatewayStatus.get(entry.accountId) === "ready" &&
    session.isReady;
  const inServer = !!session?.guildIds.includes(entry.guildId);
  const cachedToken = account ? tokenHealth.get(entry.accountId)?.valid ?? null : false;
  const tokenValid = account && verifyToken
    ? await checkAccountToken(account)
    : cachedToken;
  const accountStatus = account?.status ?? "Missing";
  // tokenValid === null means "couldn't verify right now" (network/timeout) — treat as
  // healthy so a transient HTTP blip doesn't permanently freeze the rotation.
  // tokenValid === false means the token was actively rejected (401) — that IS unhealthy.
  const tokenOk = tokenValid !== false;
  const healthy = accountStatus === "Connected" && tokenOk && gatewayReady && inServer;
  const reason = !account
    ? "Account missing"
    : accountStatus !== "Connected"
      ? `Account ${accountStatus.toLowerCase()}`
        : tokenValid === false
        ? "Token rejected (401)"
        : !gatewayReady
          ? "Gateway not ready"
          : !inServer
            ? "Account is not in this server"
            : "Healthy";
  const checked = tokenHealth.get(entry.accountId);
  return {
    accountStatus,
    gatewayReady,
    inServer,
    tokenValid,
    tokenCheckedAt: checked ? new Date(checked.checkedAt) : null,
    healthy,
    stale: !healthy,
    reason,
  };
}

export async function getRosterHealthSnapshot(
  entries: any[],
  options: { verifyTokens?: boolean } = {},
): Promise<Map<string, RosterHealth>> {
  const accounts = await storage.getAccounts();
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const results = await Promise.all(
    entries.map(async (entry) => [
      `${entry.guildId}:${entry.accountId}`,
      await getRosterHealth(entry, accountMap, options.verifyTokens !== false),
    ] as const),
  );
  return new Map(results);
}

// Recompute active/queued status for every roster row of a single guild: the
// preferred healthy row becomes "active", otherwise the earliest healthy row
// becomes active. Unhealthy rows can never retain ownership of a server.
//
// A persisted roster row can outlive its account session, token, or server
// membership. Keep that row visible for diagnosis, but stamp it as stale and
// force it out of the active slot so it cannot block a healthy replacement.
export async function recomputeRotation(_guildId: string): Promise<void> {
  // Rotation engine disabled: no roster ownership, no promotion/demotion work.
  return;
}

// Admin-selected promotion. The preference is persisted, but health checks still
// decide whether this account may actually own the live slot.
export async function setPrimaryAccount(guildId: string, accountId: string): Promise<void> {
  const db = await getDb();
  const target = await db.collection("server_roster").findOne({
    guildId,
    accountId,
    status: { $in: ["active", "queued"] },
  });
  if (!target) throw new Error("Account is not in the active roster for this server");
  const health = await getRosterHealthSnapshot([target]);
  if (!health.get(`${guildId}:${accountId}`)?.healthy) {
    throw new Error("Account failed the primary health checks; it remains queued");
  }

  await db.collection("server_roster").updateMany(
    { guildId, status: { $in: ["active", "queued"] } },
    { $set: { primaryRequested: false } },
  );
  await db.collection("server_roster").updateOne(
    { _id: target._id },
    { $set: { primaryRequested: true } },
  );
  await recomputeRotation(guildId);
}

// Return a server to automatic queue ordering. The next recomputation chooses
// the preferred healthy row, then the earliest healthy row.
export async function clearPrimaryAccount(guildId: string): Promise<void> {
  const db = await getDb();
  await db.collection("server_roster").updateMany(
    { guildId, status: { $in: ["active", "queued"] } },
    { $set: { primaryRequested: false } },
  );
  await recomputeRotation(guildId);
}

async function verifyRosterHealth(): Promise<void> {
  // Roster health polling disabled.
  return;
}

// Reads every ACTIVE rule across ALL workspaces, resolves the (accountId, guildId)
// pairs it makes "live" (fleet rules use profileConfigs per account; single-account
// rules use the rule's own selectedServers), and syncs the roster to match:
//   - brand-new pairs are inserted with joinedAt = now (the moment they were detected)
//   - pairs that already exist keep their original joinedAt (rotation order preserved)
//   - pairs no longer covered by any active rule are marked "left"
// This is the ONLY place new roster rows get created — Discord gateway events no
// longer create rows, they only update metadata on rows that already exist here.
export async function syncRosterFromRules(): Promise<void> {
  // Roster sync disabled — rules alone decide which accounts reply.
  return;
}

// Auto-refresh every connected account's Discord guild list on an interval so new
// joins/exits are picked up without a manual "Refresh" click in Account Access.
// Departures from a rule-active server immediately rotate the queue.
const ACCOUNT_AUTO_REFRESH_MS = 10 * 60 * 1000;
function startAccountAutoRefresh() {
  setInterval(async () => {
    try {
      const accounts = await storage.getAccounts();
      let refreshed = 0;
      for (const acc of accounts) {
        if (!acc.token) continue;
        try {
          const accFp = getFingerprint(acc.id);
          const guildsRes = await proxyFetch(`${DISCORD_API}/users/@me/guilds`, {
            headers: { ...makeHeaders(accFp), Authorization: acc.token },
          }, acc.id);
          if (!guildsRes.ok) continue;
          const guilds = (await guildsRes.json()) as any[];
          await storage.updateAccountGuilds(acc.id, guilds);
          refreshed++;
        } catch { /* skip this account, try next */ }
        await new Promise((r) => setTimeout(r, 250)); // stagger to avoid Discord rate limits
      }
      if (refreshed > 0) {
        logFn(`AUTO-REFRESH: synced guild lists for ${refreshed} account(s)`);
      }
    } catch (e: any) {
      logFn(`AUTO-REFRESH ERR: ${e.message}`);
    }
  }, ACCOUNT_AUTO_REFRESH_MS);
}

// Runtime toggle so dev mode can run fleets on demand without code edits.
// Production mode always runs fleets regardless of this flag.
// Persisted to the `config` collection under key `devFleetEnabled` so the
// chosen state survives restarts.
const DEV_FLEET_CONFIG_KEY = "devFleetEnabled";
let devFleetEnabled = true;

export function isFleetActive(): boolean {
  return process.env.NODE_ENV === "production" || devFleetEnabled;
}
export function getDevFleetEnabled(): boolean {
  return devFleetEnabled;
}
export function setDevFleetEnabled(v: boolean): boolean {
  devFleetEnabled = !!v;
  logFn(
    `BOT ENGINE: dev-mode fleet ${devFleetEnabled ? "ENABLED" : "DISABLED"} via API`,
  );
  // Persist the new value (fire-and-forget — don't block the toggle response)
  storage
    .setConfig(DEV_FLEET_CONFIG_KEY, devFleetEnabled ? "true" : "false")
    .catch((e) => logFn(`BOT ENGINE: failed to persist dev-mode flag: ${e.message}`));
  // Force an immediate sync so sessions open/close right away
  syncSessions();
  return devFleetEnabled;
}

async function loadDevFleetFromStorage(): Promise<void> {
  try {
    const cfg = await storage.getConfig();
    const stored = cfg?.[DEV_FLEET_CONFIG_KEY];
    if (stored === "true" || stored === "false") {
      devFleetEnabled = stored === "true";
      logFn(`BOT ENGINE: restored dev-mode fleet from storage → ${devFleetEnabled ? "ENABLED" : "DISABLED"}`);
    }
  } catch (e: any) {
    logFn(`BOT ENGINE: could not load dev-mode flag from storage: ${e.message}`);
  }
}

export function initBotEngine(
  broadcast: (event: string, data: any) => void,
  log: (msg: string, wsId?: number) => void,
) {
  broadcastFn = broadcast;
  logFn = log;

  // Show AI classifier status on startup so pm2 logs make it obvious whether
  // OpenAI is active or the local fallback is being used.
  {
    const directKey = process.env.OPENAI_API_KEY;
    const integrationKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
    if (directKey) {
      logFn(`AI CLASSIFIER: active — using OPENAI_API_KEY (direct)`);
    } else if (integrationKey) {
      logFn(`AI CLASSIFIER: active — using AI_INTEGRATIONS_OPENAI_API_KEY (Replit proxy)`);
    } else {
      logFn(`AI CLASSIFIER: ⚠ no API key found — all classifications will use local fallback`);
    }
  }

  // Load persisted dev-mode flag, then start the sync loop.
  // syncSessions inside the interval handles late-arriving accounts on its own,
  // so this fire-and-forget pattern is safe.
  loadDevFleetFromStorage().then(async () => {
    if (process.env.NODE_ENV === "production") {
      logFn("BOT ENGINE: production mode — fleets active.");
    } else {
      logFn(
        `BOT ENGINE: dev mode — fleets ${devFleetEnabled ? "ENABLED" : "DISABLED"} (toggle via /api/dev-mode).`,
      );
    }
    syncSessions();

    // Roster sync removed from startup — nothing blocks the first session pass.
    startAccountAutoRefresh();
  });

  // Sync sessions every 15s — opens/closes sessions to match DB
  setInterval(syncSessions, 15000);
  // Watchdog every 30s — recovers orphaned dead sessions + broadcasts health
  setInterval(gatewayWatchdog, 30000);
  // Periodic OP 14 renewal every 10 minutes — keeps MESSAGE_CREATE flowing.
  // Discord user-token lazy subscriptions can silently expire after long uptimes.
  // Stagger at 300ms per session: 1000 accounts = 300s (5 min), well within the
  // 10-min interval so the full fleet gets renewed every cycle.
  setInterval(() => {
    let idx = 0;
    for (const [, s] of sessions) {
      if (s.isReady) subscribeGuilds(s, idx * 300);
      idx++;
    }
  }, 10 * 60 * 1000);
}

function scheduleGatewayOpen(
  accountId: string,
  accountName: string,
  token: string,
) {
  if (!isFleetActive()) return;
  if (sessions.has(accountId) || gatewayOpenQueue.has(accountId)) return;
  gatewayOpenQueue.set(accountId, { accountId, accountName, token });
  gatewayAccountNames.set(accountId, accountName);
  gatewayStatus.set(accountId, "connecting");
  broadcastFn("gatewayStatus", {
    accountId,
    accountName,
    status: "connecting",
  });
  broadcastGatewayHealth();
  // Defer one turn so a sync pass can enqueue its whole fleet before the
  // first batch is selected. Without this, each call from a loop would pump a
  // one-account batch immediately.
  if (!gatewayOpenPumpRunning && !gatewayOpenPumpTimer) {
    gatewayOpenPumpTimer = setTimeout(() => {
      gatewayOpenPumpTimer = null;
      pumpGatewayOpenQueue();
    }, 0);
  }
}

function pumpGatewayOpenQueue() {
  if (gatewayOpenPumpRunning || gatewayOpenPumpTimer || gatewayOpenQueue.size === 0) {
    return;
  }

  gatewayOpenPumpRunning = true;
  const batch = Array.from(gatewayOpenQueue.values()).slice(
    0,
    GATEWAY_OPEN_BATCH_SIZE,
  );
  try {
    for (const entry of batch) {
      gatewayOpenQueue.delete(entry.accountId);
      pendingReconnects.delete(entry.accountId);
      try {
        openSession(entry.accountId, entry.accountName, entry.token);
      } catch (error: any) {
        // A synchronous constructor failure must not strand the rest of the
        // fleet or leave this account marked as permanently connecting.
        gatewayStatus.set(entry.accountId, "dead");
        releaseProxy(entry.accountId);
        broadcastFn("gatewayStatus", {
          accountId: entry.accountId,
          accountName: entry.accountName,
          status: "dead",
        });
        logFn(
          `GATEWAY OPEN ERR: ${entry.accountName}: ${error?.message || error}`,
        );
      }
    }
  } finally {
    gatewayOpenPumpRunning = false;
  }

  if (gatewayOpenQueue.size > 0) {
    const delay =
      GATEWAY_OPEN_BATCH_DELAY_MIN_MS +
      Math.random() *
        (GATEWAY_OPEN_BATCH_DELAY_MAX_MS - GATEWAY_OPEN_BATCH_DELAY_MIN_MS);
    logFn(
      `GATEWAY QUEUE: opened ${batch.length} account(s); ` +
        `${gatewayOpenQueue.size} waiting, next batch in ${Math.round(delay / 1000)}s`,
    );
    gatewayOpenPumpTimer = setTimeout(() => {
      gatewayOpenPumpTimer = null;
      pumpGatewayOpenQueue();
    }, delay);
  }
}

function removeQueuedGatewayOpen(accountId: string) {
  gatewayOpenQueue.delete(accountId);
}

async function syncSessions() {
  try {
    const accounts = await storage.getAccounts();
    // Keep every account name available to the dashboard, including accounts
    // that are disconnected or waiting for a retry. The gateway status API
    // should never look empty merely because a socket is currently down.
    for (const acc of accounts) {
      gatewayAccountNames.set(acc.id, acc.name);
      if (acc.status !== "Connected" && !sessions.has(acc.id)) {
        gatewayStatus.set(acc.id, "dead");
      }
    }
    // When the fleet is active, every stored account with a token remains in
    // the session set. Account status/health must not gate reply attempts.
    const connected = isFleetActive()
      ? accounts.filter((a) => a.status === "Connected" && !!a.token)
      : [];

    // All opens go through one bounded queue. This includes the first fleet
    // startup, so accounts are opened one at a time with a full gateway window
    // between attempts instead of creating an identify burst.
    for (const acc of connected) {
      if (!sessions.has(acc.id) && !pendingReconnects.has(acc.id)) {
        scheduleGatewayOpen(acc.id, acc.name, acc.token);
      }
    }

    for (const [id] of sessions) {
      const still = connected.find((a) => a.id === id);
      if (!still) closeSession(id);
    }

    // Drop queued opens for accounts that were disconnected while waiting.
    const connectedIds = new Set(connected.map((acc) => acc.id));
    for (const accountId of gatewayOpenQueue.keys()) {
      if (!connectedIds.has(accountId)) {
        removeQueuedGatewayOpen(accountId);
        gatewayStatus.delete(accountId);
        gatewayAccountNames.delete(accountId);
        broadcastFn("gatewayStatus", { accountId, status: "dead" });
      }
    }
  } catch (e: any) {
    logFn(`BOT SYNC ERROR: ${e.message}`);
  }
}

function openSession(accountId: string, accountName: string, token: string) {
  if (sessions.has(accountId)) return;

  // This guard also protects callers outside the normal queue path (for
  // example a reconnect timer firing at the same time as a sync tick).
  gatewayOpenQueue.delete(accountId);
  pendingReconnects.delete(accountId);
  gatewayAccountNames.set(accountId, accountName);
  gatewayStatus.set(accountId, "connecting");
  broadcastFn("gatewayStatus", { accountId, status: "connecting" });

  // Use saved resume URL if available (avoids full guild re-sync on reconnect)
  const resumeData = pendingResumes.get(accountId);
  let wsUrl = DISCORD_GATEWAY;
  if (resumeData && resumeData.resumeUrl) {
    const base = resumeData.resumeUrl.replace(/\?.*$/, "");
    wsUrl = base + "?v=10&encoding=json";
  }
  const fp = getFingerprint(accountId);
  const wsAgent = getWsAgent(accountId);
  const ws = new WebSocket(wsUrl, {
    headers: {
      "User-Agent": fp.userAgent,
      Origin: "https://discord.com",
    },
    ...(wsAgent ? { agent: wsAgent } : {}),
  });

  const session: GatewaySession = {
    accountId,
    accountName,
    token,
    ws,
    heartbeatTimer: null,
    initialHeartbeatTimer: null,
    heartbeatAcked: true,
    // Preserve resume state on the new socket as well. If a resumed socket
    // later drops, its close handler must still be able to save the session.
    sessionId: resumeData?.sessionId ?? null,
    resumeUrl: resumeData?.resumeUrl ?? null,
    seq: resumeData?.seq ?? null,
    reconnectTimer: null,
    identifyTimer: null,
    helloTimer: null,
    shouldReconnect: true,
    isReady: false,
    guildIds: [],
    discordUserId: null,
    guildNames: new Map(),
    channelNames: new Map(),
    adminRoleMembers: new Map(),
    adminOnlineMembers: new Map(),
    memberRoles: new Map(),
    sendQueue: [],
    sendProcessing: false,
    fingerprint: fp,
  };
  sessions.set(accountId, session);

  // Keep the underlying TCP connection active through NATs, firewalls, and
  // idle proxy tunnels. Discord's gateway heartbeat is application-level and
  // should not be the only thing keeping the transport alive.
  ws.on("open", () => {
    recordProxySuccess(accountId);
    const socket = (ws as any)._socket as {
      setKeepAlive?: (enable: boolean, initialDelay?: number) => void;
      setNoDelay?: (noDelay?: boolean) => void;
    } | undefined;
    socket?.setKeepAlive?.(true, TCP_KEEPALIVE_DELAY_MS);
    socket?.setNoDelay?.(true);
  });

  // Guard: if the TCP connection hangs and Discord never sends HELLO (op 10),
  // the session would sit in "connecting" forever — heartbeat never starts,
  // no reconnect is ever triggered. Terminate after 45s if no HELLO arrives.
  session.helloTimer = setTimeout(() => {
    if (!session.isReady && sessions.has(accountId)) {
      logFn(`HELLO TIMEOUT: ${accountName} — no HELLO in 45s, reconnecting`);
      try { session.ws.terminate(); } catch {}
    }
  }, 45_000);

  // Pre-load guild names from stored account data so they're cached before any events fire
  (async () => {
    try {
      const acc = await storage.getAccount(accountId);
      if (acc?.guilds) {
        for (const guild of acc.guilds) {
          session.guildNames.set(guild.id, guild.name);
        }
      }
    } catch (e) {
      logFn(`GUILD CACHE INIT ERROR: ${e}`);
    }
  })();

  ws.on("message", (raw: Buffer) => {
    try {
      handlePayload(JSON.parse(raw.toString()), session);
    } catch {}
  });

  ws.on("close", (code, reason) => {
    // closeSession() removes the old session before closing its socket. A
    // replacement can be opened before the old socket emits close; never let
    // that late event delete or downgrade the replacement.
    if (sessions.get(accountId) !== session) {
      clearTimers(session);
      logFn(
        `GATEWAY CLOSED (stale socket ignored): ${accountName} (code ${code})`,
      );
      return;
    }
    const closeReason = reason?.toString("utf8").trim();
    logFn(
      `GATEWAY CLOSED: ${accountName} (code ${code}` +
        `${closeReason ? `, reason ${closeReason}` : ""})`,
    );
    clearTimers(session);
    sessions.delete(accountId);
    gatewayStatus.set(accountId, "dead");
    broadcastFn("gatewayStatus", { accountId, status: "dead", accountName });
    broadcastGatewayHealth();
    // Remove this account from primary ownership immediately. The database
    // status can still be Connected while a reconnect is backing off.
    recomputeAccountRotations(accountId).catch(() => {});

    // closeSession() marks deliberate shutdowns so they cannot be mistaken for
    // a network failure and re-added to the reconnect queue.
    if (!session.shouldReconnect) {
      gatewayStatus.delete(accountId);
      return;
    }

    const fatal = [4004, 4010, 4011, 4012, 4013, 4014];
    if (!fatal.includes(code)) {
      const isGoingAway = code === 1001;
      if (isGoingAway) {
        logFn(
          `GATEWAY GOING AWAY: ${accountName} — preserving session for RESUME`,
        );
      }
      // Save RESUME data so the next connection can restore without re-IDENTIFY.
      // Code 1001 is expected to use this path; only an explicit invalid-session
      // response or a fatal auth code should discard it.
      if (session.sessionId && session.resumeUrl) {
        pendingResumes.set(accountId, {
          sessionId: session.sessionId,
          resumeUrl: session.resumeUrl,
          seq: session.seq,
        });
      }
       // Exponential backoff: 7s → 15s → 30s → 60s → capped at 90s.
      // When many accounts drop at once, spread reconnects by adding extra delay
      // proportional to the number already queued — prevents thundering-herd
      // reconnect storms from overwhelming the Discord gateway identify limit.
      const MAX_CONCURRENT_RECONNECTS = 30;
      const attempt = retryCount.get(accountId) || 0;
      retryCount.set(accountId, attempt + 1);
       // All transient close codes use the same backoff. Going Away is not
       // exempt: a fleet-wide reconnect burst can turn a harmless network
       // restart into another gateway identify storm.
       let backoff =
         RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)] +
         Math.random() * RECONNECT_JITTER_MS;
      if (pendingReconnects.size >= MAX_CONCURRENT_RECONNECTS) {
        // Add extra spread: each account above the cap adds 500ms
        const overage = pendingReconnects.size - MAX_CONCURRENT_RECONNECTS;
        backoff += overage * 500;
      }
      logFn(
        `RECONNECT ${accountName} in ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}, queue ${pendingReconnects.size})`,
      );
      pendingReconnects.add(accountId);
      // An unexpected close (especially 1006) is evidence the token may have
      // just been revoked — bust the cached health verdict so the reconnect
      // timer performs a FRESH REST check instead of trusting a stale "valid".
      tokenHealth.delete(accountId);
      session.reconnectTimer = setTimeout(async () => {
        // Keep the pendingReconnects marker until the token check and the
        // scheduling decision complete — deleting it up-front opened a window
        // where the watchdog/syncSessions could queue an UNCHECKED open while
        // the REST verification was still in flight.
        try {
          const acc = await storage.getAccount(accountId);
          if (isFleetActive() && acc?.token) {
            scheduleGatewayOpen(accountId, accountName, acc.token);
          } else if (!acc || !acc.token) {
            pendingResumes.delete(accountId);
            gatewayStatus.delete(accountId);
            gatewayAccountNames.delete(accountId);
            broadcastGatewayHealth();
          }
        } catch (error: any) {
          // Leave the account marked dead so the watchdog can retry on the
          // next tick instead of losing it on a transient MongoDB failure.
          gatewayStatus.set(accountId, "dead");
          logFn(
            `RECONNECT LOOKUP ERR: ${accountName}: ${error?.message || error}`,
          );
          broadcastGatewayHealth();
        } finally {
          pendingReconnects.delete(accountId);
        }
      }, backoff);
    } else {
      logFn(
        `⚠ TOKEN INVALID/BANNED: ${accountName} (code ${code}) — marking disconnected`,
      );
      storage.updateAccountStatus(accountId, "Disconnected").catch(() => {});
      releaseProxy(accountId);
      gatewayStatus.set(accountId, "dead");
    }
  });

  ws.on("error", (err) => {
    logFn(`GATEWAY ERR: ${accountName}: ${err.message}`);
    recordProxyFailure(accountId, err);
    // A Discord gateway close without a transport error keeps the account's
    // sticky Proxy-Cheap session. A socket error invalidates that session;
    // obtain a different provider session before the close handler queues the
    // reconnect. If all 50 slots are occupied, fail closed instead of reusing
    // a known-dead session or connecting directly.
    const replaced = replaceProxySession(accountId);
    if (!replaced) {
      invalidateProxySession(accountId);
      gatewayStatus.set(accountId, "dead");
      broadcastFn("gatewayAlert", {
        type: "proxy_recovery_blocked",
        accountId,
        accountName,
        msg: `No replacement proxy session is available for ${accountName}`,
      });
    }
    // ws normally emits close after error, but terminate explicitly so a
    // transport error can never leave the account stuck in "connecting".
    if (sessions.get(accountId) === session) {
      try {
        session.ws.terminate();
      } catch {}
    }
  });
}

function closeSession(accountId: string) {
  const s = sessions.get(accountId);
  if (!s) {
    removeQueuedGatewayOpen(accountId);
    pendingReconnects.delete(accountId);
    gatewayAccountNames.delete(accountId);
    gatewayStatus.delete(accountId);
    return;
  }
  s.shouldReconnect = false;
  clearTimers(s);
  pendingReconnects.delete(accountId);
  removeQueuedGatewayOpen(accountId);
  // Release per-session Maps immediately so GC can reclaim the memory.
  // Critical at 1000+ accounts — each Map can hold thousands of entries.
  s.guildNames.clear();
  s.channelNames.clear();
  s.adminRoleMembers.clear();
  s.adminOnlineMembers.clear();
  s.memberRoles.clear();
  s.sendQueue = [];
  try {
    s.ws.close(1000);
  } catch {}
  sessions.delete(accountId);
  gatewayStatus.delete(accountId);
  gatewayAccountNames.delete(accountId);
  releaseProxy(accountId);
  // This path is also used when the DB account is manually disconnected, so
  // do not wait for the websocket close event to release roster ownership.
  recomputeAccountRotations(accountId).catch(() => {});
}

function clearTimers(s: GatewaySession) {
  if (s.heartbeatTimer) {
    clearInterval(s.heartbeatTimer);
    s.heartbeatTimer = null;
  }
  if (s.initialHeartbeatTimer) {
    clearTimeout(s.initialHeartbeatTimer);
    s.initialHeartbeatTimer = null;
  }
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  if (s.identifyTimer) {
    clearTimeout(s.identifyTimer);
    s.identifyTimer = null;
  }
  if (s.helloTimer) {
    clearTimeout(s.helloTimer);
    s.helloTimer = null;
  }
  s.sendQueue = [];
  s.sendProcessing = false;
}

// sendPriority: heartbeats / IDENTIFY / RESUME — bypasses the rate-limit queue
function send(s: GatewaySession, payload: any) {
  if (s.ws.readyState === WebSocket.OPEN) {
    s.ws.send(JSON.stringify(payload));
    return true;
  }
  return false;
}

function sendHeartbeat(s: GatewaySession) {
  // Mark the heartbeat as awaiting ACK only when it was actually written to
  // the socket. A socket that is already closing should be handled by its
  // close event, not create a false heartbeat timeout.
  if (send(s, { op: 1, d: s.seq })) {
    s.heartbeatAcked = false;
  }
}

// safeSend: all non-critical gateway ops — queued at ≤96/min, well under Discord's 120/min limit
function safeSend(s: GatewaySession, payload: any) {
  if (s.ws.readyState !== WebSocket.OPEN) return;
  s.sendQueue.push(JSON.stringify(payload));
  if (!s.sendProcessing) drainSendQueue(s);
}

function drainSendQueue(s: GatewaySession) {
  if (s.sendQueue.length === 0) {
    s.sendProcessing = false;
    return;
  }
  s.sendProcessing = true;
  const msg = s.sendQueue.shift()!;
  if (s.ws.readyState === WebSocket.OPEN) s.ws.send(msg);
  // Jitter ±60 ms around 625 ms — stays well under Discord's 120/min limit but
  // avoids the perfectly-metronomic cadence that rate-profiling detects.
  setTimeout(() => drainSendQueue(s), 565 + Math.random() * 120);
}

function handlePayload(p: any, s: GatewaySession) {
  if (p.s != null) s.seq = p.s;

  switch (p.op) {
    case 10: {
      // HELLO — start heartbeat before authentication. Discord expects the
      // first heartbeat at a jittered point in the interval, followed by a
      // heartbeat every interval until an ACK arrives.
      const interval = Number(p.d?.heartbeat_interval);
      if (!Number.isFinite(interval) || interval <= 0) {
        logFn(`INVALID HELLO: ${s.accountName} — missing heartbeat interval`);
        s.ws.terminate();
        return;
      }
      // Connection is alive — cancel the hung-handshake watchdog
      if (s.helloTimer) { clearTimeout(s.helloTimer); s.helloTimer = null; }
      if (s.heartbeatTimer) clearInterval(s.heartbeatTimer);
      if (s.initialHeartbeatTimer) clearTimeout(s.initialHeartbeatTimer);
      if (s.identifyTimer) clearTimeout(s.identifyTimer);
      s.heartbeatAcked = true;
      // Initial heartbeat jitter — exactly what Discord's own client does
      s.initialHeartbeatTimer = setTimeout(() => {
        s.initialHeartbeatTimer = null;
        sendHeartbeat(s);
      }, Math.floor(Math.random() * interval));

      s.heartbeatTimer = setInterval(() => {
        if (!s.heartbeatAcked) {
          logFn(`HEARTBEAT TIMEOUT: ${s.accountName} — reconnecting`);
          s.ws.terminate();
          return;
        }
        sendHeartbeat(s);
      }, interval);

      // Behavioral sequencing: real clients take 1–4 s between receiving HELLO
      // and sending IDENTIFY — they load JS bundles, initialise crypto, etc.
      // Sending IDENTIFY instantly is a well-known bot tell.
      const identifyDelay = 1200 + Math.random() * 2800;
      s.identifyTimer = setTimeout(() => {
        s.identifyTimer = null;
        if (s.ws.readyState !== WebSocket.OPEN) return;
        // RESUME if we have a saved session, else full IDENTIFY
        const savedResume = pendingResumes.get(s.accountId);
        if (savedResume && savedResume.sessionId) {
          logFn(
            `↩ RESUMING: ${s.accountName} (session ${savedResume.sessionId.slice(0, 8)}...)`,
          );
          send(s, {
            op: 6,
            d: {
              token: s.token,
              session_id: savedResume.sessionId,
              seq: savedResume.seq,
            },
          });
          return; // wait for RESUMED or INVALID_SESSION
        }

        // Full IDENTIFY — per-account fingerprint exactly mirrors a real Chrome web client.
        // Every field must match what the browser actually sends — Discord's ML compares
        // this payload against the X-Super-Properties header on REST calls.
        const fp = s.fingerprint;
        // Vary initial presence — always "online" is a subtle bot signal
        const presencePool = ["online", "online", "online", "idle"];
        const initPresence = presencePool[hashStr(s.accountId + "pres") % presencePool.length];
        send(s, {
          op: 2,
          d: {
            token: s.token,
            capabilities: fp.capabilities,
            properties: {
              os: "Windows",
              browser: "Chrome",
              device: "",
              system_locale: fp.locale,
              has_client_mods: false,
              browser_user_agent: fp.userAgent,
              browser_version: fp.chromeVersion,
              os_version: fp.osVersion,
              referrer: "",
              referring_domain: "",
              referrer_current: "",
              referring_domain_current: "",
              release_channel: "stable",
              client_build_number: fp.buildNumber,
              client_event_source: null,
              // device_id: stable pseudo-UUID per account, consistent across restarts
              device_id: fp.deviceId,
              client_launch_id: fp.deviceId,
            },
            presence: {
              status: initPresence,
              since: 0,
              activities: [],
              afk: false,
            },
            compress: false,
            client_state: {
              guild_versions: {},
              highest_last_message_id: "0",
              read_state_version: 0,
              user_guild_settings_version: -1,
              user_settings_version: -1,
              private_channels_version: "0",
              api_code_version: 0,
              initial_guild_id: null,
            },
          },
        });
      }, identifyDelay);
      break;
    }

    case 11: // HEARTBEAT_ACK
      s.heartbeatAcked = true;
      break;

    case 1: // HEARTBEAT request from server
      sendHeartbeat(s);
      break;

    case 7: // RECONNECT
      s.ws.close(4000);
      break;

    case 9: // INVALID SESSION — clear stale resume data then re-identify
      pendingResumes.delete(s.accountId); // force fresh IDENTIFY on reconnect
      retryCount.delete(s.accountId); // reset backoff for clean reconnect
      // The current session is no longer resumable. Clear the copy held on the
      // live session too, otherwise the following close event would save the
      // invalid session back into pendingResumes.
      s.sessionId = null;
      s.resumeUrl = null;
      s.seq = null;
      setTimeout(() => s.ws.close(4000), 1000 + Math.random() * 4000);
      break;

    case 0: // DISPATCH events
      onDispatch(p.t, p.d, s).catch((e) =>
        logFn(`DISPATCH ERR [${p.t}]: ${e.message}`),
      );
      break;
  }
}

// ─── OP 14 subscription helper ────────────────────────────────────────────────
// Sends LAZY_REQUEST for every guild the session is in, staggered at 650ms each.
// Must be called after READY and also after RESUMED — Discord does NOT restore
// lazy subscriptions on resume, so MESSAGE_CREATE silently stops until this runs.
function subscribeGuilds(s: GatewaySession, startDelayMs = 0) {
  const guildIdsSnapshot = [...s.guildIds];
  if (guildIdsSnapshot.length === 0) return;
  (async () => {
    if (startDelayMs > 0) await new Promise((r) => setTimeout(r, startDelayMs));
    for (let i = 0; i < guildIdsSnapshot.length; i++) {
      if (!s.isReady) break;
      safeSend(s, {
        op: 14,
        d: {
          guild_id: guildIdsSnapshot[i],
          typing: true,
          activities: true,
          threads: false,
          members: [],
        },
      });
      // Jitter 500–850 ms between OP14 requests — avoids a perfectly uniform
      // burst pattern that behavioural analysis flags as automated.
      await new Promise((r) => setTimeout(r, 500 + Math.random() * 350));
    }
    logFn(`📡 OP14 refresh: ${s.accountName} — subscribed to ${guildIdsSnapshot.length} guilds`);
  })();
}

async function onDispatch(type: string, d: any, s: GatewaySession) {
  switch (type) {
    case "READY": {
      s.sessionId = d.session_id;
      s.resumeUrl = d.resume_gateway_url;
      s.isReady = true;
      s.guildIds = (d.guilds || []).map((g: any) => g.id);
      s.discordUserId = d.user?.id ?? null;
      gatewayStatus.set(s.accountId, "ready");
      // A READY event can make a previously queued account eligible, and can
      // also replace a dead account that was holding the active slot.
      recomputeAccountRotations(s.accountId).catch(() => {});

      // Clean connection — reset backoff counter and clear any stale resume data
      retryCount.delete(s.accountId);
      pendingResumes.delete(s.accountId);
      logFn(
        `✓ GATEWAY READY: ${s.accountName} (@${d.user?.username}) — ${s.guildIds.length} servers`,
      );
      broadcastFn("gatewayStatus", {
        accountId: s.accountId,
        accountName: s.accountName,
        status: "ready",
      });
      broadcastGatewayHealth();

      // Seed admin guard role subscriptions after session is ready
      setTimeout(() => refreshAdminGuardSubscriptions().catch(() => {}), 3000);

      // Subscribe immediately; message delivery should not wait for an
      // account-specific startup window.
      subscribeGuilds(s, 0);

      // Science telemetry — real Discord clients POST app_opened after READY.
      // New accounts with zero telemetry history get higher scrutiny from Discord.
      setTimeout(async () => {
        try {
          const fp = s.fingerprint;
          const scienceDelay = 8000 + Math.random() * 12000; // 8–20 s after READY
          await new Promise(r => setTimeout(r, scienceDelay));
          await proxyFetch(`${DISCORD_API}/science`, {
            method: "POST",
            headers: {
              ...makeHeaders(fp),
              Authorization: s.token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              events: [{
                type: "app_opened",
                properties: {
                  release_channel: "stable",
                  client_build_number: String(fp.buildNumber),
                  client_launch_id: fp.deviceId,
                }
              }]
            }),
          }, s.accountId);
        } catch { /* non-fatal — Discord may 404 science for new accounts */ }
      }, 0);

      break;
    }

    case "MESSAGE_CREATE":
      await onMessage(d, s);
      break;

    case "GUILD_MEMBER_REMOVE": {
      if (s.discordUserId && d.user?.id === s.discordUserId) {
        const guildName = s.guildNames.get(d.guild_id) || "Unknown Server";
        const msg = `⚠ REMOVED FROM SERVER: ${s.accountName} was kicked/left "${guildName}"`;
        logFn(msg);

        // Mark this account as kicked in the cross-workspace roster, then let the
        // global rotation engine promote the earliest-queued account (any workspace)
        await storage.updateRosterStatus(d.guild_id, s.accountId, "kicked").catch(() => {});
        await recomputeRotation(d.guild_id).catch(() => {});
        const next = await storage.getNextActiveInQueue(d.guild_id, s.accountId).catch(() => undefined);
        const rotationMsg = next
          ? `🔄 ROTATION: "${next.accountName}" is now the primary account for "${guildName}" (joined ${new Date(next.joinedAt).toISOString()})`
          : `⚠ ROTATION: No backup account available for "${guildName}" — server now uncovered`;
        logFn(rotationMsg);

        broadcastFn("accountEvent", {
          type: "kicked",
          accountId: s.accountId,
          accountName: s.accountName,
          guildId: d.guild_id,
          guildName,
          rotation: next
            ? { accountId: next.accountId, accountName: next.accountName, joinedAt: next.joinedAt }
            : null,
        });

        await sendTelegramToAllRules(s.accountId, `${msg}\n${rotationMsg}`);

        // Clean up memory: remove admin guard data for this guild
        for (const key of s.adminRoleMembers.keys()) {
          if (key.startsWith(`${d.guild_id}:`)) {
            s.adminRoleMembers.delete(key);
            s.adminOnlineMembers.delete(key);
          }
        }
        // Remove guild from in-memory session tracking
        s.guildIds = s.guildIds.filter((id) => id !== d.guild_id);
      } else if (d.user?.id) {
        // User (not this bot) left — clean up their roles cache
        s.memberRoles.delete(d.user.id);
      }
      break;
    }

    case "GUILD_BAN_ADD": {
      if (s.discordUserId && d.user?.id === s.discordUserId) {
        const guildName = s.guildNames.get(d.guild_id) || "Unknown Server";
        const msg = `🚫 BANNED: ${s.accountName} was banned from "${guildName}"`;
        logFn(msg);

        // Mark as banned in the cross-workspace roster, then rotate to the next
        // earliest-queued account globally (any workspace)
        await storage.updateRosterStatus(d.guild_id, s.accountId, "banned").catch(() => {});
        await recomputeRotation(d.guild_id).catch(() => {});
        const next = await storage.getNextActiveInQueue(d.guild_id, s.accountId).catch(() => undefined);
        const rotationMsg = next
          ? `🔄 ROTATION: "${next.accountName}" takes over "${guildName}"`
          : `⚠ ROTATION: No backup account for "${guildName}"`;
        logFn(rotationMsg);

        broadcastFn("accountEvent", {
          type: "banned",
          accountId: s.accountId,
          accountName: s.accountName,
          guildId: d.guild_id,
          guildName,
          rotation: next
            ? { accountId: next.accountId, accountName: next.accountName, joinedAt: next.joinedAt }
            : null,
        });

        await sendTelegramToAllRules(s.accountId, `${msg}\n${rotationMsg}`);
        // Remove guild from in-memory session
        s.guildIds = s.guildIds.filter((id) => id !== d.guild_id);
      }
      break;
    }

    case "GUILD_MEMBER_ADD": {
      // Use the module-level trackedGuildIds cache (rebuilt with rules cache)
      // Make sure we have fresh rules at least once so the cache is populated
      if (trackedGuildIds.size === 0) await getCachedRules();
      if (d.guild_id && trackedGuildIds.has(d.guild_id)) {
        const guildName = s.guildNames.get(d.guild_id) || d.guild_id;
        const username = d.user?.username || d.user?.id || "unknown";
        const joinKey = `${s.accountId}:${d.guild_id}:${d.user?.id}`;
        newJoiners.set(joinKey, { guildName, username, joinedAt: Date.now() });
        const logMsg = `👤 NEW MEMBER: @${username} joined "${guildName}" — tracking first message`;
        logFn(logMsg);
        broadcastFn("memberJoin", {
          accountId: s.accountId,
          guildId: d.guild_id,
          guildName,
          username,
        });
        const tgJoinMsg =
          `👤 Ghost Fleet — New Member\n\n` +
          `Profile: ${s.accountName}\n` +
          `User: @${username}\n` +
          `Server: ${guildName}\n` +
          `Status: Tracking first message (3h window)`;
        await sendTelegramToAllRules(s.accountId, tgJoinMsg);
      }
      break;
    }

    case "GUILD_CREATE": {
      const isNewGuild = d.id && !s.guildIds.includes(d.id);
      if (d.id && d.name) s.guildNames.set(d.id, d.name);
      // Only push if not already tracked (GUILD_CREATE fires for existing guilds on connect too)
      if (d.id && !s.guildIds.includes(d.id)) s.guildIds.push(d.id);
      // Cache all channel names from the guild payload
      if (Array.isArray(d.channels)) {
        for (const ch of d.channels) {
          if (ch.id && ch.name) s.channelNames.set(ch.id, ch.name);
        }
      }

      // Only refresh metadata on an EXISTING roster row (guildName/lastSeen) —
      // new roster rows are created exclusively by syncRosterFromRules() when a
      // rule is updated to include this server, never just from gateway presence.
      if (d.id && d.name) {
        getDb()
          .then((db) =>
            db.collection("server_roster").updateOne(
              { guildId: d.id, accountId: s.accountId },
              { $set: { guildName: d.name, lastSeen: new Date() } },
            ),
          )
          .catch(() => {});
      }

      // If this is a newly joined guild (after READY), auto-refresh guilds in DB
      // and send OP 14 so Discord streams MESSAGE_CREATE for this server
      if (isNewGuild && d.id && s.isReady) {
        safeSend(s, {
          op: 14,
          d: {
            guild_id: d.id,
            typing: true,
            activities: true,
            threads: false,
            members: [],
          },
        });
        logFn(`📡 OP14 subscribed to new guild: ${d.name || d.id} (${s.accountName})`);

        // Auto-update the account's guild list in DB — no manual refresh needed
        try {
          const acc = await storage.getAccount(s.accountId);
          if (acc) {
            const currentGuilds: import("@shared/schema").DiscordGuild[] = acc.guilds || [];
            const alreadyListed = currentGuilds.some((g) => g.id === d.id);
            if (!alreadyListed) {
              const newGuild: import("@shared/schema").DiscordGuild = {
                id: d.id,
                name: d.name,
                icon: d.icon ?? null,
                owner: d.owner ?? false,
                permissions: d.permissions ?? "0",
              };
              await storage.updateAccountGuilds(s.accountId, [...currentGuilds, newGuild]);
              logFn(`✓ AUTO-REFRESH: added "${d.name}" to ${s.accountName}'s guild list`);
              broadcastFn("accountGuildAdded", {
                accountId: s.accountId,
                accountName: s.accountName,
                guild: newGuild,
              });
            }
          }
        } catch (e: any) {
          logFn(`AUTO-REFRESH ERR: ${e.message}`);
        }
      }
      break;
    }

    case "CHANNEL_CREATE":
    case "CHANNEL_UPDATE": {
      if (d.id && d.name) s.channelNames.set(d.id, d.name);
      break;
    }

    case "PRESENCE_UPDATE": {
      // Track online/offline status for admin-guarded role members
      const presenceUserId: string | undefined = d.user?.id;
      const presenceGuildId: string | undefined = d.guild_id;
      const presenceStatus: string = d.status || "offline"; // "online" | "idle" | "dnd" | "offline"
      if (!presenceUserId || !presenceGuildId) break;

      // Update member roles cache if roles are included
      if (Array.isArray(d.roles)) {
        s.memberRoles.set(presenceUserId, new Set(d.roles));
      }

      const isOnline = presenceStatus !== "offline";
      // Check all adminRoleMembers maps and update online status accordingly
      for (const [key, memberSet] of s.adminRoleMembers) {
        if (!key.startsWith(presenceGuildId + ":")) continue;
        if (memberSet.has(presenceUserId)) {
          const onlineSet = s.adminOnlineMembers.get(key) ?? new Set<string>();
          if (isOnline) {
            onlineSet.add(presenceUserId);
          } else {
            onlineSet.delete(presenceUserId);
          }
          s.adminOnlineMembers.set(key, onlineSet);
        }
      }
      break;
    }

    case "GUILD_MEMBER_UPDATE": {
      // Track role changes for admin guard role members
      const memberId: string | undefined = d.user?.id;
      const memberGuildId: string | undefined = d.guild_id;
      const memberRoles: string[] = d.roles || [];
      if (!memberId || !memberGuildId) break;

      const roleSet = new Set<string>(memberRoles);
      s.memberRoles.set(memberId, roleSet);

      // Update all adminRoleMembers maps for this guild
      for (const [key, memberSet] of s.adminRoleMembers) {
        if (!key.startsWith(memberGuildId + ":")) continue;
        const roleId = key.split(":")[1];
        if (roleSet.has(roleId)) {
          memberSet.add(memberId);
        } else {
          // Lost the role — remove from tracking
          memberSet.delete(memberId);
          s.adminOnlineMembers.get(key)?.delete(memberId);
        }
      }
      break;
    }

    case "GUILD_MEMBERS_CHUNK": {
      // Response to OP 8 REQUEST_GUILD_MEMBERS — seed admin role member presences
      const chunkGuildId: string = d.guild_id;
      const members: any[] = d.members || [];
      const presences: any[] = d.presences || [];

      // Seed member roles from chunk
      for (const m of members) {
        const uid = m.user?.id;
        if (uid && Array.isArray(m.roles)) {
          s.memberRoles.set(uid, new Set(m.roles));
        }
      }

      // For each adminRoleMembers key for this guild, add members that have the role
      for (const [key, memberSet] of s.adminRoleMembers) {
        if (!key.startsWith(chunkGuildId + ":")) continue;
        const roleId = key.split(":")[1];
        for (const m of members) {
          const uid = m.user?.id;
          if (uid && Array.isArray(m.roles) && m.roles.includes(roleId)) {
            memberSet.add(uid);
          }
        }
        // Apply presences
        const onlineSet = s.adminOnlineMembers.get(key) ?? new Set<string>();
        for (const p of presences) {
          const uid = p.user?.id;
          if (!uid || !memberSet.has(uid)) continue;
          if (p.status && p.status !== "offline") {
            onlineSet.add(uid);
          } else {
            onlineSet.delete(uid);
          }
        }
        s.adminOnlineMembers.set(key, onlineSet);
        const guildName = s.guildNames.get(chunkGuildId) || chunkGuildId;
        logFn(
          `👮 ADMIN GUARD: ${memberSet.size} admins tracked in "${guildName}", ${onlineSet.size} online`,
        );
      }
      break;
    }

    case "RESUMED": {
      // RESUME succeeded — session is live again without a full guild re-sync.
      pendingResumes.delete(s.accountId);
      retryCount.delete(s.accountId);
      s.isReady = true;
      gatewayStatus.set(s.accountId, "ready");
      recomputeAccountRotations(s.accountId).catch(() => {});
      broadcastFn("gatewayStatus", {
        accountId: s.accountId,
        accountName: s.accountName,
        status: "ready",
      });
      broadcastGatewayHealth();
      logFn(`↩ RESUMED: ${s.accountName} — session restored cleanly`);
      // Re-subscribe all guilds after resume — Discord does NOT automatically
      // restore OP 14 lazy subscriptions, so MESSAGE_CREATE silently stops.
      subscribeGuilds(s, 0);
      break;
    }

    case "USER_GUILD_SETTINGS_UPDATE":
      break; // Silently ignore noisy events
  }
}

// ─── Admin guard helpers ──────────────────────────────────────────────────────
// Fetch all members with a specific role in a guild and seed the tracking maps
async function seedAdminRoleMembers(
  s: GatewaySession,
  guildId: string,
  roleId: string,
) {
  const key = `${guildId}:${roleId}`;
  if (s.adminRoleMembers.has(key)) return; // Already seeded
  s.adminRoleMembers.set(key, new Set());
  s.adminOnlineMembers.set(key, new Set());
  try {
    // OP 8: REQUEST_GUILD_MEMBERS — goes through rate-limited queue
    safeSend(s, {
      op: 8,
      d: {
        guild_id: guildId,
        query: "",
        limit: 0,
        presences: true, // include presence data
        roles: [roleId], // only members who have this role
      },
    });
    logFn(
      `👮 ADMIN GUARD: seeding members with role ${roleId} in guild ${s.guildNames.get(guildId) || guildId}`,
    );
  } catch (e: any) {
    logFn(`ADMIN GUARD SEED ERR: ${e.message}`);
  }
}

// Called when the rules cache refreshes — ensures all guard roles are seeded for active sessions
async function refreshAdminGuardSubscriptions() {
  const rules = rulesCacheData;
  for (const [, s] of sessions) {
    if (!s.isReady) continue;
    const guardRules = rules.filter(
      (r: any) => r.isActive && r.adminGuardEnabled && r.adminRoleId,
    );
    for (const rule of guardRules) {
      // For each guild this session is in, seed the admin role members
      for (const guildId of s.guildIds) {
        await seedAdminRoleMembers(s, guildId, rule.adminRoleId);
      }
    }
  }
}

async function onMessage(msg: any, s: GatewaySession) {
  if (!msg.content && !msg.embeds?.length && !msg.attachments?.length) return;
  // Ignore own messages — compare against real Discord user ID
  if (s.discordUserId && msg.author?.id === s.discordUserId) return;
  if (msg.author?.bot) return;
  if (msg.type !== 0 && msg.type !== 19) return; // Only DEFAULT and REPLY messages

  // ── Scam/redirect link filter ────────────────────────────────────────────────
  // Drops messages that contain links designed to look like support redirects
  // while actually pointing somewhere external or obfuscated. Covers:
  //   • Masked markdown links: [open a ticket](http://...) — hides the real URL
  //   • Hex/percent-encoded hostnames: http://0x... or %68%74%74%70%73%3A...
  //   • Unicode homograph hostnames: Discordᴬᴾᴵ.com, discоrd.com (Cyrillic о), etc.
  //   • IP-literal URLs: http://192.168.1.1/ticket or http://[::1]/support
  //   • Suspicious redirect keywords paired with any URL
  if (msg.content) {
    const raw = msg.content;

    // 1. Masked markdown link whose visible text contains a support/ticket lure
    //    e.g. [open a ticket here](https://scam.io)
    const maskedLinkRe = /\[([^\]]*(?:ticket|support|help|assist|open|click|here|dm|redirect)[^\]]*)\]\(https?:\/\/[^)]+\)/i;
    if (maskedLinkRe.test(raw)) {
      logFn(`LINK FILTER [masked]: dropped scam redirect from @${msg.author?.username}`);
      return;
    }

    // 2. Any markdown link where the URL host is a raw IPv4 or IPv6 address
    //    e.g. [get help](http://203.0.113.5/support)
    const ipLinkRe = /\]\(https?:\/\/(?:\d{1,3}\.){3}\d{1,3}|https?:\/\/\[[0-9a-fA-F:]+\]/i;
    if (ipLinkRe.test(raw)) {
      logFn(`LINK FILTER [ip-link]: dropped IP-literal URL from @${msg.author?.username}`);
      return;
    }

    // 3. Hex-encoded URLs: 0x[hex] host or heavily percent-encoded scheme
    //    e.g. http://0xC0A80101/ or %68%74%74%70%73%3A%2F%2F
    const hexUrlRe = /https?:\/\/0x[0-9a-fA-F]+|%[0-9a-fA-F]{2}%[0-9a-fA-F]{2}%[0-9a-fA-F]{2}/i;
    if (hexUrlRe.test(raw)) {
      logFn(`LINK FILTER [hex]: dropped hex-encoded URL from @${msg.author?.username}`);
      return;
    }

    // 4. Unicode homograph hostnames — non-ASCII characters inside a URL host
    //    e.g. discоrd.com (Cyrillic о U+043E), Discordᴬᴾᴵ.com
    //    Match any http(s):// URL whose host portion contains a non-ASCII char.
    const urlHostRe = /https?:\/\/([^\s/?#]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = urlHostRe.exec(raw)) !== null) {
      // eslint-disable-next-line no-control-regex
      if (/[^\x00-\x7F]/.test(m[1])) {
        logFn(`LINK FILTER [homograph]: dropped unicode-host URL from @${msg.author?.username}`);
        return;
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  const channelId: string = msg.channel_id;
  const guildId: string | undefined = msg.guild_id;

  // ── First-message tracking — log the first post by new members ──────────────
  if (guildId && msg.author?.id) {
    const joinKey = `${s.accountId}:${guildId}:${msg.author.id}`;
    const joinerInfo = newJoiners.get(joinKey);
    if (joinerInfo) {
      // Evict expired entries while we're here
      const now = Date.now();
      for (const [k, v] of newJoiners) {
        if (now - v.joinedAt > NEW_JOINER_TTL) newJoiners.delete(k);
      }
      newJoiners.delete(joinKey);
      const preview = (msg.content || "[attachment/embed]").substring(0, 100);
      const logMsg = `💬 FIRST MSG: @${msg.author.username || joinerInfo.username} in "${joinerInfo.guildName}" — "${preview}"`;
      logFn(logMsg);
      broadcastFn("firstMessage", {
        accountId: s.accountId,
        guildName: joinerInfo.guildName,
        username: msg.author.username || joinerInfo.username,
        channelId,
        content: preview,
      });
    }
  }

  // Use cached rules — avoids a DB hit on every message
  const rules = await getCachedRules();
  const active = rules.filter(
    (r: any) =>
      r.isActive && (r.profileId === s.accountId || r.profileId === "all"),
  );

  for (const rule of active) {
    // ── Resolve server/channel config — per-profile in fleet-wide mode ─────
    let servers: { id: string; name: string }[];
    let channels: { id: string; name: string; serverId: string }[];
    let ruleAllChannels = rule.allChannels ?? false;

    if (rule.profileId === "all") {
      // Fleet rules: per-account server/channel config from profileConfigs.
      // Empty selectedServers for an account = SILENT (does not fire on any server).
      const cfg = rule.profileConfigs
        ? (rule.profileConfigs as any)[s.accountId]
        : undefined;
      servers = (cfg?.selectedServers || []) as { id: string; name: string }[];
      channels = (cfg?.selectedChannels || []) as {
        id: string;
        name: string;
        serverId: string;
      }[];
      ruleAllChannels = cfg
        ? (cfg.allChannels ?? false)
        : (rule.allChannels ?? false);
    } else {
      // Single-account rule: use rule-level server/channel settings.
      servers = (rule.selectedServers || []) as { id: string; name: string }[];
      channels = (rule.selectedChannels || []) as {
        id: string;
        name: string;
        serverId: string;
      }[];
    }

    let shouldFire = false;
    if (ruleAllChannels) {
      if (rule.profileId === "all") {
        // Fleet: must have explicit servers selected — empty = silent
        shouldFire =
          servers.length > 0 && servers.some((srv: any) => srv.id === guildId);
      } else {
        // Single-account: empty servers = fire on all guilds
        shouldFire =
          servers.length === 0
            ? !!guildId
            : servers.some((srv: any) => srv.id === guildId);
      }
    } else {
      shouldFire = channels.some((ch: any) => ch.id === channelId);
    }
    if (!shouldFire) continue;

    // Rotation/roster gate removed — rule config alone decides who may fire.
    // Per-message dedup below still guarantees one reply per message per rule.

    // Keyword matching
    if (rule.triggerCondition === "keyword") {
      if (!rule.keyword) continue;
      const keywords = rule.keyword
        .split(",")
        .map((k: string) => k.trim().toLowerCase())
        .filter(Boolean);
      const content = (msg.content || "").toLowerCase();
      if (!keywords.some((kw: string) => content.includes(kw))) continue;
    }
    // "any" trigger — fires on every message in matched channel/server

    const delayMs = humanReplyDelayMs(rule);
    const chInfo = channels.find((c: any) => c.id === channelId);
    const srvInfo = servers.find((sv: any) => sv.id === guildId);
    const ruleId = rule.id;
    const ruleLabel = rule.label;
    // Capture trigger content + keywords for AI check (closure-safe)
    const triggerContent = msg.content || "";
    const triggerKeywords = rule.keyword
      ? rule.keyword
          .split(",")
          .map((k: string) => k.trim())
          .filter(Boolean)
      : [];

    // Enqueue this send — serialised per channel.
    // Re-checks isActive right before sending so paused rules are never sent.
    enqueueChannelSend(channelId, delayMs, async () => {
      try {
        // Re-read rule state at fire time — catches pause/delete during delay
        const liveRule = await storage.getRule(ruleId);
        if (!liveRule || !liveRule.isActive) {
          logFn(
            `SKIPPED [${ruleLabel}]: rule was paused or deleted before send`,
          );
          return;
        }

        // Claim inside the serialized send callback. A second account/process
        // cannot send the same message while this one is waiting on the delay.
        const messageClaimed =
          msg.id ? await alreadyFired(msg.id, ruleId) : false;
        if (messageClaimed) {
          logFn(
            `DEDUP [${ruleLabel}]: message already claimed — skipping duplicate`,
          );
          return;
        }

        // ── AI Classification gate ─────────────────────────────────────────
        // Keyword matching is the cheap pre-filter; every keyword hit is then
        // checked by the classifier. This is intentionally always-on so the
        // rule UI and runtime have one unambiguous behavior. Any-message rules
        // intentionally skip this gate because they are explicit direct
        // triggers.
        let aiConfidence = 100;
        let aiGeneralConfidence = 100;
        let aiReasoning = "No AI check";
        let aiIsCrypto = true;
        if (rule.triggerCondition === "keyword" && triggerKeywords.length > 0) {
          const aiResult = await aiClassifyMessage(
            triggerContent,
            triggerKeywords,
          );
          aiConfidence = aiResult.confidence;
          aiGeneralConfidence = aiResult.generalIssueConfidence;
          aiReasoning = aiResult.reasoning;
          aiIsCrypto = aiResult.isCrypto;
          logFn(
            `AI [${ruleLabel}]: crypto=${aiConfidence}% general=${aiGeneralConfidence}% — ${aiReasoning}`,
          );

          if (aiConfidence < 40) {
            if (aiGeneralConfidence >= 50) {
              // Fallback: genuine question/issue — allow response even if not topic-specific
              logFn(
                `AI FALLBACK [${ruleLabel}]: crypto=${aiConfidence}% but general issue=${aiGeneralConfidence}% ≥50% — allowing`,
              );
            } else {
              // AI blocked — log with clear label so the user knows why
              logFn(
                `⛔ AI BLOCKED [${ruleLabel}]: crypto=${aiConfidence}% general=${aiGeneralConfidence}% — ${aiReasoning}`,
              );
              return;
            }
          }
        }
        // ──────────────────────────────────────────────────────────────────

        const resolvedSrvNameForSend =
          srvInfo?.name || s.guildNames.get(guildId || "") || undefined;

        const sendResult = await discordSend(
          channelId,
          s.token,
          liveRule,
          msg.id,
          guildId,
          msg.author?.username,
          msg.author?.id,
          resolvedSrvNameForSend,
          s.accountId,
        );
        if (!sendResult.ok) {
          const txt = await sendResult.text();
          const channelName = await resolveChannelName(channelId, s);
          const guildName = guildId
            ? s.guildNames.get(guildId) || guildId
            : "Unknown";

          // Track 403s — blacklist after 3 consecutive failures on same channel
          if (sendResult.status === 403) {
            record403(s.accountId, channelId, s.accountName, channelName, guildName);
            logFn(
              `SEND FAILED [${ruleLabel}]: ${s.accountName} → ${guildName}/#${channelName} — No permission (403). Fix channel perms in Discord.`,
            );
          } else {
            logFn(
              `SEND FAILED [${ruleLabel}]: Discord ${sendResult.status} — ${txt}`,
            );
          }

          // Rate-limited Telegram failure alert — max 1 per channel per hour
          if (
            liveRule.telegramEnabled &&
            liveRule.telegramToken &&
            liveRule.telegramChatId &&
            shouldSendTgFailure(ruleId, channelId)
          ) {
            const is403 = sendResult.status === 403;
            const errMsg = is403
              ? `⚠️ PERMISSION ERROR — ${ruleLabel}\n\nAccount: ${s.accountName}\nServer: ${guildName}\nChannel: #${channelName}\n\nThis account lacks "Send Messages" permission in this channel. Fix it in Discord server settings.\n\n(This alert will repeat max once/hour)`
              : `❌ SEND FAILED [${ruleLabel}]\n\nServer: ${guildName}\nChannel: #${channelName}\nStatus: Discord ${sendResult.status}\nError: ${txt.substring(0, 100)}`;
            await sendTelegram(
              liveRule.telegramToken,
              liveRule.telegramChatId,
              errMsg,
            );
          }
          return;
        }

        // Parse the sent message to get its ID (needed for reactions + auto-delete)
        const sentMsg = await sendResult.json().catch(() => null);
        const sentMsgId = sentMsg?.id;

        const resolvedChanName = await resolveChannelName(channelId, s);
        const resolvedSrvName =
          srvInfo?.name || s.guildNames.get(guildId || "") || guildId || "DM";

        // Notify immediately after Discord accepts the reply. This prevents a
        // later history/broadcast failure from hiding a real successful reply
        // from Telegram.
        if (
          liveRule.telegramEnabled &&
          liveRule.telegramToken &&
          liveRule.telegramChatId
        ) {
          const aiScoreLine =
            rule.triggerCondition === "keyword"
              ? `AI Score: ${aiConfidence}% (crypto) | ${aiGeneralConfidence}% (general) ✅\nAI Reason: ${aiReasoning}\n`
              : "";
          const tgMsg =
            `🤖 Ghost Fleet Auto-Reply\n\n` +
            `Rule: ${ruleLabel}\n` +
            `Profile: ${s.accountName}\n` +
            `${aiScoreLine}` +
            `Server: ${resolvedSrvName}\n` +
            `Channel: #${resolvedChanName}\n` +
            `Triggered by: @${msg.author?.username}\n` +
            `Message: "${triggerContent.substring(0, 80)}"\n` +
            `Delay: ${delayMs}ms`;
          await sendTelegram(
            liveRule.telegramToken,
            liveRule.telegramChatId,
            tgMsg,
          );
        }

        // Schedule auto-delete of the sent message if deleteDelayMs is set
        const deleteDelayMs = (liveRule as any).deleteDelayMs ?? 0;
        if (deleteDelayMs > 0 && sentMsgId) {
          setTimeout(async () => {
            try {
              await proxyFetch(
                `${DISCORD_API}/channels/${channelId}/messages/${sentMsgId}`,
                {
                  method: "DELETE",
                  headers: { ...makeHeaders(s.fingerprint), Authorization: s.token },
                },
                s.accountId,
              );
              logFn(
                `🗑 AUTO-DELETE [${ruleLabel}] msg ${sentMsgId} after ${deleteDelayMs}ms`,
              );
            } catch (e: any) {
              logFn(`DELETE ERR [${ruleLabel}]: ${e.message}`);
            }
          }, deleteDelayMs);
        }

        await storage.incrementRuleResponseCount(ruleId);

        await storage.createHistory({
          workspaceId: liveRule.workspaceId ?? undefined,
          accName: s.accountName,
          accId: s.accountId,
          srvName: resolvedSrvName,
          srvId: guildId || null,
          chanName: resolvedChanName,
          chanId: channelId,
          target: msg.author?.username || "unknown",
          targetId: msg.author?.id || null,
          msg: liveRule.message.substring(0, 300),
          ruleId: ruleId,
          ruleLabel: ruleLabel,
          latencyMs: delayMs,
        });

        const logMsg = `✓ AUTO-REPLY [${ruleLabel}] → #${resolvedChanName} | trigger: "${(msg.content || "").substring(0, 40)}" | by: @${msg.author?.username} | ${delayMs}ms`;
        logFn(logMsg, liveRule.workspaceId ?? undefined);
        broadcastFn("autoReply", {
          ruleLabel,
          channel: resolvedChanName,
          target: msg.author?.username,
          delay: delayMs,
        });

      } catch (e: any) {
        logFn(`AUTO-REPLY ERR [${ruleLabel}]: ${e.message}`);
        // Rate-limited Telegram error alert — max 1 per channel per hour
        if (
          rule.telegramEnabled &&
          rule.telegramToken &&
          rule.telegramChatId &&
          shouldSendTgFailure(ruleId, channelId)
        ) {
          const isTimeout = /timeout|timed out/i.test(e.message || "");
          const failType = isTimeout ? "⏱ TIMEOUT" : "❌ SEND ERROR";
          const errNotify =
            `${failType} — Ghost Fleet\n\n` +
            `Rule: ${ruleLabel}\n` +
            `Profile: ${s.accountName}\n` +
            `Server: ${srvInfo?.name || s.guildNames.get(guildId || "") || guildId || "Unknown"}\n` +
            `Error: ${(e.message || "Unknown error").substring(0, 200)}\n\n(This alert repeats max once/hour per channel)`;
          await sendTelegram(
            rule.telegramToken,
            rule.telegramChatId,
            errNotify,
          ).catch(() => {});
        }
      }
    });
  }
}

// NOTE: Discord user tokens CANNOT send embeds — only bots can.
// All messages (embed or text type) must use the `content` field.
// The rule.message already contains Discord markdown for formatting.

// ─── Bot-mode message templates ───────────────────────────────────────────────
// Six distinct visual styles rotated per send so no two accounts blast the same
// message pattern within a short window — defeats cross-account pattern matching.
type BotTemplate = (
  srv: string,
  msg: string,
  ref: string,
  ri: () => string,
) => string;

const BOT_TEMPLATES: BotTemplate[] = [
  // 0 — Support ticket card (blockquote style)
  (srv, msg, _ref, ri) =>
    [
      "> ",
      `> 💠 **${srv} Support**`,
      `> Please open a ticket in our dedicated support channel to get an immediate response from one of our team members${ri()}`,
      "> ",
      `> 📥 **CLICK HERE**: ${msg}`,
    ].join("\n"),

  // 1 — Staff notice (compact blockquote)
  (srv, msg, _ref, ri) =>
    [
      `> 🔷 **${srv} Tickets**${ri()}`,
      `> A team member will assist you shortly.${ri()}`,
      `> `,
      `> click 👉 ${msg} to open a ticket.`,
    ].join("\n"),

  // 2 — Community guide (blockquote with call-to-action)
  (srv, msg, _ref, ri) =>
    [
      `> 📋 **${srv} Assistant**${ri()}`,
      `> For faster assistance please use our official support channel link below.${ri()}`,
      `> `,
      `> ➡️ ${msg}`,
    ].join("\n"),

  // 3 — Automated notice with ref number
  (srv, msg, ref, ri) =>
    [
      `> **Issue Noticed** · ${srv}${ri()}`,
      `> Raise your issue in our ticket below${ri()}`,
      `> ${msg}`,
      `> `,
      `> *Ref: Ticket ${ref}*`,
    ].join("\n"),

  // 4 — Helper bot (minimal inline blockquote)
  (srv, msg, _ref, ri) =>
    [`> 🛎️ **${srv}** Support Below.${ri()}`, `> `, `> ${msg}${ri()}`].join("\n"),

  // 5 — Clean inline (no blockquote — different visual rhythm entirely)
  (_srv, msg, _ref, ri) =>
    [`hey mate please open a ticket in our support channel below${ri()}`, ``, `${msg}${ri()}`].join("\n"),
];

async function discordSend(
  channelId: string,
  token: string,
  rule: any,
  replyToId: string,
  guildId?: string,
  authorUsername?: string,
  authorId?: string,
  guildName?: string,
  accountId?: string,
): Promise<Response> {
  const serverLabel = guildName || "Server";

  // ── Per-account HTTP headers ───────────────────────────────────────────────
  const fp = accountId ? getFingerprint(accountId) : null;
  const reqHeaders = fp ? makeHeaders(fp) : HEADERS;

  // ── Typing pacing before every send ────────────────────────────────────────
  // The configured rule delay is applied by enqueueChannelSend. The typing
  // duration below is the only additional message delay.
  try {
    // Send typing indicator — tells Discord "a human is composing"
    await proxyFetch(`${DISCORD_API}/channels/${channelId}/typing`, {
      method: "POST",
      headers: { ...reqHeaders, Authorization: token },
    }, accountId);

    // Typing duration scales with reply length and remains the only pacing
    // delay inside the send operation.
    const replyText = rule.message || "";
    const wordCount = Math.max(1, replyText.split(/\s+/).length);
    const typingMs = Math.min(
      1200,
      wordCount * (90 + Math.random() * 40) + Math.random() * 250,
    );
    await new Promise((r) => setTimeout(r, typingMs));
  } catch {
    // Typing endpoint failure is non-fatal — continue with the send
  }

  let content: string;
  if (rule.botMode) {
    // ── Anti-duplicate layer: invisible Unicode chars sprinkled throughout ──
    const invisPool = [
      "\u200b", "\u200c", "\u200d", "\u2060",
      "\u034f", "\u00ad", "\u2061", "\u2062",
    ];
    const ri = () => invisPool[Math.floor(Math.random() * invisPool.length)];

    // ── Random 4-digit REF in bold sans-serif digits ───────────────────────
    const boldDigits = ["𝟬","𝟭","𝟮","𝟯","𝟰","𝟱","𝟲","𝟳","𝟴","𝟵"];
    const toBold = (n: number) =>
      String(n).padStart(4, "0").split("").map((d) => boldDigits[+d]).join("");
    const refNum =
      Math.random() < 0.7
        ? Math.floor(Math.random() * 1000)
        : 1000 + Math.floor(Math.random() * 9000);
    const refStr = toBold(refNum) + "-G";

    // Pick one of 6 templates at random — different accounts, different styles
    const tplIdx = Math.floor(Math.random() * BOT_TEMPLATES.length);
    content = BOT_TEMPLATES[tplIdx](serverLabel, rule.message, refStr, ri);
  } else {
    // Plain mode — use rule message directly.
    content = rule.message;
  }

  // Prepend the author mention on its own line so the tag doesn't bleed
  // into the blockquote — the > formatting renders cleanly below it.
  if (authorId) {
    content = `<@${authorId}>\n${content}`;
  }

  // ── Thread creation mode ──────────────────────────────────────────────────
  // If replyInThread is enabled, create a public thread from the trigger message
  // then send the reply inside that thread.
  if (rule.replyInThread) {
    try {
      const threadName = authorUsername
        ? `Support for @${authorUsername}`
        : "Support Thread";

      // Create a thread from the triggering message
      const threadResp = await Promise.race([
        proxyFetch(
          `${DISCORD_API}/channels/${channelId}/messages/${replyToId}/threads`,
          {
            method: "POST",
            headers: {
              ...reqHeaders,
              Authorization: token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: threadName,
              auto_archive_duration: 1440,
              rate_limit_per_user: 0,
            }),
          },
          accountId,
        ),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("THREAD_TIMEOUT")), 10000),
        ),
      ]);

      if (threadResp.ok) {
        const threadData = await threadResp.json();
        const threadId: string = threadData.id;

        return Promise.race([
          proxyFetch(`${DISCORD_API}/channels/${threadId}/messages`, {
            method: "POST",
            headers: {
              ...reqHeaders,
              Authorization: token,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ content, nonce: discordNonce() }),
          }, accountId),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("THREAD_SEND_TIMEOUT")), 10000),
          ),
        ]);
      }
    } catch (e: any) {
      // Log timeout error
      if (e.message?.includes("TIMEOUT")) {
        logFn(`TIMEOUT [Thread Send]: ${e.message}`);
      }
    }
  }
  // ── Standard reply (reply_in_thread disabled or thread creation failed) ───

  const body: Record<string, any> = {
    content,
    message_reference: {
      message_id: replyToId,
      channel_id: channelId,
      ...(guildId ? { guild_id: guildId } : {}),
      fail_if_not_exists: false,
    },
    nonce: discordNonce(),
  };

  return proxyFetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      ...reqHeaders,
      Authorization: token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, accountId);
}

// Resolve a channel name — session cache → in-flight dedup → Discord REST API
async function resolveChannelName(
  channelId: string,
  s: GatewaySession,
): Promise<string> {
  const cached = s.channelNames.get(channelId);
  if (cached) return cached;
  // Dedup: if another caller is already fetching this channel, share their promise
  const key = `${s.accountId}:${channelId}`;
  const inflight = channelResolvePending.get(key);
  if (inflight) return inflight;
  const promise = (async () => {
    try {
      const resp = await proxyFetch(`${DISCORD_API}/channels/${channelId}`, {
        headers: { ...makeHeaders(s.fingerprint), Authorization: s.token },
      }, s.accountId);
      if (resp.ok) {
        const ch = await resp.json();
        if (ch.name) {
          s.channelNames.set(channelId, ch.name);
          channelResolvePending.delete(key);
          return ch.name;
        }
      }
    } catch {}
    channelResolvePending.delete(key);
    return channelId;
  })();
  channelResolvePending.set(key, promise);
  return promise;
}

async function sendTelegram(botToken: string, chatId: string, text: string) {
  try {
    const response = await fetch(`${TELEGRAM_API}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // The notification text contains user/rule content. Do not request
      // HTML parsing: an unescaped "<" or "&" makes Telegram reject the
      // entire notification, which previously happened silently.
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const responseText = await response.text();
    if (!response.ok) {
      logFn(
        `TELEGRAM FAILED: HTTP ${response.status} — ${responseText.substring(0, 300)}`,
      );
      return false;
    }
    let result: any = null;
    try {
      result = JSON.parse(responseText);
    } catch {}
    if (result && result.ok === false) {
      logFn(`TELEGRAM FAILED: ${String(result.description || "API rejected message").substring(0, 300)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    logFn(`TELEGRAM ERR: ${e.message}`);
    return false;
  }
}

async function sendTelegramToAllRules(accountId: string, message: string) {
  try {
    const rules = await getCachedRules();
    const relevant = rules.filter(
      (r: any) =>
        r.telegramEnabled &&
        r.telegramToken &&
        r.telegramChatId &&
        (r.profileId === accountId || r.profileId === "all"),
    );
    // Deduplicate by chat ID — send only once per unique (token, chatId) pair
    const seen = new Set<string>();
    for (const rule of relevant) {
      const key = `${rule.telegramToken}:${rule.telegramChatId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      await sendTelegram(rule.telegramToken!, rule.telegramChatId!, message);
    }
  } catch {}
}

export async function sendTestMessage(
  ruleId: number,
): Promise<{ success: boolean; message: string }> {
  const rule = await storage.getRule(ruleId);
  if (!rule) return { success: false, message: "Rule not found" };

  const channels = (rule.selectedChannels || []) as {
    id: string;
    name: string;
    serverId: string;
  }[];
  if (channels.length === 0)
    return { success: false, message: "No channels selected in rule" };

  const account = await storage.getAccount(rule.profileId);
  if (!account)
    return {
      success: false,
      message: "Account not found — check the profile linked to this rule",
    };
  const target = channels[0];
  // User tokens cannot send embeds — always use content
  const testFp = getFingerprint(account.id);
  const body: Record<string, any> = {
    content: `[TEST] ${rule.message}`,
    nonce: discordNonce(),
  };

  const res = await proxyFetch(`${DISCORD_API}/channels/${target.id}/messages`, {
    method: "POST",
    headers: {
      ...makeHeaders(testFp),
      Authorization: account.token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  }, account.id);

  if (res.ok) {
    logFn(
      `✓ TEST SENT: Rule "${rule.label}" → #${target.name}`,
      rule.workspaceId ?? undefined,
    );
    return { success: true, message: `Sent to #${target.name}` };
  } else {
    const txt = await res.text();
    let errMsg = `Discord ${res.status}`;
    try {
      errMsg = JSON.parse(txt).message || errMsg;
    } catch {}
    logFn(`✗ TEST FAILED: Rule "${rule.label}" — ${errMsg}`);
    return { success: false, message: errMsg };
  }
}

export function getGatewayStatus(): {
  accountId: string;
  accountName: string;
  status: string;
}[] {
  const accountIds = new Set([
    ...gatewayStatus.keys(),
    ...gatewayOpenQueue.keys(),
    ...sessions.keys(),
    ...gatewayAccountNames.keys(),
  ]);
  return Array.from(accountIds).map((accountId) => {
    const session = sessions.get(accountId);
    return {
      accountId,
      accountName:
        session?.accountName ||
        gatewayOpenQueue.get(accountId)?.accountName ||
        gatewayAccountNames.get(accountId) ||
        accountId,
      status: gatewayStatus.get(accountId) || "dead",
    };
  });
}

export function refreshSessions() {
  syncSessions();
}

// ─── Gateway health broadcast ────────────────────────────────────────────────
// Emits a summary of session counts to all dashboard clients.
function broadcastGatewayHealth() {
  const all = Array.from(gatewayStatus.entries());
  const ready = all.filter(([, s]) => s === "ready").length;
  const dead = all.filter(([, s]) => s === "dead").length;
  const connecting = all.filter(([, s]) => s === "connecting").length;
  const deadNames: string[] = [];
  for (const [id, st] of all) {
    if (st === "dead") {
      deadNames.push(gatewayAccountNames.get(id) || id);
    }
  }
  broadcastFn("gatewayHealth", {
    total: all.length,
    ready,
    dead,
    connecting,
    recovering: pendingReconnects.size,
    deadIds: all.filter(([, s]) => s === "dead").map(([id]) => id),
  });
}

// ─── Gateway watchdog ────────────────────────────────────────────────────────
// Runs every 30s. Finds accounts that are Connected in the DB but whose
// session is dead AND has no pending reconnect timer (orphan), then forces
// an immediate reconnect. Also broadcasts the health summary on every tick.
// Max orphaned sessions the watchdog will force-open per tick.
// Prevents a thundering-herd of simultaneous WS connections if many accounts
// drop at once (network blip, server restart, etc.).
const WATCHDOG_MAX_RECOVERY_PER_TICK = 15;

async function gatewayWatchdog() {
  try {
    if (!isFleetActive()) return;
    const accounts = await storage.getAccounts();
    const connected = accounts.filter((a) => !!a.token);
    const orphans: typeof connected = [];
    for (const acc of connected) {
      const st = gatewayStatus.get(acc.id);
      if (
        st === "dead" &&
        !sessions.has(acc.id) &&
        !pendingReconnects.has(acc.id)
      ) {
        orphans.push(acc);
      }
    }
    if (orphans.length > 0) {
      const batch = orphans.slice(0, WATCHDOG_MAX_RECOVERY_PER_TICK);
      logFn(
        `WATCHDOG: queueing recovery for ${batch.length}/${orphans.length} orphaned session(s)`,
      );
      // The shared gateway queue applies the one-account batch limit and
      // 5–7-second inter-batch delay to these recovery attempts as well.
      for (let i = 0; i < batch.length; i++) {
        const acc = batch[i];
        setTimeout(
          () => scheduleGatewayOpen(acc.id, acc.name, acc.token),
          i * 500,
        );
      }
      broadcastFn("gatewayAlert", {
        type: "recovery",
        count: batch.length,
        msg: `WATCHDOG: forced recovery for ${batch.length} orphaned session(s)`,
      });
    }
    broadcastGatewayHealth();
  } catch (e: any) {
    logFn(`WATCHDOG ERR: ${e.message}`);
  }
}
