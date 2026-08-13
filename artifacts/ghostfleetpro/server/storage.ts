import { getDb, nextId } from "./db";
import type {
  Workspace, InsertWorkspace,
  Account,   InsertAccount,
  Rule,      InsertRule,
  History,   InsertHistory,
  DiscordGuild,
} from "@shared/schema";

export type License = {
  code: string;
  label: string | null;
  fingerprint: string | null;
  activatedAt: Date | null;
  createdAt: Date;
  isActive: boolean;
};

export type ServerRosterEntry = {
  guildId: string;
  guildName: string;
  accountId: string;
  accountName: string;
  workspaceId: number | null;
  joinedAt: Date;       // time this account+server was added to an ACTIVE rule — determines global rotation order
  lastSeen: Date;       // updated on each sync/heartbeat
  status: "active" | "queued" | "kicked" | "banned" | "left";
  primaryRequested?: boolean; // admin-selected preference; never overrides health checks
};

// ─── Interface ────────────────────────────────────────────────────────────────

export interface IStorage {
  // Workspaces
  getWorkspaces(): Promise<Workspace[]>;
  getWorkspace(id: number): Promise<Workspace | undefined>;
  getWorkspaceByName(name: string): Promise<Workspace | undefined>;
  createWorkspace(ws: InsertWorkspace): Promise<Workspace>;
  deleteWorkspace(id: number): Promise<void>;

  // Accounts
  getAccounts(workspaceId?: number): Promise<Account[]>;
  getAccount(id: string): Promise<Account | undefined>;
  createAccount(account: InsertAccount & { workspaceId?: number }): Promise<Account>;
  updateAccount(id: string, update: Partial<Account>): Promise<Account>;
  deleteAccount(id: string): Promise<void>;
  updateAccountGuilds(id: string, guilds: DiscordGuild[]): Promise<void>;
  updateAccountStatus(id: string, status: string): Promise<void>;

  // Rules
  getRules(workspaceId?: number): Promise<Rule[]>;
  getRule(id: number): Promise<Rule | undefined>;
  createRule(rule: InsertRule & { workspaceId?: number }): Promise<Rule>;
  updateRule(id: number, rule: Partial<InsertRule>): Promise<Rule>;
  deleteRule(id: number): Promise<void>;
  incrementRuleResponseCount(id: number): Promise<void>;

  // History
  getHistory(workspaceId?: number): Promise<History[]>;
  createHistory(log: InsertHistory & { workspaceId?: number }): Promise<History>;
  deleteOldHistory(olderThanMs: number): Promise<number>;

  // Config
  getConfig(): Promise<Record<string, string>>;
  setConfig(key: string, value: string): Promise<void>;

  // Licenses
  getLicenses(): Promise<License[]>;
  getLicense(code: string): Promise<License | undefined>;
  getLicenseByFingerprint(fingerprint: string): Promise<License | undefined>;
  createLicense(code: string, label?: string): Promise<License>;
  activateLicense(code: string, fingerprint: string): Promise<License>;
  revokeLicense(code: string): Promise<void>;

  // Server Roster (cross-workspace server presence tracker)
  upsertRosterEntry(entry: Omit<ServerRosterEntry, "joinedAt" | "lastSeen" | "status"> & { status?: ServerRosterEntry["status"] }): Promise<ServerRosterEntry>;
  updateRosterStatus(guildId: string, accountId: string, status: ServerRosterEntry["status"]): Promise<void>;
  getServerQueue(guildId: string): Promise<ServerRosterEntry[]>;
  getNextActiveInQueue(guildId: string, excludeAccountId: string): Promise<ServerRosterEntry | undefined>;
  getRosterByAccount(accountId: string): Promise<ServerRosterEntry[]>;
  purgeOrphanedRosterEntries(): Promise<number>;

  // Stats
  getStats(workspaceId?: number): Promise<{
    activeRules: number; totalLogs: number; autoReplies: number;
    totalRules: number; connectedAccounts: number;
  }>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Strip MongoDB _id and return clean domain object
function clean<T>(doc: any): T {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
}

// ─── MongoStorage ─────────────────────────────────────────────────────────────

export class MongoStorage implements IStorage {

  // ── Workspaces ──────────────────────────────────────────────────────────────

  async getWorkspaces(): Promise<Workspace[]> {
    const db = await getDb();
    const docs = await db.collection("workspaces").find().sort({ id: 1 }).toArray();
    return docs.map(d => clean<Workspace>(d));
  }

