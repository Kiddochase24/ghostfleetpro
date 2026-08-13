import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, Trash2, Edit2, Play, Pause, Server, Hash, ChevronRight,
  Zap, MessageSquare, Shield, Check, X,
  Send, Loader2, Bell, Eye, AlertTriangle, RefreshCw, Search
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { apiRequest, appUrl } from "@/lib/queryClient";

type Account = {
  id: string;
  name?: string | null;
  username?: string;
  avatar?: string;
  status?: string;
  guilds?: { id: string; name?: string | null; icon: string | null }[];
};
type Channel = { id: string; name: string; type: number };
type Rule = {
  id: number;
  label: string;
  triggerCondition: string;
  keyword?: string | null;
  profileId: string;
  selectedServers: { id: string; name: string }[];
  selectedChannels: { id: string; name: string; serverId: string }[];
  allChannels: boolean;
  actionType: string;
  message: string;
  delayMode: string;
  delayMs: number;
  deleteDelayMs: number;
  isActive: boolean | null;
  telegramEnabled: boolean | null;
  telegramToken?: string | null;
  telegramChatId?: string | null;
  crossServerCheck: boolean | null;
  crossServerGuildId?: string | null;
  responseCount: number;
  botMode?: boolean | null;
  replyInThread?: boolean | null;
  adminGuardEnabled?: boolean | null;
  adminRoleId?: string | null;
};

const DELAY_PRESETS = [
  { label: "Instant", value: "instant", ms: 0 },
  { label: "0.06s (Ultra)", value: "60", ms: 60 },
  { label: "0.1s (Fast)", value: "100", ms: 100 },
  { label: "0.5s", value: "500", ms: 500 },
  { label: "1s", value: "1000", ms: 1000 },
  { label: "3s", value: "3000", ms: 3000 },
  { label: "5s", value: "5000", ms: 5000 },
  { label: "Custom", value: "custom", ms: 0 },
];

const STEP_TRIGGER = 1;
const STEP_PROFILE = 2;
const STEP_SERVERS = 3;
const STEP_CHANNELS = 4;
const STEP_MESSAGE = 5;
const STEP_ADVANCED = 6;

type ProfileCfg = { selectedServers: {id:string;name:string}[]; selectedChannels: {id:string;name:string;serverId:string}[]; allChannels: boolean };

const accountLabel = (account: Account) =>
  account.name?.trim() || account.username?.trim() || account.id || "Unnamed account";

const guildLabel = (guild: { id: string; name?: string | null }) =>
  guild.name?.trim() || guild.id || "Unnamed server";

const BLANK_FORM = {
  label: "", triggerCondition: "keyword", keyword: "",
  profileId: "all", selectedServers: [] as {id:string;name:string}[],
  selectedChannels: [] as {id:string;name:string;serverId:string}[],
  allChannels: false, actionType: "text", message: "",
  delayMode: "instant", delayMs: 0, deleteDelayMs: 0, isActive: true,
  telegramEnabled: false, telegramToken: "", telegramChatId: "",
  crossServerCheck: false, crossServerGuildId: "",
  profileConfigs: {} as Record<string, ProfileCfg>,
  botMode: false,
  replyInThread: false,
  adminGuardEnabled: false, adminRoleId: "",
};

