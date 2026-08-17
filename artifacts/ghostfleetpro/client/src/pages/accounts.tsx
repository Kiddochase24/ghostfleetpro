import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import {
  User, KeyRound, Plus, Trash2, Shield, RefreshCw,
  Server, CheckCircle2, XCircle, Eye, EyeOff, Loader2, Radio
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";
import { apiRequest } from "@/lib/queryClient";

type Account = {
  id: string;
  name: string;
  status: string;
  avatar?: string;
  username?: string;
  discriminator?: string;
  guilds?: { id: string; name: string; icon: string | null }[];
  lastSeen?: string;
};

export default function Accounts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const accountsQuery = useQuery<Account[]>({
    queryKey: ["/api/accounts"],
    refetchInterval: 10000,
  });
  const accounts = accountsQuery.data ?? [];
  const { isLoading } = accountsQuery;

  const { data: gwStatus = [] } = useQuery<{ accountId: string; accountName: string; status: string }[]>({
    queryKey: ["/api/gateway/status"],
    refetchInterval: 4000,
  });

  const getGwStatus = (id: string) => gwStatus.find(g => g.accountId === id)?.status ?? "dead";

  const createMutation = useMutation({
    mutationFn: (data: { name: string; token: string }) =>
      apiRequest("POST", "/api/accounts", data).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      setName(""); setToken("");
      if (data.error) {
        toast({ title: "Link Failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Node Linked", description: `@${data.username} added with ${data.guilds?.length || 0} servers.` });
      }
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/accounts/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      toast({ title: "Node Severed" });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/accounts/${id}/refresh`).then(r => r.json()),
    onSuccess: (data, id) => {
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      if (data.error) {
        toast({ title: "Refresh Failed", description: data.error, variant: "destructive" });
      } else {
        toast({ title: "Servers Refreshed", description: `${data.guilds?.length} servers loaded.` });
      }
    },
  });

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !token.trim()) return;
    createMutation.mutate({ name: name.trim(), token: token.trim() });
  };

  const GuildIcon = ({ guild }: { guild: { id: string; name: string; icon: string | null } }) => {
    const iconUrl = guild.icon
      ? `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=32`
      : null;
    return (
      <div className="flex items-center gap-2 p-2 rounded-lg transition-colors duration-150"
        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
        {iconUrl ? (
          <img src={iconUrl} alt={guild.name} className="w-5 h-5 rounded-full flex-shrink-0" />
        ) : (
          <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-xs font-bold"
            style={{ background: "rgba(16,185,129,0.2)", color: "#34d399" }}>
            {guild.name[0]}
          </div>
        )}
        <span className="text-xs truncate" style={{ color: "rgba(255,255,255,0.6)" }}>{guild.name}</span>
      </div>
    );
  };

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight mb-1" style={{ color: "#f0fdf4" }}>ACCOUNT ACCESS</h1>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Link Discord accounts to the Ghost Fleet network</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Add Account Form */}
          <div className="lg:col-span-1">
            <div className="rounded-2xl p-6 sticky top-6"
              style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(16,185,129,0.15)" }}>
              <h3 className="font-display text-lg font-bold mb-5 flex items-center gap-2" style={{ color: "#f0fdf4" }}>
                <Plus className="w-5 h-5" style={{ color: "#10b981" }} />
                LINK NEW NODE
              </h3>
              <form onSubmit={handleAdd} className="space-y-4">
                <div>
                  <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>
                    Profile Label
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(16,185,129,0.5)" }} />
                    <input
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="E.g. AlphaBot-01"
                      className="w-full pl-10 pr-4 py-3 rounded-xl text-sm outline-none transition-all duration-200"
                      style={{
                        background: "rgba(0,0,0,0.5)",
                        border: "1px solid rgba(16,185,129,0.2)",
                        color: "#f0fdf4",
                        fontFamily: "var(--font-sans)"
                      }}
                      onFocus={e => e.target.style.borderColor = "rgba(16,185,129,0.6)"}
                      onBlur={e => e.target.style.borderColor = "rgba(16,185,129,0.2)"}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>
                    Discord Token
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(16,185,129,0.5)" }} />
                    <input
                      type={showToken ? "text" : "password"}
                      value={token}
                      onChange={e => setToken(e.target.value)}
                      placeholder="Paste user token..."
                      className="w-full pl-10 pr-10 py-3 rounded-xl text-sm outline-none transition-all duration-200 font-mono"
                      style={{
                        background: "rgba(0,0,0,0.5)",
                        border: "1px solid rgba(16,185,129,0.2)",
                        color: "#f0fdf4",
                      }}
                      onFocus={e => e.target.style.borderColor = "rgba(16,185,129,0.6)"}
                      onBlur={e => e.target.style.borderColor = "rgba(16,185,129,0.2)"}
                    />
                    <button
                      type="button"
                      onClick={() => setShowToken(!showToken)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: "rgba(255,255,255,0.3)" }}
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={createMutation.isPending || !name || !token}
                  className="w-full py-3 rounded-xl font-display tracking-wide text-sm font-semibold transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
                  style={{ background: "rgba(16,185,129,0.85)", color: "#000" }}
                >
                  {createMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 animate-spin" /> Connecting...</>
                  ) : (
                    <><Plus className="w-4 h-4" /> Initialize Link</>
                  )}
                </button>
              </form>

              <div className="mt-5 p-3 rounded-xl text-xs" style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.15)", color: "rgba(239,68,68,0.6)" }}>
                Only use user tokens you own. Ghost Fleet does not store tokens in plaintext after validation.
              </div>
            </div>
          </div>

          {/* Account List */}
          <div className="lg:col-span-2 space-y-3">
            {isLoading ? (
              <div className="flex items-center justify-center py-20" style={{ color: "rgba(16,185,129,0.4)" }}>
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading nodes...
              </div>
            ) : accountsQuery.error ? (
              <div className="rounded-2xl p-10 text-center" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <XCircle className="w-10 h-10 mx-auto mb-3" style={{ color: "#f87171" }} />
                <p className="font-display text-sm font-semibold mb-2" style={{ color: "#fca5a5" }}>Account API unavailable</p>
                <p className="text-xs break-words" style={{ color: "rgba(255,255,255,0.45)" }}>
                  {accountsQuery.error instanceof Error ? accountsQuery.error.message : "The VPS did not return account data."}
                </p>
                <button
                  type="button"
                  onClick={() => accountsQuery.refetch()}
                  className="mt-4 px-4 py-2 rounded-lg text-xs font-display"
                  style={{ background: "rgba(239,68,68,0.12)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.2)" }}
                >
                  Retry
                </button>
              </div>
            ) : accounts.length === 0 ? (
              <div className="rounded-2xl p-16 text-center" style={{ background: "rgba(0,0,0,0.3)", border: "1px dashed rgba(16,185,129,0.2)" }}>
                <Shield className="w-12 h-12 mx-auto mb-3" style={{ color: "rgba(16,185,129,0.2)" }} />
                <p style={{ color: "rgba(255,255,255,0.3)" }}>No accounts linked. Add your first Discord token above.</p>
              </div>
            ) : (
              accounts.map(acc => (
                <motion.div
                  key={acc.id}
                  layout
                  className="rounded-2xl overflow-hidden"
                  style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: `1px solid ${acc.status === "Connected" ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}` }}
                >
                  {/* Account Header */}
                  <div className="flex items-center gap-4 p-4 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === acc.id ? null : acc.id)}>
                    <div className="relative flex-shrink-0">
                      <div className="w-12 h-12 rounded-xl overflow-hidden"
                        style={{ border: "1px solid rgba(16,185,129,0.2)" }}>
                        {acc.avatar ? (
                          <img src={acc.avatar} alt="avatar" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ background: "rgba(16,185,129,0.1)" }}>
                            <User className="w-5 h-5" style={{ color: "#10b981" }} />
                          </div>
                        )}
                      </div>
                      <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border border-black ${acc.status === "Connected" ? "status-dot-online" : "bg-red-500"}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-display font-bold text-base" style={{ color: "#f0fdf4" }}>{acc.name}</div>
                      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.35)" }}>
                          @{acc.username}{acc.discriminator && acc.discriminator !== "0" ? `#${acc.discriminator}` : ""}
                        </span>
                        <span className="flex items-center gap-1 text-xs" style={{ color: acc.status === "Connected" ? "#10b981" : "#ef4444" }}>
                          {acc.status === "Connected" ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                          {acc.status}
                        </span>
                        {/* Gateway WS status badge */}
                        {(() => {
                          const gw = getGwStatus(acc.id);
                          const gwColor = gw === "ready" ? "#10b981" : gw === "connecting" ? "#f59e0b" : "#ef4444";
                          const gwLabel = gw === "ready" ? "WS LIVE" : gw === "connecting" ? "WS CONN…" : "WS DEAD";
                          return (
                            <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md font-display"
                              style={{ background: `${gwColor}18`, color: gwColor, border: `1px solid ${gwColor}40` }}>
                              <Radio className={`w-3 h-3 ${gw === "ready" ? "animate-pulse" : ""}`} />
                              {gwLabel}
                            </span>
                          );
                        })()}
                        {acc.guilds && (
                          <span className="flex items-center gap-1 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                            <Server className="w-3 h-3" /> {acc.guilds.length} servers
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={e => { e.stopPropagation(); refreshMutation.mutate(acc.id); }}
                        disabled={refreshMutation.isPending}
                        className="p-2 rounded-lg transition-colors duration-200"
                        style={{ color: "rgba(59,130,246,0.6)" }}
                        title="Refresh servers"
                      >
                        <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? "animate-spin" : ""}`} />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); if (confirm(`Disconnect ${acc.name}?`)) deleteMutation.mutate(acc.id); }}
                        className="p-2 rounded-lg transition-colors duration-200"
                        style={{ color: "rgba(239,68,68,0.5)" }}
                        title="Remove account"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Expanded Guilds */}
                  <AnimatePresence>
                    {expandedId === acc.id && acc.guilds && acc.guilds.length > 0 && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="overflow-hidden"
                      >
                        <div className="px-4 pb-4 pt-2 border-t" style={{ borderColor: "rgba(16,185,129,0.08)" }}>
                          <div className="text-xs font-display tracking-widest uppercase mb-3" style={{ color: "rgba(16,185,129,0.5)" }}>
                            Joined Servers ({acc.guilds.length})
                          </div>
                          <div className="grid grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
                            {acc.guilds.map(guild => <GuildIcon key={guild.id} guild={guild} />)}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