  async getWorkspace(id: number): Promise<Workspace | undefined> {
    const db = await getDb();
    const doc = await db.collection("workspaces").findOne({ id });
    return doc ? clean<Workspace>(doc) : undefined;
  }

  async getWorkspaceByName(name: string): Promise<Workspace | undefined> {
    const db = await getDb();
    const doc = await db.collection("workspaces").findOne({ name });
    return doc ? clean<Workspace>(doc) : undefined;
  }

  async createWorkspace(ws: InsertWorkspace): Promise<Workspace> {
    const db = await getDb();
    const id = await nextId(db, "workspaces");
    const doc: Workspace = {
      id,
      name:      ws.name,
      password:  ws.password ?? null,
      createdAt: new Date(),
    };
    await db.collection("workspaces").insertOne({ ...doc });
    return doc;
  }

  async deleteWorkspace(id: number): Promise<void> {
    const db = await getDb();
    await db.collection("workspaces").deleteOne({ id });
  }

  // ── Accounts ────────────────────────────────────────────────────────────────

  async getAccounts(workspaceId?: number): Promise<Account[]> {
    const db = await getDb();
    const filter = workspaceId ? { workspaceId } : {};
    const docs = await db.collection("accounts").find(filter).sort({ lastSeen: -1 }).toArray();
    return docs.map(d => clean<Account>(d));
  }

  async getAccount(id: string): Promise<Account | undefined> {
    const db = await getDb();
    const doc = await db.collection("accounts").findOne({ id });
    return doc ? clean<Account>(doc) : undefined;
  }

  async createAccount(account: InsertAccount & { workspaceId?: number }): Promise<Account> {
    const db = await getDb();
    const existing = await this.getAccount(account.id);
    const doc: Account = {
      id:            account.id,
      workspaceId:   account.workspaceId ?? null,
      name:          account.name,
      token:         account.token,
      status:        account.status ?? "Connected",
      avatar:        account.avatar ?? null,
      username:      account.username ?? null,
      discriminator: account.discriminator ?? null,
      guilds:        [],
      lastSeen:      new Date(),
    };
    if (existing) {
      await db.collection("accounts").replaceOne({ id: account.id }, { ...doc });
    } else {
      await db.collection("accounts").insertOne({ ...doc });
    }
    return doc;
  }

  async updateAccount(id: string, update: Partial<Account>): Promise<Account> {
    const db = await getDb();
    const { _id, ...safe } = update as any;
    await db.collection("accounts").updateOne({ id }, { $set: safe });
    const doc = await db.collection("accounts").findOne({ id });
    return clean<Account>(doc);
  }

  async deleteAccount(id: string): Promise<void> {
    const db = await getDb();
    await db.collection("accounts").deleteOne({ id });
  }

  async updateAccountGuilds(id: string, guilds: DiscordGuild[]): Promise<void> {
    const db = await getDb();
    await db.collection("accounts").updateOne({ id }, { $set: { guilds } });
  }

  async updateAccountStatus(id: string, status: string): Promise<void> {
    const db = await getDb();
    await db.collection("accounts").updateOne({ id }, { $set: { status, lastSeen: new Date() } });
  }

  // ── Rules ───────────────────────────────────────────────────────────────────

  async getRules(workspaceId?: number): Promise<Rule[]> {
    const db = await getDb();
    const filter = workspaceId ? { workspaceId } : {};
    const docs = await db.collection("rules").find(filter).sort({ id: -1 }).toArray();
    return docs.map(d => clean<Rule>(d));
  }

  async getRule(id: number): Promise<Rule | undefined> {
    const db = await getDb();
    const doc = await db.collection("rules").findOne({ id });
    return doc ? clean<Rule>(doc) : undefined;
  }