export default function Rules() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showWizard, setShowWizard] = useState(false);
  const [step, setStep] = useState(STEP_TRIGGER);
  const [form, setForm] = useState({ ...BLANK_FORM });
  const [editId, setEditId] = useState<number | null>(null);
  const [selectedGuildForChannels, setSelectedGuildForChannels] = useState<string | null>(null);
  const [loadingChannels, setLoadingChannels] = useState<Record<string, boolean>>({});
  const [availableChannels, setAvailableChannels] = useState<Record<string, Channel[]>>({});
  const [serverSearch, setServerSearch] = useState("");
  const [loadingGuilds, setLoadingGuilds] = useState(false);
  const serverItemRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const { data: rules = [], isLoading } = useQuery<Rule[]>({ queryKey: ["/api/rules"], refetchInterval: 10000 });
  const { data: rawAccounts = [] } = useQuery<Account[]>({ queryKey: ["/api/accounts"] });
  const accounts = Array.isArray(rawAccounts) ? rawAccounts : [];

  const createMutation = useMutation({
    mutationFn: (data: any) => apiRequest("POST", "/api/rules", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      setShowWizard(false);
      setStep(STEP_TRIGGER);
      setForm({ ...BLANK_FORM });
      toast({ title: "Rule Deployed", description: `Protocol "${form.label}" is now active.` });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: any) => apiRequest("PUT", `/api/rules/${id}`, data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      setShowWizard(false);
      setEditId(null);
      toast({ title: "Rule Updated" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/rules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rules"] }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PUT", `/api/rules/${id}`, { isActive }).then(r => r.json()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/rules"] }),
  });

  const testMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/rules/${id}/test`).then(r => r.json()),
    onSuccess: (data: any, id) => {
      if (data.success) {
        toast({ title: "Test Sent", description: data.message });
      } else {
        toast({ title: "Test Failed", description: data.message, variant: "destructive" });
      }
    },
    onError: () => toast({ title: "Test failed", variant: "destructive" }),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/accounts/${id}`),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Account Removed", description: "Account disconnected and removed." });
    },
    onError: () => toast({ title: "Failed to remove account", variant: "destructive" }),
  });

  const selectedAccount = accounts.find(a => a.id === form.profileId);
  const guilds = Array.isArray(selectedAccount?.guilds) ? selectedAccount.guilds : [];

  // Combined unique guild list across all accounts (for fleet mode server picker)
  const fleetGuilds = (() => {
    const seen = new Set<string>();
    const result: { id: string; name: string; icon: string | null }[] = [];
    for (const acc of accounts) {
      for (const g of (Array.isArray(acc.guilds) ? acc.guilds : [])) {
        if (!seen.has(g.id)) { seen.add(g.id); result.push({ ...g, name: guildLabel(g) }); }
      }
    }
    return result;
  })();

  const loadChannels = async (accountId: string, guildId: string, force = false) => {
    // Skip if already loaded with results; allow retry if previously returned empty (failed load)
    if (!force && Array.isArray(availableChannels[guildId]) && availableChannels[guildId].length > 0) return;
    setLoadingChannels(prev => ({ ...prev, [guildId]: true }));
    try {
      const res = await fetch(appUrl(`/api/accounts/${accountId}/guilds/${guildId}/channels`));
      const data = await res.json();
      const channels: Channel[] = Array.isArray(data) ? data : [];
      setAvailableChannels(prev => ({ ...prev, [guildId]: channels }));
      if (!Array.isArray(data)) {
        toast({ title: "Could not load channels", description: (data as any)?.error || "Permission denied or unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to load channels", variant: "destructive" });
    }
    setLoadingChannels(prev => ({ ...prev, [guildId]: false }));
  };

  const toggleServer = (guild: { id: string; name: string }) => {
    const existing = form.selectedServers.find(s => s.id === guild.id);
    if (existing) {
      setForm(f => ({
        ...f,
        selectedServers: f.selectedServers.filter(s => s.id !== guild.id),
        selectedChannels: f.selectedChannels.filter(c => c.serverId !== guild.id),
      }));
    } else {
      setForm(f => ({ ...f, selectedServers: [...f.selectedServers, { id: guild.id, name: guildLabel(guild) }] }));
      if (form.profileId !== "all") {
        loadChannels(form.profileId, guild.id);
      }
    }
  };

  const toggleChannel = (channel: Channel, serverId: string, serverName: string) => {
    const existing = form.selectedChannels.find(c => c.id === channel.id && c.serverId === serverId);
    if (existing) {
      setForm(f => ({ ...f, selectedChannels: f.selectedChannels.filter(c => !(c.id === channel.id && c.serverId === serverId)) }));
    } else {
      setForm(f => ({ ...f, selectedChannels: [...f.selectedChannels, { id: channel.id, name: channel.name, serverId }] }));
    }
  };

  // ── Fleet-wide per-profile helpers ──────────────────────────────────────────
  const getFleetCfg = (accountId: string): ProfileCfg =>
    form.profileConfigs?.[accountId] || { selectedServers: [], selectedChannels: [], allChannels: false };

  const setFleetCfg = (accountId: string, updater: (prev: ProfileCfg) => ProfileCfg) => {
    setForm(f => ({
      ...f,
      profileConfigs: { ...f.profileConfigs, [accountId]: updater(f.profileConfigs[accountId] || { selectedServers: [], selectedChannels: [], allChannels: false }) },
    }));
  };

  const toggleFleetServer = (accountId: string, guild: { id: string; name: string }) => {
    const cfg = getFleetCfg(accountId);
    const exists = cfg.selectedServers.some(s => s.id === guild.id);
    if (exists) {
      setFleetCfg(accountId, c => ({
        ...c,
        selectedServers: c.selectedServers.filter(s => s.id !== guild.id),
        selectedChannels: c.selectedChannels.filter(ch => ch.serverId !== guild.id),
      }));
    } else {
      loadChannels(accountId, guild.id);
      setFleetCfg(accountId, c => ({ ...c, selectedServers: [...c.selectedServers, { id: guild.id, name: guildLabel(guild) }] }));
    }
  };

  const toggleFleetAllChannels = (accountId: string) => {
    setFleetCfg(accountId, cfg => ({ ...cfg, allChannels: !cfg.allChannels }));
  };

  const toggleFleetChannel = (accountId: string, channel: Channel, serverId: string) => {
    setFleetCfg(accountId, cfg => {
      const exists = cfg.selectedChannels.some(c => c.id === channel.id && c.serverId === serverId);
      if (exists) return { ...cfg, selectedChannels: cfg.selectedChannels.filter(c => !(c.id === channel.id && c.serverId === serverId)) };
      return { ...cfg, selectedChannels: [...cfg.selectedChannels, { id: channel.id, name: channel.name, serverId }] };
    });
  };

  const openWizard = (rule?: Rule) => {
    if (rule) {
      setEditId(rule.id);
      setForm({
        label: rule.label,
        triggerCondition: rule.triggerCondition,
        keyword: rule.keyword || "",
        profileId: rule.profileId,
        selectedServers: rule.selectedServers || [],
        selectedChannels: rule.selectedChannels || [],
        allChannels: rule.allChannels || false,
        actionType: rule.actionType,
        message: rule.message,
        delayMode: rule.delayMode,
        delayMs: rule.delayMs,
        deleteDelayMs: rule.deleteDelayMs ?? 0,
        isActive: rule.isActive !== false,
        telegramEnabled: rule.telegramEnabled || false,
        telegramToken: rule.telegramToken || "",
        telegramChatId: rule.telegramChatId || "",
        crossServerCheck: rule.crossServerCheck || false,
        crossServerGuildId: rule.crossServerGuildId || "",
        profileConfigs: ((rule as any).profileConfigs as Record<string, ProfileCfg>) || {},
        botMode: rule.botMode || false,
        replyInThread: rule.replyInThread || false,
        adminGuardEnabled: rule.adminGuardEnabled || false,
        adminRoleId: rule.adminRoleId || "",
      });
    } else {
      setEditId(null);
      setForm({ ...BLANK_FORM });
    }
    setStep(STEP_TRIGGER);
    setShowWizard(true);
  };

  // Auto-fetch guild lists when Step 3 is entered.
  // This is the fix for "step 3 goes blank when editing" — when editing an existing
  // rule the accounts query may have stale/empty guild data. We hit the refresh
  // endpoint for any account that has no guilds so the server picker always populates.
  useEffect(() => {
    if (step !== STEP_SERVERS) return;
    const accountsNeedingGuilds = form.profileId === "all"
      ? accounts.filter(acc => !((acc as any).guilds?.length))
      : accounts.filter(acc => acc.id === form.profileId && !((acc as any).guilds?.length));

    if (accountsNeedingGuilds.length === 0) return;
    setLoadingGuilds(true);
    Promise.all(
      accountsNeedingGuilds.map(acc =>
        fetch(appUrl(`/api/accounts/${acc.id}/refresh`), { method: "POST" }).catch(() => null)
      )
    ).then(() => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setLoadingGuilds(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Auto-load channels when Step 4 is entered — covers both fleet and single-profile modes.
  // This is especially important when editing an existing rule: servers are already selected
  // but channels have never been fetched for this wizard session.
  useEffect(() => {
    if (step !== STEP_CHANNELS) return;
    if (form.profileId === "all") {
      // Fleet mode — load channels for every account's selected servers
      accounts.forEach(acc => {
        const cfg = getFleetCfg(acc.id);
        cfg.selectedServers.forEach(srv => {
          loadChannels(acc.id, srv.id);
        });
      });
    } else {
      // Single-profile mode — load channels for the chosen account's selected servers
      form.selectedServers.forEach(srv => {
        loadChannels(form.profileId, srv.id);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, form.profileId]);

  // Clear server search when leaving step 3
  useEffect(() => {
    if (step !== STEP_SERVERS) setServerSearch("");
  }, [step]);

  // Scroll to matching servers when search changes in Step 3
  useEffect(() => {
    if (step !== STEP_SERVERS) return;
    const q = serverSearch.toLowerCase().trim();
    if (!q) return;

    if (form.profileId === "all") {
      // Fleet mode: scroll the first match in each account's list
      accounts.forEach(acc => {
        const accGuilds: any[] = Array.isArray(acc.guilds) ? acc.guilds : [];
        const firstMatch = accGuilds.find(g => guildLabel(g).toLowerCase().includes(q));
        if (firstMatch) {
          const el = serverItemRefs.current[`${acc.id}:${firstMatch.id}`];
          if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
      });
    } else {
      // Single profile mode
      const firstMatch = guilds.find(g => guildLabel(g).toLowerCase().includes(q));
      if (firstMatch) {
        const el = serverItemRefs.current[`single:${firstMatch.id}`];
        if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSearch]);

  const handleSubmit = () => {
    if (!form.label.trim()) {
      setStep(STEP_TRIGGER);
      toast({ title: "Rule name required", description: "Please enter a name for this rule.", variant: "destructive" });
      return;
    }
    if (!form.message.trim()) {
      setStep(STEP_MESSAGE);
      toast({ title: "Message required", description: "Please enter the automated message to send.", variant: "destructive" });
      return;
    }
    const payload = {
      ...form,
      delayMs: form.delayMode === "custom" ? form.delayMs : (DELAY_PRESETS.find(d => d.value === form.delayMode)?.ms || 0),
    };
    if (editId) {
      updateMutation.mutate({ id: editId, ...payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const GlassStep = ({ active, done, num, label }: any) => (
    <div className="flex items-center gap-2">
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${done ? "bg-green-500" : active ? "bg-emerald-500" : ""}`}
        style={!done && !active ? { background: "rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" } : { color: "#000" }}>
        {done ? <Check className="w-3.5 h-3.5" /> : num}
      </div>
      <span className="text-xs font-display hidden sm:block" style={{ color: active ? "#34d399" : done ? "rgba(16,185,129,0.6)" : "rgba(255,255,255,0.2)" }}>{label}</span>
    </div>
  );

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-7xl mx-auto">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight mb-1" style={{ color: "#f0fdf4" }}>RULE MANAGER</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
              {rules.length} protocol{rules.length !== 1 ? "s" : ""} configured &middot; {rules.filter(r => r.isActive).length} active
            </p>
          </div>
          <button
            onClick={() => openWizard()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-display tracking-wide text-sm font-semibold transition-all duration-200"
            style={{ background: "rgba(16,185,129,0.85)", color: "#000", boxShadow: "0 0 20px rgba(16,185,129,0.3)" }}
          >
            <Plus className="w-4 h-4" /> NEW RULE
          </button>
        </div>

        {/* Rules Grid */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20" style={{ color: "rgba(16,185,129,0.4)" }}>
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading protocols...
          </div>
        ) : rules.length === 0 ? (
          <div className="rounded-2xl p-16 text-center" style={{ background: "rgba(0,0,0,0.3)", border: "1px dashed rgba(16,185,129,0.2)" }}>
            <Shield className="w-12 h-12 mx-auto mb-3" style={{ color: "rgba(16,185,129,0.2)" }} />
            <p className="mb-4" style={{ color: "rgba(255,255,255,0.3)" }}>No rules configured. Create your first automation protocol.</p>
            <button onClick={() => openWizard()} className="px-6 py-2.5 rounded-xl font-display text-sm font-semibold"
              style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.3)" }}>
              + Create First Rule
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {rules.map(rule => (
              <motion.div key={rule.id} layout className="rounded-2xl overflow-hidden relative"
                style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: `1px solid ${rule.isActive ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.07)"}` }}>
                {/* Active indicator bar */}
                <div className="absolute top-0 left-0 right-0 h-0.5"
                  style={{ background: rule.isActive ? "linear-gradient(to right, transparent, #10b981, transparent)" : "transparent" }} />

                <div className="p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <h3 className="font-display font-bold text-sm truncate" style={{ color: "#f0fdf4" }}>{rule.label}</h3>
                      <span className="text-xs px-1.5 py-0.5 rounded font-mono flex-shrink-0" style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
                        {rule.triggerCondition}
                      </span>
                    </div>
                    <button
                      onClick={() => toggleMutation.mutate({ id: rule.id, isActive: !rule.isActive })}
                      disabled={toggleMutation.isPending}
                      className="ml-2 p-1 rounded-lg transition-colors flex-shrink-0 disabled:opacity-40"
                      style={{ background: rule.isActive ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)" }}
                      title={rule.isActive ? "Pause rule" : "Resume rule"}
                    >
                      {rule.isActive ? (
                        <Pause className="w-3.5 h-3.5" style={{ color: "#10b981" }} />
                      ) : (
                        <Play className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.3)" }} />
                      )}
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                    <div className="flex items-center gap-3">
                      <span className="flex items-center gap-1">
                        <Server className="w-3 h-3" />
                        {(rule.selectedServers || []).length === 0 ? "All" : (rule.selectedServers || []).length}
                      </span>
                      <span className="flex items-center gap-1">
                        <Hash className="w-3 h-3" />
                        {rule.allChannels ? "All" : (rule.selectedChannels || []).length}
                      </span>
                      <span className="flex items-center gap-1">
                        <Zap className="w-3 h-3" />
                        {DELAY_PRESETS.find(d => d.value === rule.delayMode)?.label || rule.delayMs + "ms"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span style={{ color: "rgba(255,255,255,0.18)" }}>{rule.responseCount || 0}</span>
                      {rule.telegramEnabled && <Bell className="w-3 h-3" style={{ color: "#3b82f6" }} />}
                      {rule.crossServerCheck && <Eye className="w-3 h-3" style={{ color: "#f59e0b" }} />}
                      {(rule.deleteDelayMs ?? 0) > 0 && <Trash2 className="w-3 h-3" style={{ color: "rgba(239,68,68,0.5)" }} />}
                      {rule.botMode && <span className="text-xs font-bold px-1.5 py-0.5 rounded" style={{ background: "rgba(6,182,212,0.15)", color: "#06b6d4", border: "1px solid rgba(6,182,212,0.3)" }}>BOT</span>}
                      {rule.replyInThread && <MessageSquare className="w-3 h-3" style={{ color: "#8b5cf6" }} />}
                      {rule.adminGuardEnabled && <Shield className="w-3 h-3" style={{ color: "#ef4444" }} />}
                    </div>
                  </div>
                </div>

                <div className="flex border-t" style={{ borderColor: "rgba(255,255,255,0.06)" }}>
                  <button onClick={() => openWizard(rule)}
                    className="flex-1 py-3 text-xs font-display tracking-wide flex items-center justify-center gap-1.5 transition-colors"
                    style={{ color: "rgba(16,185,129,0.7)" }}>
                    <Edit2 className="w-3.5 h-3.5" /> Edit
                  </button>
                  <div style={{ width: "1px", background: "rgba(255,255,255,0.06)" }} />
                  <button
                    onClick={() => testMutation.mutate(rule.id)}
                    disabled={testMutation.isPending}
                    className="flex-1 py-3 text-xs font-display tracking-wide flex items-center justify-center gap-1.5 transition-colors disabled:opacity-40"
                    style={{ color: "rgba(59,130,246,0.8)" }}>
                    {testMutation.isPending && testMutation.variables === rule.id
                      ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      : <Send className="w-3.5 h-3.5" />}
                    Test
                  </button>
                  <div style={{ width: "1px", background: "rgba(255,255,255,0.06)" }} />
                  <button onClick={() => { if (confirm("Delete this rule?")) deleteMutation.mutate(rule.id); }}
                    className="flex-1 py-3 text-xs font-display tracking-wide flex items-center justify-center gap-1.5 transition-colors"
                    style={{ color: "rgba(239,68,68,0.6)" }}>
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Rule Creation Wizard Modal */}
      <AnimatePresence>
        {showWizard && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: "rgba(0,0,0,0.8)", backdropFilter: "blur(8px)" }}
            onClick={e => e.target === e.currentTarget && setShowWizard(false)}
          >
            <motion.div
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl"
              style={{ background: "rgba(5,15,10,0.95)", border: "1px solid rgba(16,185,129,0.2)", boxShadow: "0 0 60px rgba(16,185,129,0.1)" }}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between p-6 border-b" style={{ borderColor: "rgba(16,185,129,0.1)" }}>
                <h2 className="font-display text-xl font-bold" style={{ color: "#f0fdf4" }}>
                  {editId ? "EDIT RULE" : "NEW RULE"} — STEP {step}/6
                </h2>
                <button onClick={() => setShowWizard(false)} style={{ color: "rgba(255,255,255,0.3)" }}>
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Progress Steps */}
              <div className="flex items-center gap-2 px-6 py-4 overflow-x-auto" style={{ borderBottom: "1px solid rgba(16,185,129,0.08)" }}>
                {[
                  [STEP_TRIGGER, "Trigger"],
                  [STEP_PROFILE, "Profile"],
                  [STEP_SERVERS, "Servers"],
                  [STEP_CHANNELS, "Channels"],
                  [STEP_MESSAGE, "Message"],
                  [STEP_ADVANCED, "Advanced"],
                ].map(([s, label], i, arr) => (
                  <div key={s} className="flex items-center gap-2">
                    <GlassStep num={s} label={label} active={step === s} done={step > (s as number)} />
                    {i < arr.length - 1 && (
                      <div className="w-6 h-px" style={{ background: "rgba(255,255,255,0.1)" }} />
                    )}
                  </div>
                ))}
              </div>

              <div className="p-6 space-y-5">
                {/* STEP 1: Trigger */}
                {step === STEP_TRIGGER && (
                  <div className="space-y-5">
                    <div>
                      <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>Rule Name / Label</label>
                      <input value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))}
                        placeholder="E.g. Crypto Help Responder"
                        className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                        style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }} />
                    </div>
                    <div>
                      <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>Trigger Condition</label>
                      <div className="grid grid-cols-2 gap-3">
                        {[["keyword", "Keyword Match", "Triggers when message contains a specific keyword"],
                          ["any", "Any Message", "Triggers on any message in the selected channels"]].map(([val, label, desc]) => (
                          <button key={val} onClick={() => setForm(f => ({ ...f, triggerCondition: val }))}
                            className="p-4 rounded-xl text-left transition-all duration-200"
                            style={{ background: form.triggerCondition === val ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.3)", border: `1px solid ${form.triggerCondition === val ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.06)"}` }}>
                            <div className="text-sm font-display font-semibold mb-1" style={{ color: form.triggerCondition === val ? "#34d399" : "#f0fdf4" }}>{label}</div>
                            <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{desc}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                    {form.triggerCondition === "keyword" && (
                      <div>
                        <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>Keyword / Phrase</label>
                        <input value={form.keyword} onChange={e => setForm(f => ({ ...f, keyword: e.target.value }))}
                          placeholder="E.g. help, support, price"
                          className="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono"
                          style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }} />
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 2: Profile — shows all saved accounts with ability to delete invalid ones */}
                {step === STEP_PROFILE && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.6)" }}>
                        Select Profile / Account
                      </label>
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                        {accounts.length} account{accounts.length !== 1 ? "s" : ""} linked
                      </span>
                    </div>

                    {/* Fleet-wide option */}
                    <button
                      onClick={() => {
                        // Only reset server/channel selections when actually switching profile.
                        // Re-clicking the already-selected profile must NOT wipe saved selections.
                        if (form.profileId !== "all") {
                          setForm(f => ({ ...f, profileId: "all", selectedServers: [], selectedChannels: [] }));
                        }
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                      style={{ background: form.profileId === "all" ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.3)", border: `1px solid ${form.profileId === "all" ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.05)"}` }}
                    >
                      <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center"
                        style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                        <Shield className="w-4 h-4" style={{ color: "#34d399" }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-display" style={{ color: form.profileId === "all" ? "#34d399" : "#f0fdf4" }}>All Profiles (Fleet-wide)</div>
                        <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Rule applies across all linked accounts</div>
                      </div>
                      {form.profileId === "all" && <Check className="w-4 h-4 flex-shrink-0" style={{ color: "#10b981" }} />}
                    </button>

                    {/* Divider */}
                    {accounts.length > 0 && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                        <span className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.2)" }}>Or pick specific account</span>
                        <div className="flex-1 h-px" style={{ background: "rgba(255,255,255,0.06)" }} />
                      </div>
                    )}

                    {/* Per-account list with remove buttons */}
                    <div className="space-y-2 max-h-72 overflow-y-auto">
                      {accounts.length === 0 ? (
                        <div className="p-4 rounded-xl text-sm text-center" style={{ background: "rgba(0,0,0,0.2)", border: "1px dashed rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.3)" }}>
                          No accounts linked yet. Go to Account Access to add a Discord token.
                        </div>
                      ) : accounts.map(acc => {
                        const isSelected = form.profileId === acc.id;
                        const isDisconnected = acc.status === "Disconnected";
                        return (
                          <div key={acc.id}
                            className="flex items-center gap-2 rounded-xl overflow-hidden"
                            style={{ border: `1px solid ${isSelected ? "rgba(16,185,129,0.3)" : isDisconnected ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.05)"}`, background: isSelected ? "rgba(16,185,129,0.08)" : "rgba(0,0,0,0.25)" }}
                          >
                            {/* Select area */}
                            <button
                              className="flex items-center gap-3 flex-1 p-3 text-left"
                              onClick={() => {
                                // Only wipe server/channel state when switching to a DIFFERENT account.
                                // Clicking the already-selected account must preserve saved selections.
                                if (form.profileId !== acc.id) {
                                  setForm(f => ({ ...f, profileId: acc.id, selectedServers: [], selectedChannels: [] }));
                                }
                              }}
                            >
                              <div className="relative flex-shrink-0">
                                <div className="w-8 h-8 rounded-lg overflow-hidden"
                                  style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
                                  {acc.avatar
                                    ? <img src={acc.avatar} alt="" className="w-full h-full object-cover" />
                                  : <div className="w-full h-full flex items-center justify-center text-xs font-bold" style={{ background: "rgba(16,185,129,0.1)", color: "#34d399" }}>{accountLabel(acc)[0]}</div>}
                                </div>
                                <div className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-black ${isDisconnected ? "bg-red-500" : "status-dot-online"}`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="text-sm font-display flex items-center gap-2" style={{ color: isSelected ? "#34d399" : "#f0fdf4" }}>
                                   {accountLabel(acc)}
                                  {isDisconnected && (
                                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
                                      Disconnected
                                    </span>
                                  )}
                                </div>
                                 <div className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
                                   @{acc.username || accountLabel(acc)} · {(Array.isArray(acc.guilds) ? acc.guilds : []).length} servers
                                </div>
                              </div>
                              {isSelected && <Check className="w-4 h-4 flex-shrink-0" style={{ color: "#10b981" }} />}
                            </button>

                            {/* Delete button — remove invalid/unwanted accounts */}
                            <button
                              onClick={() => {
                                 if (confirm(`Remove account "${accountLabel(acc)}"? This will also disconnect it from all rules using it.`)) {
                                  deleteAccountMutation.mutate(acc.id);
                                  if (form.profileId === acc.id) setForm(f => ({ ...f, profileId: "all" }));
                                }
                              }}
                              className="px-3 py-3 flex-shrink-0 transition-colors duration-150 border-l"
                              style={{ borderColor: "rgba(255,255,255,0.05)", color: isDisconnected ? "rgba(239,68,68,0.6)" : "rgba(239,68,68,0.3)" }}
                              title="Remove this account"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })}
                    </div>

                    {accounts.some(a => a.status === "Disconnected") && (
                      <div className="flex items-start gap-2 p-3 rounded-xl text-xs"
                        style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", color: "rgba(239,68,68,0.7)" }}>
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                        <span>Some accounts are disconnected. Remove them or refresh their token in Account Access before using them in a rule.</span>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 3: Servers */}
                {step === STEP_SERVERS && (
                  <div className="space-y-3">
                    {/* Loading indicator — shown while auto-refreshing guild lists for accounts
                        that have no guild data cached (common when editing existing rules). */}
                               {loadingGuilds && (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.2)", color: "rgba(16,185,129,0.7)" }}>
                        <Loader2 className="w-3 h-3 animate-spin flex-shrink-0" />
                        Fetching server list…
                      </div>
                    )}
                    {/* Search bar */}
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none" style={{ color: "rgba(16,185,129,0.5)" }} />
                      <input
                        value={serverSearch}
                        onChange={e => setServerSearch(e.target.value)}
                        placeholder="Search server name to locate in profiles..."
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
                        style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }}
                        onFocus={e => e.target.style.borderColor = "rgba(16,185,129,0.5)"}
                        onBlur={e => e.target.style.borderColor = "rgba(16,185,129,0.2)"}
                      />
                      {serverSearch && (
                        <button onClick={() => setServerSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }}>
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {form.profileId === "all" ? (
                      // Fleet mode — per-account server selection. Ticked = active, unticked = silent.
                      <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                        <p className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                          Select servers per account. Unticked servers stay silent for that account.
                        </p>
                        {accounts.length === 0 ? (
                          <div className="p-4 rounded-xl text-sm text-center" style={{ background: "rgba(0,0,0,0.3)", border: "1px dashed rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
                            No accounts linked.
                          </div>
                        ) : accounts.map(acc => {
                          const cfg = getFleetCfg(acc.id);
                           const accGuilds = Array.isArray(acc.guilds) ? acc.guilds : [];
                          const sq = serverSearch.toLowerCase().trim();
                           const hasMatch = sq ? accGuilds.some((g: any) => guildLabel(g).toLowerCase().includes(sq)) : false;
                          return (
                            <div key={acc.id} className="rounded-xl overflow-hidden transition-all"
                              style={{ border: `1px solid ${hasMatch && sq ? "rgba(16,185,129,0.4)" : "rgba(16,185,129,0.15)"}`, background: "rgba(0,0,0,0.2)" }}>
                              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: hasMatch && sq ? "rgba(16,185,129,0.07)" : "rgba(16,185,129,0.04)" }}>
                                 {acc.avatar
                                   ? <img src={acc.avatar} className="w-5 h-5 rounded-full" alt="" />
                                   : <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "rgba(16,185,129,0.2)", color: "#34d399" }}>{accountLabel(acc)[0]}</div>}
                                 <span className="text-xs font-display tracking-wider" style={{ color: "#34d399" }}>{accountLabel(acc)}</span>
                                {hasMatch && sq && (
                                  <span className="text-xs ml-1 px-1.5 py-0.5 rounded" style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>found</span>
                                )}
                                <span className="text-xs ml-auto" style={{ color: cfg.selectedServers.length > 0 ? "rgba(16,185,129,0.6)" : "rgba(255,255,255,0.2)" }}>
                                  {cfg.selectedServers.length > 0 ? `${cfg.selectedServers.length} active` : "silent"}
                                </span>
                              </div>
                              {accGuilds.length === 0 ? (
                                <div className="p-3 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>No servers found. Refresh token in Account Access.</div>
                              ) : (
                                <div className="grid grid-cols-1 gap-1 p-2 max-h-48 overflow-y-auto">
                                  {accGuilds.map((guild: any) => {
                                    const isSel = cfg.selectedServers.some((s: any) => s.id === guild.id);
                                   const name = guildLabel(guild);
                                   const isMatch = sq ? name.toLowerCase().includes(sq) : false;
                                   const iconUrl = guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=32` : null;
                                    return (
                                      <button
                                        key={guild.id}
                                        ref={el => { serverItemRefs.current[`${acc.id}:${guild.id}`] = el; }}
                                        onClick={() => toggleFleetServer(acc.id, guild)}
                                        className="flex items-center gap-2 p-2 rounded-lg text-left transition-all"
                                        style={{
                                          background: isMatch && sq ? "rgba(16,185,129,0.12)" : isSel ? "rgba(16,185,129,0.08)" : "rgba(0,0,0,0.15)",
                                          border: `1px solid ${isMatch && sq ? "rgba(16,185,129,0.5)" : isSel ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.04)"}`,
                                        }}>
                                         {iconUrl ? <img src={iconUrl} alt={name} className="w-6 h-6 rounded-full flex-shrink-0" />
                                           : <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold" style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>{name[0]}</div>}
                                         <span className="flex-1 text-xs truncate" style={{ color: isMatch && sq ? "#34d399" : isSel ? "#34d399" : "rgba(255,255,255,0.7)" }}>{name}</span>
                                        <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                                          style={{ background: isSel ? "#10b981" : "rgba(255,255,255,0.05)", border: isSel ? "none" : "1px solid rgba(255,255,255,0.1)" }}>
                                          {isSel && <Check className="w-2.5 h-2.5 text-black" />}
                                        </div>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : guilds.length === 0 ? (
                      <div>
                        <label className="text-xs font-display tracking-widest uppercase mb-3 block" style={{ color: "rgba(16,185,129,0.6)" }}>Select Target Servers</label>
                        <div className="p-4 rounded-xl text-sm text-center" style={{ background: "rgba(0,0,0,0.3)", border: "1px dashed rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.3)" }}>
                          No servers found. Go to Account Access and click Refresh on your account.
                        </div>
                      </div>
                    ) : (
                      <div>
                        <label className="text-xs font-display tracking-widest uppercase mb-3 block" style={{ color: "rgba(16,185,129,0.6)" }}>
                          Select Target Servers ({form.selectedServers.length} selected)
                        </label>
                        <div className="grid grid-cols-1 gap-2 max-h-80 overflow-y-auto">
                          {guilds.map((guild: any) => {
                            const isSelected = form.selectedServers.some(s => s.id === guild.id);
                            const sq = serverSearch.toLowerCase().trim();
                             const name = guildLabel(guild);
                             const isMatch = sq ? name.toLowerCase().includes(sq) : false;
                            const iconUrl = guild.icon ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=32` : null;
                            return (
                              <button
                                key={guild.id}
                                ref={el => { serverItemRefs.current[`single:${guild.id}`] = el; }}
                                onClick={() => toggleServer(guild)}
                                className="flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                                style={{
                                  background: isMatch && sq ? "rgba(16,185,129,0.12)" : isSelected ? "rgba(16,185,129,0.08)" : "rgba(0,0,0,0.2)",
                                  border: `1px solid ${isMatch && sq ? "rgba(16,185,129,0.5)" : isSelected ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.05)"}`,
                                }}>
                                {iconUrl ? (
                                   <img src={iconUrl} alt={name} className="w-8 h-8 rounded-full flex-shrink-0" />
                                ) : (
                                  <div className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-sm font-bold"
                                    style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>
                                     {name[0]}
                                  </div>
                                )}
                                 <span className="flex-1 text-sm" style={{ color: isMatch && sq ? "#34d399" : isSelected ? "#34d399" : "#f0fdf4" }}>{name}</span>
                                <div className={`w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0`}
                                  style={{ background: isSelected ? "#10b981" : "rgba(255,255,255,0.05)", border: isSelected ? "none" : "1px solid rgba(255,255,255,0.1)" }}>
                                  {isSelected && <Check className="w-3 h-3 text-black" />}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* STEP 4: Channels */}
                {step === STEP_CHANNELS && (
                  <div className="space-y-4">
                    {form.profileId === "all" ? (
                      // Fleet-wide mode — per-account channel config
                      <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
                        {accounts.map(acc => {
                          const cfg = getFleetCfg(acc.id);
                          return (
                            <div key={acc.id} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(16,185,129,0.15)", background: "rgba(0,0,0,0.2)" }}>
                              <div className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(16,185,129,0.04)" }}>
                                {acc.avatar
                                  ? <img src={acc.avatar} className="w-5 h-5 rounded-full" alt="" />
                                  : <div className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "rgba(16,185,129,0.2)", color: "#34d399" }}>{accountLabel(acc)[0]}</div>}
                                <span className="text-xs font-display tracking-wider" style={{ color: "#34d399" }}>{accountLabel(acc)}</span>
                              </div>
                              <div className="p-2 space-y-2">
                                {/* All-channels toggle per account */}
                                <button onClick={() => toggleFleetAllChannels(acc.id)}
                                  className="flex items-center gap-2 p-2 rounded-lg w-full transition-all"
                                  style={{ background: cfg.allChannels ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.25)", border: `1px solid ${cfg.allChannels ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)"}` }}>
                                  <div className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                                    style={{ background: cfg.allChannels ? "#10b981" : "rgba(255,255,255,0.05)", border: cfg.allChannels ? "none" : "1px solid rgba(255,255,255,0.15)" }}>
                                    {cfg.allChannels && <Check className="w-2.5 h-2.5 text-black" />}
                                  </div>
                                  <span className="text-xs font-display" style={{ color: cfg.allChannels ? "#34d399" : "rgba(255,255,255,0.6)" }}>All channels on selected servers</span>
                                </button>

                                {/* Per-server channel picker */}
                                {!cfg.allChannels && cfg.selectedServers.length === 0 && (
                                  <div className="text-xs px-2 py-1.5" style={{ color: "rgba(255,255,255,0.25)" }}>Select servers in the previous step first.</div>
                                )}
                                {!cfg.allChannels && cfg.selectedServers.map(server => (
                                  <div key={server.id}>
                                    <div className="flex items-center gap-1.5 mb-1 px-1">
                                      <Server className="w-3 h-3" style={{ color: "rgba(16,185,129,0.5)" }} />
                                      <span className="text-xs font-display" style={{ color: "rgba(16,185,129,0.5)" }}>{server.name}</span>
                                    </div>
                                    {loadingChannels[server.id] ? (
                                      <div className="flex items-center gap-2 py-1 px-1 text-xs" style={{ color: "rgba(16,185,129,0.4)" }}>
                                        <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                                      </div>
                                    ) : !Array.isArray(availableChannels[server.id]) ? (
                                      <button onClick={() => loadChannels(acc.id, server.id, true)}
                                        className="text-xs px-2 py-1 rounded-lg" style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
                                        Load Channels
                                      </button>
                                    ) : (
                                      <div className="grid grid-cols-2 gap-1 max-h-36 overflow-y-auto">
                                        {availableChannels[server.id].map(ch => {
                                          const isSel = cfg.selectedChannels.some(c => c.id === ch.id && c.serverId === server.id);
                                          return (
                                            <button key={ch.id} onClick={() => toggleFleetChannel(acc.id, ch, server.id)}
                                              className="flex items-center gap-1.5 p-1.5 rounded text-left transition-all"
                                              style={{ background: isSel ? "rgba(16,185,129,0.08)" : "rgba(0,0,0,0.2)", border: `1px solid ${isSel ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.04)"}` }}>
                                              <Hash className="w-2.5 h-2.5 flex-shrink-0" style={{ color: isSel ? "#34d399" : "rgba(255,255,255,0.3)" }} />
                                              <span className="text-xs truncate flex-1" style={{ color: isSel ? "#34d399" : "rgba(255,255,255,0.5)" }}>{ch.name}</span>
                                              {isSel && <Check className="w-2.5 h-2.5 flex-shrink-0" style={{ color: "#10b981" }} />}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      // Single-profile mode — original UI
                      <>
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => setForm(f => ({ ...f, allChannels: !f.allChannels }))}
                            className="flex items-center gap-3 p-3 rounded-xl flex-1 transition-all"
                            style={{ background: form.allChannels ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.3)", border: `1px solid ${form.allChannels ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.06)"}` }}>
                            <div className={`w-5 h-5 rounded-md flex items-center justify-center`}
                              style={{ background: form.allChannels ? "#10b981" : "rgba(255,255,255,0.05)", border: form.allChannels ? "none" : "1px solid rgba(255,255,255,0.15)" }}>
                              {form.allChannels && <Check className="w-3 h-3 text-black" />}
                            </div>
                            <span className="text-sm font-display" style={{ color: form.allChannels ? "#34d399" : "#f0fdf4" }}>React in ALL channels</span>
                          </button>
                        </div>

                        {!form.allChannels && form.selectedServers.map(server => (
                          <div key={server.id}>
                            <div className="flex items-center gap-2 mb-2">
                              <Server className="w-3.5 h-3.5" style={{ color: "rgba(16,185,129,0.6)" }} />
                              <span className="text-xs font-display tracking-wider uppercase" style={{ color: "rgba(16,185,129,0.6)" }}>{server.name}</span>
                            </div>
                            {loadingChannels[server.id] ? (
                              <div className="flex items-center gap-2 py-2" style={{ color: "rgba(16,185,129,0.4)" }}>
                                <Loader2 className="w-4 h-4 animate-spin" /> Loading channels...
                              </div>
                            ) : !Array.isArray(availableChannels[server.id]) ? (
                              <button onClick={() => loadChannels(form.profileId, server.id, true)}
                                className="text-xs px-3 py-1.5 rounded-lg" style={{ background: "rgba(16,185,129,0.1)", color: "#34d399", border: "1px solid rgba(16,185,129,0.2)" }}>
                                Load Channels
                              </button>
                            ) : (
                              <div className="grid grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                                {availableChannels[server.id].map(ch => {
                                  const isSelected = form.selectedChannels.some(c => c.id === ch.id && c.serverId === server.id);
                                  return (
                                    <button key={ch.id} onClick={() => toggleChannel(ch, server.id, server.name)}
                                      className="flex items-center gap-2 p-2 rounded-lg text-left transition-all"
                                      style={{ background: isSelected ? "rgba(16,185,129,0.08)" : "rgba(0,0,0,0.2)", border: `1px solid ${isSelected ? "rgba(16,185,129,0.25)" : "rgba(255,255,255,0.04)"}` }}>
                                      <Hash className="w-3 h-3 flex-shrink-0" style={{ color: isSelected ? "#34d399" : "rgba(255,255,255,0.3)" }} />
                                      <span className="text-xs truncate flex-1" style={{ color: isSelected ? "#34d399" : "rgba(255,255,255,0.5)" }}>{ch.name}</span>
                                      {isSelected && <Check className="w-3 h-3 flex-shrink-0" style={{ color: "#10b981" }} />}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                )}

                {/* STEP 5: Message */}
                {step === STEP_MESSAGE && (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>Reply Speed</label>
                      <div className="grid grid-cols-4 gap-2">
                        {DELAY_PRESETS.filter(d => d.value !== "custom").map(preset => (
                          <button key={preset.value} onClick={() => setForm(f => ({ ...f, delayMode: preset.value }))}
                            className="p-2.5 rounded-xl text-center transition-all"
                            style={{ background: form.delayMode === preset.value ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.3)", border: `1px solid ${form.delayMode === preset.value ? "rgba(16,185,129,0.4)" : "rgba(255,255,255,0.05)"}` }}>
                            <div className="text-xs font-display" style={{ color: form.delayMode === preset.value ? "#34d399" : "rgba(255,255,255,0.5)" }}>{preset.label}</div>
                          </button>
                        ))}
                      </div>
                      <button onClick={() => setForm(f => ({ ...f, delayMode: "custom" }))}
                        className="mt-2 w-full p-2.5 rounded-xl text-center transition-all"
                        style={{ background: form.delayMode === "custom" ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.2)", border: `1px solid ${form.delayMode === "custom" ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.04)"}` }}>
                        <span className="text-xs font-display" style={{ color: form.delayMode === "custom" ? "#34d399" : "rgba(255,255,255,0.4)" }}>Custom (ms)</span>
                      </button>
                      {form.delayMode === "custom" && (
                        <input type="number" min="0" value={form.delayMs}
                          onChange={e => setForm(f => ({ ...f, delayMs: parseInt(e.target.value) || 0 }))}
                          className="mt-2 w-full px-4 py-3 rounded-xl text-sm outline-none font-mono"
                          style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }}
                          placeholder="Delay in milliseconds" />
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>Response Type</label>
                      <div className="grid grid-cols-2 gap-3">
                        {[["text", "Plain Text"], ["embed", "Rich Embed"]].map(([val, label]) => (
                          <button key={val} onClick={() => setForm(f => ({ ...f, actionType: val }))}
                            className="p-3 rounded-xl transition-all"
                            style={{ background: form.actionType === val ? "rgba(16,185,129,0.1)" : "rgba(0,0,0,0.3)", border: `1px solid ${form.actionType === val ? "rgba(16,185,129,0.3)" : "rgba(255,255,255,0.05)"}` }}>
                            <span className="text-sm font-display" style={{ color: form.actionType === val ? "#34d399" : "#f0fdf4" }}>{label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>Auto-Reply Message</label>
                      <textarea
                        value={form.message}
                        onChange={e => setForm(f => ({ ...f, message: e.target.value }))}
                        rows={5}
                        placeholder="Enter your automated response here..."
                        className="w-full px-4 py-3 rounded-xl text-sm outline-none resize-none"
                        style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4", fontFamily: "var(--font-sans)" }}
                      />
                    </div>

                    {/* Delete Delay */}
                    <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.15)" }}>
                      <div className="flex items-center gap-2 mb-3">
                        <Trash2 className="w-4 h-4" style={{ color: "rgba(239,68,68,0.7)" }} />
                        <label className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(239,68,68,0.7)" }}>
                          Auto-Delete Sent Message After
                        </label>
                      </div>
                      <div className="grid grid-cols-4 gap-2 mb-2">
                        {[
                          { label: "Never", ms: 0 },
                          { label: "5s", ms: 5000 },
                          { label: "10s", ms: 10000 },
                          { label: "30s", ms: 30000 },
                          { label: "1m", ms: 60000 },
                          { label: "2m", ms: 120000 },
                          { label: "5m", ms: 300000 },
                          { label: "Custom", ms: -1 },
                        ].map(preset => (
                          <button
                            key={preset.ms}
                            onClick={() => {
                              if (preset.ms === -1) return;
                              setForm(f => ({ ...f, deleteDelayMs: preset.ms }));
                            }}
                            className={`p-2 rounded-xl text-center transition-all ${preset.ms === -1 && form.deleteDelayMs > 0 && ![5000,10000,30000,60000,120000,300000].includes(form.deleteDelayMs) ? "border" : ""}`}
                            style={{
                              background: (preset.ms === form.deleteDelayMs || (preset.ms === -1 && form.deleteDelayMs > 0 && ![5000,10000,30000,60000,120000,300000].includes(form.deleteDelayMs)))
                                ? "rgba(239,68,68,0.12)"
                                : "rgba(0,0,0,0.3)",
                              border: `1px solid ${(preset.ms === form.deleteDelayMs || (preset.ms === -1 && form.deleteDelayMs > 0 && ![5000,10000,30000,60000,120000,300000].includes(form.deleteDelayMs)))
                                ? "rgba(239,68,68,0.4)"
                                : "rgba(255,255,255,0.05)"}`,
                            }}
                          >
                            <div className="text-xs font-display" style={{ color: (preset.ms === form.deleteDelayMs || (preset.ms === -1 && form.deleteDelayMs > 0 && ![5000,10000,30000,60000,120000,300000].includes(form.deleteDelayMs))) ? "#f87171" : "rgba(255,255,255,0.4)" }}>
                              {preset.label}
                            </div>
                          </button>
                        ))}
                      </div>
                      <input
                        type="number"
                        min="0"
                        value={form.deleteDelayMs}
                        onChange={e => setForm(f => ({ ...f, deleteDelayMs: parseInt(e.target.value) || 0 }))}
                        className="w-full px-4 py-2.5 rounded-xl text-sm outline-none font-mono"
                        style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(239,68,68,0.15)", color: "#f0fdf4" }}
                        placeholder="Custom delete delay in ms (0 = never delete)"
                      />
                      {form.deleteDelayMs > 0 && (
                        <p className="mt-2 text-xs" style={{ color: "rgba(239,68,68,0.5)" }}>
                          Bot's reply will be deleted {form.deleteDelayMs >= 60000
                            ? `${Math.round(form.deleteDelayMs / 60000)}m`
                            : `${Math.round(form.deleteDelayMs / 1000)}s`} after sending.
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* STEP 6: Advanced */}
                {step === STEP_ADVANCED && (
                  <div className="space-y-5">
                    {/* Telegram */}
                    <div className="p-4 rounded-xl" style={{ background: "rgba(59,130,246,0.05)", border: "1px solid rgba(59,130,246,0.15)" }}>
                      <div className="flex items-center gap-3 mb-4">
                        <Bell className="w-4 h-4" style={{ color: "#3b82f6" }} />
                        <span className="font-display text-sm font-semibold" style={{ color: "#f0fdf4" }}>Telegram Notifications</span>
                        <button onClick={() => setForm(f => ({ ...f, telegramEnabled: !f.telegramEnabled }))}
                          className="ml-auto relative w-11 h-6 rounded-full transition-all"
                          style={{ background: form.telegramEnabled ? "#3b82f6" : "rgba(255,255,255,0.1)" }}>
                          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-200"
                            style={{ left: form.telegramEnabled ? "calc(100% - 1.25rem - 2px)" : "2px" }} />
                        </button>
                      </div>
                      {form.telegramEnabled && (
                        <div className="space-y-3">
                          <input value={form.telegramToken} onChange={e => setForm(f => ({ ...f, telegramToken: e.target.value }))}
                            placeholder="Telegram Bot Token"
                            className="w-full px-4 py-2.5 rounded-lg text-sm outline-none font-mono"
                            style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(59,130,246,0.2)", color: "#f0fdf4" }} />
                          <input value={form.telegramChatId} onChange={e => setForm(f => ({ ...f, telegramChatId: e.target.value }))}
                            placeholder="Chat ID"
                            className="w-full px-4 py-2.5 rounded-lg text-sm outline-none font-mono"
                            style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(59,130,246,0.2)", color: "#f0fdf4" }} />
                        </div>
                      )}
                    </div>

                    {/* Cross-server check */}
                    <div className="p-4 rounded-xl" style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.15)" }}>
                      <div className="flex items-center gap-3 mb-4">
                        <Eye className="w-4 h-4" style={{ color: "#f59e0b" }} />
                        <span className="font-display text-sm font-semibold" style={{ color: "#f0fdf4" }}>Cross-Server Join Check</span>
                        <button onClick={() => setForm(f => ({ ...f, crossServerCheck: !f.crossServerCheck }))}
                          className="ml-auto relative w-11 h-6 rounded-full transition-all"
                          style={{ background: form.crossServerCheck ? "#f59e0b" : "rgba(255,255,255,0.1)" }}>
                          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-200"
                            style={{ left: form.crossServerCheck ? "calc(100% - 1.25rem - 2px)" : "2px" }} />
                        </button>
                      </div>
                      {form.crossServerCheck && (
                        <div className="space-y-2">
                          <p className="text-xs" style={{ color: "rgba(245,158,11,0.6)" }}>
                            After replying, check if the target user joins a specific server within 1 minute. If they do, log the event.
                          </p>
                          <input value={form.crossServerGuildId} onChange={e => setForm(f => ({ ...f, crossServerGuildId: e.target.value }))}
                            placeholder="Target Server ID to monitor"
                            className="w-full px-4 py-2.5 rounded-lg text-sm outline-none font-mono"
                            style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(245,158,11,0.2)", color: "#f0fdf4" }} />
                        </div>
                      )}
                    </div>

                    {/* Bot Mode */}
                    <div className="p-4 rounded-xl" style={{ background: "rgba(6,182,212,0.05)", border: "1px solid rgba(6,182,212,0.2)" }}>
                      <div className="flex items-center gap-3">
                        <span className="text-base">🤖</span>
                        <div className="flex-1">
                          <p className="text-sm font-semibold font-display" style={{ color: "#f0fdf4" }}>Bot Mode</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgba(6,182,212,0.7)" }}>
                            ON — sends the full ANSI priority-notification prefix. OFF — simply tags the user with @mention.
                          </p>
                        </div>
                        <button data-testid="toggle-bot-mode"
                          onClick={() => setForm(f => ({ ...f, botMode: !f.botMode }))}
                          className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
                          style={{ background: form.botMode ? "#06b6d4" : "rgba(255,255,255,0.1)" }}>
                          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-200"
                            style={{ left: form.botMode ? "calc(100% - 1.25rem - 2px)" : "2px" }} />
                        </button>
                      </div>
                    </div>

                    {/* Reply in Thread */}
                    <div className="p-4 rounded-xl" style={{ background: "rgba(139,92,246,0.05)", border: "1px solid rgba(139,92,246,0.2)" }}>
                      <div className="flex items-center gap-3">
                        <MessageSquare className="w-4 h-4" style={{ color: "#8b5cf6" }} />
                        <div className="flex-1">
                          <p className="text-sm font-semibold font-display" style={{ color: "#f0fdf4" }}>Reply in Thread</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgba(139,92,246,0.7)" }}>
                            Creates a dedicated thread from the triggering message, then replies inside it. Requires "Create Public Threads" permission.
                          </p>
                        </div>
                        <button data-testid="toggle-reply-in-thread"
                          onClick={() => setForm(f => ({ ...f, replyInThread: !f.replyInThread }))}
                          className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
                          style={{ background: form.replyInThread ? "#8b5cf6" : "rgba(255,255,255,0.1)" }}>
                          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-200"
                            style={{ left: form.replyInThread ? "calc(100% - 1.25rem - 2px)" : "2px" }} />
                        </button>
                      </div>
                    </div>

                    {/* Admin Guard */}
                    <div className="p-4 rounded-xl" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
                      <div className="flex items-center gap-3 mb-3">
                        <Shield className="w-4 h-4" style={{ color: "#ef4444" }} />
                        <div className="flex-1">
                          <p className="text-sm font-semibold font-display" style={{ color: "#f0fdf4" }}>Admin Guard</p>
                          <p className="text-xs mt-0.5" style={{ color: "rgba(239,68,68,0.7)" }}>
                            Pauses this rule when any member with the specified role is actively online. Resumes automatically when they go offline.
                          </p>
                        </div>
                        <button data-testid="toggle-admin-guard"
                          onClick={() => setForm(f => ({ ...f, adminGuardEnabled: !f.adminGuardEnabled }))}
                          className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
                          style={{ background: form.adminGuardEnabled ? "#ef4444" : "rgba(255,255,255,0.1)" }}>
                          <div className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all duration-200"
                            style={{ left: form.adminGuardEnabled ? "calc(100% - 1.25rem - 2px)" : "2px" }} />
                        </button>
                      </div>
                      {form.adminGuardEnabled && (
                        <div className="space-y-2">
                          <p className="text-xs" style={{ color: "rgba(239,68,68,0.6)" }}>
                            Paste the Role ID of the admin/moderator role to watch. Right-click a role in Discord → Copy Role ID.
                          </p>
                          <input
                            data-testid="input-admin-role-id"
                            value={form.adminRoleId}
                            onChange={e => setForm(f => ({ ...f, adminRoleId: e.target.value }))}
                            placeholder="Role ID (e.g. 1234567890123456789)"
                            className="w-full px-4 py-2.5 rounded-lg text-sm outline-none font-mono"
                            style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(239,68,68,0.25)", color: "#f0fdf4" }} />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Navigation */}
              <div className="flex justify-between p-6 border-t" style={{ borderColor: "rgba(16,185,129,0.1)" }}>
                <button
                  onClick={() => step > STEP_TRIGGER ? setStep(s => s - 1) : setShowWizard(false)}
                  className="px-5 py-2.5 rounded-xl text-sm font-display tracking-wide"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.08)" }}>
                  {step === STEP_TRIGGER ? "Cancel" : "Back"}
                </button>
                {step < STEP_ADVANCED ? (
                  <button
                    onClick={() => setStep(s => s + 1)}
                    disabled={step === STEP_TRIGGER && !form.label}
                    className="px-5 py-2.5 rounded-xl text-sm font-display tracking-wide flex items-center gap-2 disabled:opacity-40"
                    style={{ background: "rgba(16,185,129,0.85)", color: "#000" }}>
                    Next <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleSubmit}
                    disabled={createMutation.isPending || updateMutation.isPending}
                    className="px-5 py-2.5 rounded-xl text-sm font-display tracking-wide flex items-center gap-2 disabled:opacity-40"
                    style={{ background: "rgba(16,185,129,0.85)", color: "#000" }}>
                    {createMutation.isPending || updateMutation.isPending ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Deploying...</>
                    ) : (
                      <><Send className="w-4 h-4" /> {editId ? "Update Rule" : "Deploy Rule"}</>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </AppLayout>
  );
}
