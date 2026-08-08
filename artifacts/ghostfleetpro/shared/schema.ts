import { z } from "zod";

// ─── Domain interfaces ────────────────────────────────────────────────────────

export interface DiscordGuild {
  id: string;
  name: string;
  icon: string | null;
  owner: boolean;
  permissions: string;
}

export interface DiscordChannel {
  id: string;
  name: string;
  type: number;
  position: number;
}

export interface Workspace {
  id: number;
  name: string;
  password: string | null;
  createdAt: Date;
}

export interface Account {
  id: string;
  workspaceId: number | null;
  name: string;
  token: string;
  status: string;
  avatar: string | null;
  username: string | null;
  discriminator: string | null;
  guilds: DiscordGuild[];
  lastSeen: Date;
}

export interface Rule {
  id: number;
  workspaceId: number | null;
  label: string;
  triggerCondition: string;
  keyword: string | null;
  profileId: string;
  selectedServers: { id: string; name: string }[];
  selectedChannels: { id: string; name: string; serverId: string }[];
  allChannels: boolean;
  actionType: string;
  message: string;
  delayMode: string;
  delayMs: number;
  isActive: boolean;
  telegramEnabled: boolean;
  telegramToken: string | null;
  telegramChatId: string | null;
  crossServerCheck: boolean;
  crossServerGuildId: string | null;
  deleteDelayMs: number;
  responseCount: number;
  profileConfigs: Record<string, {
    selectedServers: { id: string; name: string }[];
    selectedChannels: { id: string; name: string; serverId: string }[];
    allChannels: boolean;
  }>;
  botMode: boolean;
  replyInThread: boolean;
  adminGuardEnabled: boolean;
  adminRoleId: string | null;
}

export interface History {
  id: number;
  workspaceId: number | null;
  accName: string;
  accId: string | null;
  srvName: string;
  srvId: string | null;
  chanName: string;
  chanId: string | null;
  target: string;
  targetId: string | null;
  msg: string;
  ruleId: number | null;
  ruleLabel: string | null;
  latencyMs: number | null;
  ts: Date;
}

export interface Config {
  key: string;
  value: string;
}

// ─── Insert types (omit auto-generated fields) ────────────────────────────────

export type InsertWorkspace = Omit<Workspace, "id" | "createdAt">;
export type InsertAccount   = Omit<Account,   "lastSeen" | "guilds">;
export type InsertRule      = Omit<Rule,       "id" | "responseCount">;
export type InsertHistory   = Omit<History,    "id" | "ts">;
export type InsertConfig    = Config;

// ─── Zod validation schemas ───────────────────────────────────────────────────

export const insertWorkspaceSchema = z.object({
  name:     z.string().min(2).max(32),
  password: z.string().nullable().optional(),
});

export const insertAccountSchema = z.object({
  id:            z.string(),
  workspaceId:   z.number().nullable().optional(),
  name:          z.string().min(1),
  token:         z.string().min(1),
  status:        z.string().default("Connected"),
  avatar:        z.string().nullable().optional(),
  username:      z.string().nullable().optional(),
  discriminator: z.string().nullable().optional(),
});

export const insertRuleSchema = z.object({
  workspaceId:       z.number().nullable().optional(),
  label:             z.string(),
  triggerCondition:  z.string().default("keyword"),
  keyword:           z.string().nullable().optional(),
  profileId:         z.string().default("all"),
  selectedServers:   z.array(z.any()).default([]),
  selectedChannels:  z.array(z.any()).default([]),
  allChannels:       z.boolean().default(false),
  actionType:        z.string().default("text"),
  message:           z.string(),
  delayMode:         z.string().default("instant"),
  delayMs:           z.number().default(0),
  isActive:          z.boolean().default(true),
  telegramEnabled:   z.boolean().default(false),
  telegramToken:     z.string().nullable().optional(),
  telegramChatId:    z.string().nullable().optional(),
  crossServerCheck:  z.boolean().default(false),
  crossServerGuildId:z.string().nullable().optional(),
  deleteDelayMs:     z.number().default(0),
  profileConfigs:    z.record(z.any()).default({}),
  botMode:           z.boolean().default(false),
  replyInThread:     z.boolean().default(false),
  adminGuardEnabled: z.boolean().default(false),
  adminRoleId:       z.string().nullable().optional(),
});

export const insertHistorySchema = z.object({
  workspaceId: z.number().nullable().optional(),
  accName:     z.string(),
  accId:       z.string().nullable().optional(),
  srvName:     z.string(),
  srvId:       z.string().nullable().optional(),
  chanName:    z.string(),
  chanId:      z.string().nullable().optional(),
  target:      z.string(),
  targetId:    z.string().nullable().optional(),
  msg:         z.string(),
  ruleId:      z.number().nullable().optional(),
  ruleLabel:   z.string().nullable().optional(),
  latencyMs:   z.number().nullable().optional(),
});