  async createRule(rule: InsertRule & { workspaceId?: number }): Promise<Rule> {
    const db = await getDb();
    const id = await nextId(db, "rules");
    const doc: Rule = {
      id,
      workspaceId:        rule.workspaceId ?? null,
      label:              rule.label,
      triggerCondition:   rule.triggerCondition ?? "keyword",
      keyword:            rule.keyword ?? null,
      profileId:          rule.profileId ?? "all",
      selectedServers:    rule.selectedServers ?? [],
      selectedChannels:   rule.selectedChannels ?? [],
      allChannels:        rule.allChannels ?? false,
      actionType:         rule.actionType ?? "text",
      message:            rule.message,
      delayMode:          rule.delayMode ?? "instant",
      delayMs:            rule.delayMs ?? 0,
      isActive:           rule.isActive !== false,
      telegramEnabled:    rule.telegramEnabled ?? false,
      telegramToken:      rule.telegramToken ?? null,
      telegramChatId:     rule.telegramChatId ?? null,
      crossServerCheck:   rule.crossServerCheck ?? false,
      crossServerGuildId: rule.crossServerGuildId ?? null,
      deleteDelayMs:      rule.deleteDelayMs ?? 0,
      responseCount:      0,
      profileConfigs:     rule.profileConfigs ?? {},
      botMode:            rule.botMode ?? false,
      replyInThread:      rule.replyInThread ?? false,
      adminGuardEnabled:  rule.adminGuardEnabled ?? false,
      adminRoleId:        rule.adminRoleId ?? null,
    };
    await db.collection("rules").insertOne({ ...doc });
    return doc;
  }

  async updateRule(id: number, update: Partial<InsertRule>): Promise<Rule> {
    const db = await getDb();
    const { _id, ...safe } = update as any;
    await db.collection("rules").updateOne({ id }, { $set: safe });
    const doc = await db.collection("rules").findOne({ id });
    return clean<Rule>(doc);
  }

  async deleteRule(id: number): Promise<void> {
    const db = await getDb();
    await db.collection("rules").deleteOne({ id });
  }

  async incrementRuleResponseCount(id: number): Promise<void> {
    const db = await getDb();
    await db.collection("rules").updateOne({ id }, { $inc: { responseCount: 1 } });
  }

  // ── History ─────────────────────────────────────────────────────────────────

  async getHistory(workspaceId?: number): Promise<History[]> {
    const db = await getDb();
    const filter = workspaceId ? { workspaceId } : {};
    const docs = await db.collection("history")
      .find(filter).sort({ ts: -1 }).limit(100).toArray();
    return docs.map(d => clean<History>(d));
  }

  async createHistory(log: InsertHistory & { workspaceId?: number }): Promise<History> {
    const db = await getDb();
    const id = await nextId(db, "history");
    const doc: History = {
      id,
      workspaceId: log.workspaceId ?? null,
      accName:     log.accName,
      accId:       log.accId ?? null,
      srvName:     log.srvName,
      srvId:       log.srvId ?? null,
      chanName:    log.chanName,
      chanId:      log.chanId ?? null,
      target:      log.target,
      targetId:    log.targetId ?? null,
      msg:         log.msg,
      ruleId:      log.ruleId ?? null,
      ruleLabel:   log.ruleLabel ?? null,
      latencyMs:   log.latencyMs ?? null,
      ts:          new Date(),
    };
    await db.collection("history").insertOne({ ...doc });
    return doc;
  }

  async deleteOldHistory(olderThanMs: number): Promise<number> {
    const db = await getDb();
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await db.collection("history").deleteMany({ ts: { $lt: cutoff } });
    return result.deletedCount;
  }

  // ── Config ──────────────────────────────────────────────────────────────────

  async getConfig(): Promise<Record<string, string>> {
    const db = await getDb();
    const docs = await db.collection("config").find().toArray();
    return docs.reduce((acc, doc) => ({ ...acc, [doc.key]: doc.value }), {} as Record<string, string>);
  }

  async setConfig(key: string, value: string): Promise<void> {
    const db = await getDb();
    await db.collection("config").updateOne(
      { key },
      { $set: { key, value } },
      { upsert: true }
    );
  }

  // ── Licenses ────────────────────────────────────────────────────────────────

  private docToLicense(doc: any): License {
    const { _id, ...rest } = doc;
    return rest as License;
  }

  async getLicenses(): Promise<License[]> {
    const db = await getDb();
    const docs = await db.collection("licenses").find().sort({ createdAt: -1 }).toArray();
    return docs.map(d => this.docToLicense(d));
  }

  async getLicense(code: string): Promise<License | undefined> {
    const db = await getDb();
    const doc = await db.collection("licenses").findOne({ code });
    return doc ? this.docToLicense(doc) : undefined;
  }

  async getLicenseByFingerprint(fingerprint: string): Promise<License | undefined> {
    const db = await getDb();
    const doc = await db.collection("licenses").findOne({ fingerprint, isActive: true });
    return doc ? this.docToLicense(doc) : undefined;
  }

