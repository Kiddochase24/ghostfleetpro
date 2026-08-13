import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Shield, Key, Plus, Trash2, Copy, Check, RefreshCw, Lock, LogOut,
  Loader2, Tag, Server, Users, ArrowRight, RotateCcw, XCircle, Ban,
  CheckCircle2, CircleDot,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface License {
  code: string;
  label: string | null;
  fingerprint: string | null;
  activatedAt: string | null;
  createdAt: string;
  isActive: boolean;
}

interface RosterEntry {
  accountId: string;
  accountName: string;
  workspaceId: number | null;
  joinedAt: string;
  status: "active" | "queued" | "kicked" | "banned" | "left";
  primaryRequested?: boolean;
  health?: {
    accountStatus: string;
    gatewayReady: boolean;
    inServer: boolean;
    tokenValid: boolean | null;
    tokenCheckedAt: string | null;
    healthy: boolean;
    reason: string;
  };
}

interface ServerSummary {
  guildId: string;
  guildName: string;
  total: number;
  active: number;
  ruleCount: number;
  entries: RosterEntry[];
}

const STORAGE_KEY = "gf_admin_key";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function timeAgo(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  const hrs = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d ago`;
  if (hrs > 0) return `${hrs}h ago`;
  if (mins > 0) return `${mins}m ago`;
  return "just now";
}

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string; label: string }> = {
  active: { color: "#34d399", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.2)", label: "Active" },
  queued: { color: "#60a5fa", bg: "rgba(96,165,250,0.1)", border: "rgba(96,165,250,0.2)", label: "Queued" },
  kicked: { color: "#fbbf24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.2)", label: "Kicked" },
  banned: { color: "#ef4444", bg: "rgba(239,68,68,0.1)", border: "rgba(239,68,68,0.2)", label: "Banned" },
  left:   { color: "rgba(255,255,255,0.3)", bg: "rgba(255,255,255,0.04)", border: "rgba(255,255,255,0.08)", label: "Left" },
};

// ─── License Row ─────────────────────────────────────────────────────────────

function LicenseRow({ lic, adminKey, onRevoke, onCopy }: {
  lic: License;
  adminKey: string;
  onRevoke: (code: string) => void;
  onCopy: (text: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState(false);

  const copy = () => { onCopy(lic.code); setCopied(true); setTimeout(() => setCopied(false), 1500); };

  const revoke = async () => {
    if (!confirm(`Revoke license ${lic.code}?`)) return;
    setRevoking(true);
    await fetch(`/api/admin/licenses/${lic.code}`, {
      method: "DELETE",
      headers: { "x-admin-key": adminKey },
    });
    onRevoke(lic.code);
  };

  const bound = !!lic.fingerprint;

  return (
    <motion.div layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }}
      className="rounded-xl px-4 py-3 flex items-center gap-4"
      style={{ background: "rgba(0,0,0,0.3)", border: `1px solid ${lic.isActive ? "rgba(16,185,129,0.12)" : "rgba(239,68,68,0.12)"}` }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-sm font-bold tracking-widest" style={{ color: lic.isActive ? "#34d399" : "#ef4444" }}>{lic.code}</span>
          {lic.label && (
            <span className="text-xs px-2 py-0.5 rounded-full font-display"
              style={{ background: "rgba(16,185,129,0.1)", color: "rgba(16,185,129,0.7)", border: "1px solid rgba(16,185,129,0.15)" }}>
              {lic.label}
            </span>
          )}
          <span className="text-xs px-2 py-0.5 rounded-full font-display" style={{
            background: bound ? "rgba(59,130,246,0.1)" : "rgba(16,185,129,0.06)",
            color: bound ? "rgba(96,165,250,0.8)" : "rgba(16,185,129,0.5)",
            border: `1px solid ${bound ? "rgba(59,130,246,0.15)" : "rgba(16,185,129,0.1)"}`,
          }}>
            {bound ? "Bound" : "Unbound"}
          </span>
        </div>
        <div className="flex items-center gap-3 text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          <span>Created {formatDate(lic.createdAt)}</span>
          {lic.activatedAt && <span>Activated {formatDate(lic.activatedAt)}</span>}
          {lic.fingerprint && <span className="font-mono truncate max-w-32" title={lic.fingerprint}>FP: {lic.fingerprint.slice(0, 12)}…</span>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button onClick={copy} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)" }} title="Copy">
          {copied ? <Check className="w-3.5 h-3.5" style={{ color: "#34d399" }} /> : <Copy className="w-3.5 h-3.5" style={{ color: "rgba(16,185,129,0.6)" }} />}
        </button>
        <button onClick={revoke} disabled={revoking} className="w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-50"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)" }} title="Revoke">
          {revoking ? <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "#ef4444" }} /> : <Trash2 className="w-3.5 h-3.5" style={{ color: "rgba(239,68,68,0.7)" }} />}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Roster Server Card ───────────────────────────────────────────────────────

function HealthCheck({ label, ok, pending = false }: { label: string; ok: boolean; pending?: boolean }) {
  const color = pending ? "#fbbf24" : ok ? "#34d399" : "#f87171";
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-display"
      style={{ color }} title={`${label}: ${pending ? "checking" : ok ? "pass" : "fail"}`}>
      {pending ? <Loader2 className="w-3 h-3 animate-spin" /> : ok ? <CheckCircle2 className="w-3 h-3" /> : <CircleDot className="w-3 h-3" />}
      {label}
    </span>
  );
}

function RosterCard({
  server,
  adminKey,
  onPrimary,
}: {
  server: ServerSummary;
  adminKey: string;
  onPrimary: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [promotingId, setPromotingId] = useState<string | null>(null);
  const coverage = server.total > 0 ? Math.round((server.active / server.total) * 100) : 0;

  return (
    <motion.div layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl overflow-hidden"
      style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(16,185,129,0.1)" }}>
      {/* Header row */}
      <button onClick={() => setExpanded(e => !e)} className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-white/[0.02] transition-all">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)" }}>
          <Server className="w-4 h-4" style={{ color: "#10b981" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-display font-bold truncate" style={{ color: "#f0fdf4" }}>{server.guildName}</span>
            {server.ruleCount > 0 && (
              <span className="text-xs px-1.5 py-0.5 rounded font-display shrink-0"
                style={{ background: "rgba(96,165,250,0.1)", color: "rgba(96,165,250,0.8)", border: "1px solid rgba(96,165,250,0.2)" }}>
                {server.ruleCount} rule{server.ruleCount !== 1 ? "s" : ""}
              </span>
            )}
            <span className="text-xs font-mono shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>{server.guildId}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
              <Users className="w-3 h-3 inline mr-1" />{server.active}/{server.total} active
            </span>
            {/* Coverage bar */}
            <div className="flex-1 max-w-24 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div className="h-full rounded-full transition-all" style={{
                width: `${coverage}%`,
                background: coverage === 100 ? "#34d399" : coverage > 50 ? "#fbbf24" : "#ef4444",
              }} />
            </div>
            <span className="text-xs" style={{ color: coverage === 100 ? "#34d399" : coverage > 50 ? "#fbbf24" : "#ef4444" }}>
              {coverage}%
            </span>
          </div>
        </div>
        <ArrowRight className="w-4 h-4 flex-shrink-0 transition-transform" style={{
          color: "rgba(16,185,129,0.4)",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        }} />
      </button>

      {/* Expanded queue */}
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            style={{ overflow: "hidden" }}>
            <div className="px-4 pb-3 space-y-1.5 border-t" style={{ borderColor: "rgba(16,185,129,0.08)" }}>
              <div className="flex items-center gap-2 pt-3 pb-1">
                <RotateCcw className="w-3 h-3" style={{ color: "rgba(16,185,129,0.4)" }} />
                <span className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.4)" }}>
                  Rotation Queue — ordered by rule-activation time (global)
                </span>
              </div>
               {server.entries.length === 0 ? (
                <div className="flex items-center gap-2 px-3 py-3 rounded-lg"
                  style={{ background: "rgba(239,68,68,0.04)", border: "1px solid rgba(239,68,68,0.1)" }}>
                  <XCircle className="w-4 h-4 flex-shrink-0" style={{ color: "rgba(239,68,68,0.5)" }} />
                  <span className="text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
                    No accounts tracked — none of your linked accounts have been seen in this server yet.
                    Accounts will appear here once they connect to Discord and their guild list is refreshed.
                  </span>
                </div>
               ) : server.entries.map((entry, idx) => {
                const st = STATUS_STYLE[entry.status] || STATUS_STYLE.left;
                 const isPrimary = entry.status === "active";
                 const health = entry.health;
                 const canPromote = entry.status === "queued" && health?.healthy === true;
                return (
                  <div key={entry.accountId} className="flex items-center gap-3 px-3 py-2 rounded-lg"
                    style={{ background: isPrimary ? "rgba(16,185,129,0.05)" : "rgba(0,0,0,0.2)", border: `1px solid ${isPrimary ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.04)"}` }}>
                    {/* Position badge */}
                    <div className="w-5 h-5 rounded-md flex items-center justify-center flex-shrink-0 text-xs font-mono font-bold"
                       style={{ background: isPrimary ? "rgba(16,185,129,0.15)" : "rgba(255,255,255,0.05)", color: isPrimary ? "#34d399" : "rgba(255,255,255,0.3)" }}>
                      {idx + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-display font-semibold truncate" style={{ color: "#f0fdf4" }}>{entry.accountName}</span>
                        {isPrimary && (
                          <span className="text-xs px-1.5 py-0.5 rounded font-display"
                            style={{ background: "rgba(16,185,129,0.15)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}>
                            PRIMARY
                          </span>
                        )}
                         {entry.primaryRequested && !isPrimary && (
                           <span className="text-[10px] px-1.5 py-0.5 rounded font-display"
                             style={{ background: "rgba(251,191,36,0.1)", color: "#fbbf24", border: "1px solid rgba(251,191,36,0.2)" }}>
                             PREFERRED
                           </span>
                         )}
                        {entry.workspaceId && (
                          <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.2)" }}>ws#{entry.workspaceId}</span>
                        )}
                      </div>
                       <div className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>
                        Joined {timeAgo(entry.joinedAt)} · {new Date(entry.joinedAt).toLocaleDateString()}
                      </div>
                       <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                         <HealthCheck label="Account" ok={health?.accountStatus === "Connected"} pending={!health} />
                         <HealthCheck label="Gateway" ok={health?.gatewayReady === true} pending={!health} />
                         <HealthCheck label="Server" ok={health?.inServer === true} pending={!health} />
                         <HealthCheck label="Token" ok={health?.tokenValid === true} pending={!health || health.tokenValid === null} />
                         {health && !health.healthy && (
                           <span className="text-[10px] truncate max-w-44" style={{ color: "#f87171" }} title={health.reason}>
                             {health.reason}
                           </span>
                         )}
                       </div>
                    </div>
                    {/* Status */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {entry.status === "kicked" && <XCircle className="w-3.5 h-3.5" style={{ color: "#fbbf24" }} />}
                      {entry.status === "banned" && <Ban className="w-3.5 h-3.5" style={{ color: "#ef4444" }} />}
                      <span className="text-xs px-2 py-0.5 rounded-full font-display"
                        style={{ background: st.bg, color: st.color, border: `1px solid ${st.border}` }}>
                        {st.label}
                      </span>
                       {canPromote && (
                         <button
                           onClick={async (event) => {
                             event.stopPropagation();
                             setPromotingId(entry.accountId);
                             try {
                               const response = await fetch(`/api/admin/server-roster/${server.guildId}/primary`, {
                                 method: "POST",
                                 headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
                                 body: JSON.stringify({ accountId: entry.accountId }),
                               });
                               if (response.ok) {
                                 onPrimary();
                               } else {
                                 setPromotingId(null);
                               }
                             } catch {
                               setPromotingId(null);
                             }
                           }}
                           disabled={promotingId === entry.accountId}
                           className="text-[10px] px-2 py-1 rounded-md font-display tracking-wide disabled:opacity-50"
                           style={{ background: "rgba(96,165,250,0.1)", color: "#93c5fd", border: "1px solid rgba(96,165,250,0.25)" }}
                           title={health?.reason || "Set this healthy queued account as primary"}
                         >
                           {promotingId === entry.accountId ? "SETTING…" : "SET PRIMARY"}
                         </button>
                       )}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Main Admin Page ──────────────────────────────────────────────────────────

export default function Admin() {
  const [adminKey, setAdminKey] = useState(() => localStorage.getItem(STORAGE_KEY) || "");
  const [inputKey, setInputKey] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState("");
  const [tab, setTab] = useState<"licenses" | "roster">("licenses");

  // Licenses state
  const [licenses, setLicenses] = useState<License[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genCount, setGenCount] = useState(1);
  const [genLabel, setGenLabel] = useState("");
  const [copiedGlobal, setCopiedGlobal] = useState("");
  const [newCodes, setNewCodes] = useState<string[]>([]);

  // Roster state
  const [roster, setRoster] = useState<ServerSummary[]>([]);
  const [rosterLoading, setRosterLoading] = useState(false);
  const [rosterSearch, setRosterSearch] = useState("");

  const fetchLicenses = useCallback(async (key: string) => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/licenses", { headers: { "x-admin-key": key } });
      if (res.status === 403) {
        setAuthenticated(false);
        setAuthError("Invalid admin key.");
        localStorage.removeItem(STORAGE_KEY);
        return false;
      }
      const data = await res.json();
      if (!Array.isArray(data)) { setAuthError("Unexpected response."); return false; }
      setLicenses(data);
      setAuthenticated(true);
      return true;
    } catch {
      setAuthError("Network error — could not reach server.");
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRoster = useCallback(async (key: string) => {
    setRosterLoading(true);
    try {
      const res = await fetch("/api/admin/server-roster", { headers: { "x-admin-key": key } });
      if (!res.ok) return;
      const data = await res.json();
      setRoster(data);
    } catch {} finally {
      setRosterLoading(false);
    }
  }, []);

  const refreshAfterPrimary = useCallback(async () => {
    await fetchRoster(adminKey);
  }, [adminKey, fetchRoster]);

  useEffect(() => {
    if (adminKey) fetchLicenses(adminKey);
  }, []);

  useEffect(() => {
    if (authenticated && tab === "roster") fetchRoster(adminKey);
  }, [tab, authenticated]);

  useEffect(() => {
    if (!authenticated || tab !== "roster") return;
    const timer = window.setInterval(() => fetchRoster(adminKey), 15_000);
    return () => window.clearInterval(timer);
  }, [adminKey, authenticated, tab, fetchRoster]);

  const login = async () => {
    const k = inputKey.trim();
    if (!k) return;
    setAuthError("");
    const ok = await fetchLicenses(k);
    if (ok) { setAdminKey(k); localStorage.setItem(STORAGE_KEY, k); }
  };

  const logout = () => {
    setAdminKey(""); setAuthenticated(false);
    setLicenses([]); setRoster([]);
    localStorage.removeItem(STORAGE_KEY);
  };

  const generate = async () => {
    setGenerating(true); setNewCodes([]);
    try {
      const res = await fetch("/api/admin/licenses/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-admin-key": adminKey },
        body: JSON.stringify({ count: genCount, label: genLabel }),
      });
      const data = await res.json();
      const codes = data.created.map((l: License) => l.code);
      setNewCodes(codes);
      setLicenses(prev => [...data.created, ...prev]);
    } finally { setGenerating(false); }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedGlobal(text);
    setTimeout(() => setCopiedGlobal(""), 1500);
  };

  const filteredRoster = roster.filter(s =>
    !rosterSearch || s.guildName.toLowerCase().includes(rosterSearch.toLowerCase()) || s.guildId.includes(rosterSearch)
  );

  const licStats = {
    total: licenses.length,
    bound: licenses.filter(l => l.fingerprint).length,
    unbound: licenses.filter(l => !l.fingerprint && l.isActive).length,
    active: licenses.filter(l => l.isActive).length,
  };

  const rosterStats = {
    servers: roster.length,
    totalSlots: roster.reduce((a, s) => a + s.total, 0),
    activeSlots: roster.reduce((a, s) => a + s.active, 0),
    covered: roster.filter(s => s.active > 0).length,
  };

  // ── Login screen ─────────────────────────────────────────────────────────────
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center"
        style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(16,185,129,0.06) 0%, #030b06 70%)" }}>
        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: "linear-gradient(rgba(16,185,129,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.04) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="w-full max-w-sm mx-4 z-10 relative">
          <div className="rounded-3xl overflow-hidden" style={{
            background: "rgba(0,0,0,0.6)", backdropFilter: "blur(24px)",
            border: "1px solid rgba(16,185,129,0.2)", boxShadow: "0 0 60px rgba(16,185,129,0.08)",
          }}>
            <div className="h-1" style={{ background: "linear-gradient(90deg, #10b981, #34d399, #10b981)" }} />
            <div className="p-8">
              <div className="flex flex-col items-center mb-8">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                  style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
                  <Shield className="w-8 h-8" style={{ color: "#10b981" }} />
                </div>
                <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "#f0fdf4" }}>Admin Panel</h1>
                <p className="text-xs font-display tracking-widest uppercase mt-1" style={{ color: "rgba(16,185,129,0.5)" }}>Ghost Fleet Pro</p>
              </div>
              <div className="space-y-3">
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(16,185,129,0.4)" }} />
                  <input type="password" value={inputKey} onChange={e => setInputKey(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && login()} placeholder="Admin secret key"
                    className="w-full pl-11 pr-4 py-4 rounded-xl text-sm font-mono outline-none"
                    style={{ background: "rgba(0,0,0,0.5)", border: `1px solid ${authError ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.2)"}`, color: "#f0fdf4" }} />
                </div>
                {authError && <p className="text-xs px-1" style={{ color: "#ef4444" }}>{authError}</p>}
                <button onClick={login} disabled={loading} className="w-full py-4 rounded-xl font-display tracking-widest text-sm font-bold flex items-center justify-center gap-2"
                  style={{ background: "linear-gradient(135deg, #10b981, #059669)", color: "#000" }}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Lock className="w-4 h-4" /> Authenticate</>}
                </button>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ── Authenticated layout ──────────────────────────────────────────────────────
  return (
    <div className="min-h-screen p-6" style={{ background: "radial-gradient(ellipse at 20% 10%, rgba(16,185,129,0.05) 0%, #030b06 60%)" }}>
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(16,185,129,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.03) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />
      <div className="max-w-5xl mx-auto relative">

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <Shield className="w-5 h-5" style={{ color: "#10b981" }} />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold tracking-tight" style={{ color: "#f0fdf4" }}>Ghost Fleet Admin</h1>
              <p className="text-xs" style={{ color: "rgba(16,185,129,0.5)" }}>Restricted access — admin only</p>
            </div>
          </div>
          <button onClick={logout} className="h-9 px-3 rounded-lg flex items-center gap-2 text-xs font-display transition-all"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)", color: "rgba(239,68,68,0.7)" }}>
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 rounded-xl w-fit" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.1)" }}>
          {([
            { id: "licenses", icon: Key, label: "Licenses" },
            { id: "roster",   icon: Server, label: "Server Roster" },
          ] as const).map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-display tracking-widest uppercase transition-all"
              style={tab === t.id ? {
                background: "rgba(16,185,129,0.12)", color: "#34d399",
                border: "1px solid rgba(16,185,129,0.2)", boxShadow: "0 0 12px rgba(16,185,129,0.08)",
              } : {
                background: "transparent", color: "rgba(255,255,255,0.35)", border: "1px solid transparent",
              }}>
              <t.icon className="w-3.5 h-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {/* ── LICENSES TAB ── */}
        <AnimatePresence mode="wait">
          {tab === "licenses" && (
            <motion.div key="licenses" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>

              {/* Stats */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                {[
                  { label: "Total", value: licStats.total, color: "#f0fdf4" },
                  { label: "Active", value: licStats.active, color: "#34d399" },
                  { label: "Bound", value: licStats.bound, color: "#60a5fa" },
                  { label: "Unbound", value: licStats.unbound, color: "#fbbf24" },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4 text-center" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.1)" }}>
                    <div className="text-2xl font-display font-bold mb-1" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Generate panel */}
              <div className="rounded-2xl p-5 mb-6" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.15)" }}>
                <h2 className="font-display text-sm font-bold tracking-widest uppercase mb-4 flex items-center gap-2" style={{ color: "rgba(16,185,129,0.7)" }}>
                  <Plus className="w-4 h-4" /> Generate Licenses
                </h2>
                <div className="flex items-end gap-3">
                  <div className="flex-shrink-0">
                    <label className="text-xs font-display tracking-widest uppercase block mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>Count</label>
                    <input type="number" min={1} max={50} value={genCount}
                      onChange={e => setGenCount(Math.min(50, Math.max(1, parseInt(e.target.value) || 1)))}
                      className="w-20 px-3 py-2.5 rounded-xl text-sm font-mono outline-none text-center"
                      style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }} />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs font-display tracking-widest uppercase block mb-2" style={{ color: "rgba(255,255,255,0.3)" }}>Label (optional)</label>
                    <div className="relative">
                      <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: "rgba(16,185,129,0.4)" }} />
                      <input type="text" value={genLabel} onChange={e => setGenLabel(e.target.value)} placeholder="e.g. Beta, Founder"
                        className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm outline-none"
                        style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }} />
                    </div>
                  </div>
                  <button onClick={generate} disabled={generating}
                    className="h-10 px-5 rounded-xl font-display tracking-widest text-xs font-bold flex items-center gap-2 flex-shrink-0"
                    style={{ background: "linear-gradient(135deg, #10b981, #059669)", color: "#000" }}>
                    {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><Key className="w-3.5 h-3.5" /> Generate</>}
                  </button>
                </div>

                <AnimatePresence>
                  {newCodes.length > 0 && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}
                      className="mt-4 rounded-xl p-4" style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.15)" }}>
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.6)" }}>
                          Generated {newCodes.length} key{newCodes.length > 1 ? "s" : ""}
                        </span>
                        {newCodes.length > 1 && (
                          <button onClick={() => { navigator.clipboard.writeText(newCodes.join("\n")); setCopiedGlobal("all"); setTimeout(() => setCopiedGlobal(""), 1500); }}
                            className="text-xs font-display flex items-center gap-1.5 px-3 py-1 rounded-lg"
                            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "rgba(16,185,129,0.8)" }}>
                            {copiedGlobal === "all" ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />} Copy All
                          </button>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {newCodes.map(code => (
                          <div key={code} className="flex items-center justify-between gap-3">
                            <span className="font-mono text-sm font-bold tracking-widest" style={{ color: "#34d399" }}>{code}</span>
                            <button onClick={() => copyToClipboard(code)} className="opacity-60 hover:opacity-100">
                              {copiedGlobal === code ? <Check className="w-3.5 h-3.5" style={{ color: "#34d399" }} /> : <Copy className="w-3.5 h-3.5" style={{ color: "#34d399" }} />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* License list */}
              <div className="rounded-2xl p-5" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.1)" }}>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-display text-sm font-bold tracking-widest uppercase flex items-center gap-2" style={{ color: "rgba(16,185,129,0.7)" }}>
                    <Key className="w-4 h-4" /> All Licenses ({licenses.length})
                  </h2>
                  <button onClick={() => fetchLicenses(adminKey)} disabled={loading}
                    className="h-8 px-3 rounded-lg flex items-center gap-2 text-xs font-display transition-all"
                    style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)", color: "rgba(16,185,129,0.7)" }}>
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
                  </button>
                </div>
                {loading && licenses.length === 0 ? (
                  <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" style={{ color: "rgba(16,185,129,0.5)" }} /></div>
                ) : licenses.length === 0 ? (
                  <div className="text-center py-12 text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>No licenses yet.</div>
                ) : (
                  <div className="space-y-2">
                    <AnimatePresence>
                      {licenses.map(lic => (
                        <LicenseRow key={lic.code} lic={lic} adminKey={adminKey}
                          onRevoke={code => setLicenses(prev => prev.filter(l => l.code !== code))}
                          onCopy={copyToClipboard} />
                      ))}
                    </AnimatePresence>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── ROSTER TAB ── */}
          {tab === "roster" && (
            <motion.div key="roster" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>

              {/* Roster stats */}
              <div className="grid grid-cols-4 gap-4 mb-6">
                {[
                  { label: "Servers", value: rosterStats.servers, color: "#f0fdf4" },
                  { label: "Covered", value: rosterStats.covered, color: "#34d399" },
                  { label: "Active Slots", value: rosterStats.activeSlots, color: "#60a5fa" },
                  { label: "Total Slots", value: rosterStats.totalSlots, color: "#fbbf24" },
                ].map(s => (
                  <div key={s.label} className="rounded-xl p-4 text-center" style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.1)" }}>
                    <div className="text-2xl font-display font-bold mb-1" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(255,255,255,0.3)" }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Search + refresh */}
              <div className="flex items-center gap-3 mb-4">
                <input value={rosterSearch} onChange={e => setRosterSearch(e.target.value)}
                  placeholder="Filter by server name or ID…"
                  className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
                  style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.15)", color: "#f0fdf4" }} />
                <button onClick={() => fetchRoster(adminKey)} disabled={rosterLoading}
                  className="h-10 px-4 rounded-xl flex items-center gap-2 text-xs font-display transition-all"
                  style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.15)", color: "rgba(16,185,129,0.7)" }}>
                  <RefreshCw className={`w-3.5 h-3.5 ${rosterLoading ? "animate-spin" : ""}`} /> Refresh
                </button>
              </div>

              {/* Server cards */}
              {rosterLoading && roster.length === 0 ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: "rgba(16,185,129,0.5)" }} />
                </div>
              ) : filteredRoster.length === 0 ? (
                <div className="text-center py-20 rounded-2xl" style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(16,185,129,0.08)" }}>
                  <Server className="w-8 h-8 mx-auto mb-3" style={{ color: "rgba(16,185,129,0.3)" }} />
                  <p className="text-sm font-display" style={{ color: "rgba(255,255,255,0.35)" }}>
                    {roster.length === 0 ? "No servers tracked yet — accounts will populate this once they connect to Discord." : "No servers match your filter."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                   {filteredRoster.map(server => (
                     <RosterCard
                       key={server.guildId}
                       server={server}
                       adminKey={adminKey}
                       onPrimary={refreshAfterPrimary}
                     />
                   ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