  async createLicense(code: string, label?: string): Promise<License> {
    const db = await getDb();
    const doc: License = {
      code,
      label:       label ?? null,
      fingerprint: null,
      activatedAt: null,
      createdAt:   new Date(),
      isActive:    true,
    };
    await db.collection("licenses").updateOne(
      { code },
      { $setOnInsert: doc },
      { upsert: true }
    );
    return doc;
  }

  async activateLicense(code: string, fingerprint: string): Promise<License> {
    const db = await getDb();
    await db.collection("licenses").updateOne(
      { code },
      { $set: { fingerprint, activatedAt: new Date() } }
    );
    const doc = await db.collection("licenses").findOne({ code });
    return this.docToLicense(doc);
  }

  async revokeLicense(code: string): Promise<void> {
    const db = await getDb();
    await db.collection("licenses").updateOne({ code }, { $set: { isActive: false } });
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  // ── Server Roster ────────────────────────────────────────────────────────────

  async upsertRosterEntry(entry: Omit<ServerRosterEntry, "joinedAt" | "lastSeen" | "status"> & { status?: ServerRosterEntry["status"] }): Promise<ServerRosterEntry> {
    const db = await getDb();
    const now = new Date();
    const filter = { guildId: entry.guildId, accountId: entry.accountId };
    const existing = await db.collection("server_roster").findOne(filter);
    if (existing) {
      await db.collection("server_roster").updateOne(filter, {
        $set: {
          guildName: entry.guildName,
          accountName: entry.accountName,
          workspaceId: entry.workspaceId,
          lastSeen: now,
          // Only restore to active if currently not kicked/banned
          ...(existing.status === "kicked" || existing.status === "banned"
            ? {}
            : { status: "active" }),
        },
      });
      const doc = await db.collection("server_roster").findOne(filter);
      const { _id, ...rest } = doc!;
      return rest as ServerRosterEntry;
    } else {
      const doc: ServerRosterEntry = {
        guildId: entry.guildId,
        guildName: entry.guildName,
        accountId: entry.accountId,
        accountName: entry.accountName,
        workspaceId: entry.workspaceId,
        joinedAt: now,
        lastSeen: now,
        status: entry.status ?? "active",
      };
      await db.collection("server_roster").insertOne({ ...doc });
      return doc;
    }
  }

  async updateRosterStatus(guildId: string, accountId: string, status: ServerRosterEntry["status"]): Promise<void> {
    const db = await getDb();
    await db.collection("server_roster").updateOne(
      { guildId, accountId },
      { $set: { status, lastSeen: new Date() } },
    );
  }

  async getServerQueue(guildId: string): Promise<ServerRosterEntry[]> {
    const db = await getDb();
    const docs = await db.collection("server_roster")
      .find({ guildId })
      .sort({ joinedAt: 1 })
      .toArray();
    return docs.map(({ _id, ...rest }) => rest as ServerRosterEntry);
  }

  async getNextActiveInQueue(guildId: string, excludeAccountId: string): Promise<ServerRosterEntry | undefined> {
    const db = await getDb();
    const doc = await db.collection("server_roster").findOne(
      { guildId, accountId: { $ne: excludeAccountId }, status: "active" },
      { sort: { joinedAt: 1 } },
    );
    if (!doc) return undefined;
    const { _id, ...rest } = doc;
    return rest as ServerRosterEntry;
  }

  async getRosterByAccount(accountId: string): Promise<ServerRosterEntry[]> {
    const db = await getDb();
    const docs = await db.collection("server_roster")
      .find({ accountId })
      .sort({ joinedAt: 1 })
      .toArray();
    return docs.map(({ _id, ...rest }) => rest as ServerRosterEntry);
  }

  async purgeOrphanedRosterEntries(): Promise<number> {
    const db = await getDb();
    const accountIds = await db.collection("accounts").distinct("id");
    const result = await db.collection("server_roster").deleteMany({
      accountId: { $nin: accountIds },
    });
    return result.deletedCount;
  }

  async getStats(workspaceId?: number) {
    const db = await getDb();
    const wsFilter = workspaceId ? { workspaceId } : {};
    const [activeRules, totalRules, totalLogs, connectedAccounts] = await Promise.all([
      db.collection("rules").countDocuments({ ...wsFilter, isActive: true }),
      db.collection("rules").countDocuments(wsFilter),
      db.collection("history").countDocuments(wsFilter),
      db.collection("accounts").countDocuments({ ...wsFilter, status: "Connected" }),
    ]);
    return { activeRules, totalRules, totalLogs, autoReplies: totalLogs, connectedAccounts };
  }
}

export const storage = new MongoStorage();
