import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { useWorkspace } from "@/context/workspace";
import { format } from "date-fns";
import {
  Activity, ShieldCheck, MessageSquare, Database,
  Cpu, Terminal, Wifi, Clock, Users, CheckCircle2, XCircle,
  AlertTriangle, Brain, Zap, UserPlus, MessageCircle,
  WifiOff, RefreshCw, Ban, Power, ShieldAlert, ShieldCheck as ShieldOk
} from "lucide-react";

function parseConsoleLine(line: string): {
  icon: any;
  color: string;
  badge?: string;
  badgeColor?: string;
  text: string;
} {
  if (/GATEWAY READY/i.test(line))
    return { icon: CheckCircle2, color: "#10b981", badge: "READY", badgeColor: "#10b981", text: line };
  if (/✓ AUTO-REPLY|AUTO-REPLY/i.test(line))
    return { icon: MessageSquare, color: "#34d399", badge: "REPLY", badgeColor: "#34d399", text: line };
  if (/AI FALLBACK/i.test(line))
    return { icon: Zap, color: "#22d3ee", badge: "FALLBACK", badgeColor: "#22d3ee", text: line };
  if (/AI BLOCKED/i.test(line))
    return { icon: Ban, color: "#f87171", badge: "BLOCKED", badgeColor: "#ef4444", text: line };
  if (/AI CLASSIFY ERR/i.test(line))
    return { icon: XCircle, color: "#f87171", badge: "AI ERR", badgeColor: "#ef4444", text: line };
  if (/^AI \[/i.test(line))
    return { icon: Brain, color: "#818cf8", badge: "AI", badgeColor: "#6366f1", text: line };
  if (/⚠ REMOVED FROM SERVER|REMOVED FROM SERVER/i.test(line))
    return { icon: AlertTriangle, color: "#fb923c", badge: "KICKED", badgeColor: "#f97316", text: line };
  if (/🚫 BANNED|BANNED/i.test(line))
    return { icon: Ban, color: "#f87171", badge: "BAN", badgeColor: "#ef4444", text: line };
  if (/SEND FAILED/i.test(line))
    return { icon: XCircle, color: "#f87171", badge: "ERR", badgeColor: "#ef4444", text: line };
  if (/👤 NEW MEMBER|NEW MEMBER/i.test(line))
    return { icon: UserPlus, color: "#a78bfa", badge: "JOIN", badgeColor: "#8b5cf6", text: line };
  if (/💬 FIRST MSG|FIRST MSG/i.test(line))
    return { icon: MessageCircle, color: "#22d3ee", badge: "1ST", badgeColor: "#06b6d4", text: line };
  if (/GATEWAY CLOSED|DISCONNECT/i.test(line))
    return { icon: WifiOff, color: "#fb923c", badge: "DISC", badgeColor: "#f97316", text: line };
  if (/RESUME|RECONNECT/i.test(line))
    return { icon: RefreshCw, color: "#fbbf24", badge: "RETRY", badgeColor: "#f59e0b", text: line };
  if (/HEARTBEAT/i.test(line))
    return { icon: Activity, color: "rgba(16,185,129,0.35)", text: line };
  return { icon: Terminal, color: "rgba(74,222,128,0.7)", text: line };
}

function StatCard({ title, value, icon: Icon, color = "#10b981", sub }: any) {
  return (
    <div
      className="rounded-2xl p-5 relative overflow-hidden group transition-all duration-300"
      style={{
        background: "rgba(0,0,0,0.4)",
        backdropFilter: "blur(16px)",
        border: `1px solid ${color}25`,
        boxShadow: `0 0 20px ${color}08, inset 0 0 20px ${color}05`,
      }}
    >
      <div className="absolute -right-4 -top-4 w-20 h-20 rounded-full transition-all duration-700 group-hover:scale-125"
        style={{ background: `${color}10`, filter: "blur(20px)" }} />
      <div className="flex items-start justify-between mb-4">
        <div className="p-2.5 rounded-xl" style={{ background: `${color}15`, border: `1px solid ${color}25` }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
      </div>
      <div className="text-4xl font-display font-bold mb-1" style={{ color: "#f0fdf4" }}>{value}</div>
      <div className="text-xs font-display tracking-widest uppercase" style={{ color: `${color}80` }}>{title}</div>
      {sub && <div className="text-xs mt-1" style={{ color: "rgba(255,255,255,0.3)" }}>{sub}</div>}
    </div>
  );
}

function LiveBar({ label, value, color = "#10b981" }: any) {
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs mb-1">
        <span style={{ color: "rgba(255,255,255,0.4)" }} className="font-display tracking-wider">{label}</span>
        <span style={{ color }} className="font-mono">{value}%</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value}%`, background: `linear-gradient(to right, ${color}80, ${color})` }}
        />
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats } = useQuery<any>({ queryKey: ["/api/stats"], refetchInterval: 3000 });
  const { data: history } = useQuery<any[]>({ queryKey: ["/api/history"], refetchInterval: 5000 });
  const { data: devMode } = useQuery<{ enabled: boolean; production: boolean }>({
    queryKey: ["/api/dev-mode"],
    refetchInterval: 5000,
  });
  const queryClient = useQueryClient();
  const toggleDevMode = useMutation({
    mutationFn: async (enabled: boolean) => {
      const r = await fetch("/api/dev-mode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!r.ok) throw new Error("toggle failed");
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["/api/dev-mode"], data);
      queryClient.invalidateQueries({ queryKey: ["/api/gateway/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
  });
  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [latency, setLatency] = useState(0);
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected">("connecting");
  // Gateway health from watchdog broadcasts
  const [gatewayHealth, setGatewayHealth] = useState<{
    total: number; ready: number; dead: number; connecting: number; recovering: number;
  } | null>(null);
  // Dead accounts by name — updated from per-session events
  const [deadAccounts, setDeadAccounts] = useState<Record<string, string>>({}); // id → name
  const consoleRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Fetch initial console buffer
    fetch("/api/console")
      .then(r => r.json())
      .then((lines: string[]) => setConsoleLines(lines))
      .catch(() => {});

    let pingInterval: ReturnType<typeof setInterval> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let pongWatchdog: ReturnType<typeof setTimeout> | null = null;
    let closed = false;

    const connect = () => {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
      const ws = new WebSocket(`${protocol}//${window.location.host}${base}/ws`);
      wsRef.current = ws;
      setWsStatus("connecting");

      const ping = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        const ts = Date.now();
        ws.send(JSON.stringify({ type: "ping", ts }));
        // If no pong arrives in 10s, treat the socket as dead
        if (pongWatchdog) clearTimeout(pongWatchdog);
        pongWatchdog = setTimeout(() => {
          try { ws.close(); } catch {}
        }, 10000);
      };

      ws.onopen = () => {
        setWsStatus("connected");
        ping();
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(ping, 3000);
      };

      ws.onclose = () => {
        setWsStatus("disconnected");
        if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
        if (pongWatchdog) { clearTimeout(pongWatchdog); pongWatchdog = null; }
        if (!closed) {
          if (reconnectTimer) clearTimeout(reconnectTimer);
          reconnectTimer = setTimeout(connect, 2000);
        }
      };

      ws.onerror = () => setWsStatus("disconnected");

      ws.onmessage = (e) => {
        let msg: any;
        try { msg = JSON.parse(e.data); } catch { return; }
        if (msg.event === "pong") {
          if (pongWatchdog) { clearTimeout(pongWatchdog); pongWatchdog = null; }
          const sent = Number(msg.data?.ts);
          if (Number.isFinite(sent)) setLatency(Math.max(0, Date.now() - sent));
        } else if (msg.event === "console") {
          setConsoleLines(prev => [...prev, msg.data].slice(-80));
        } else if (msg.event === "gatewayHealth") {
          setGatewayHealth(msg.data);
        } else if (msg.event === "gatewayStatus") {
          const { accountId, accountName, status } = msg.data || {};
          if (!accountId) return;
          if (status === "dead") {
            setDeadAccounts(prev => ({ ...prev, [accountId]: accountName || accountId }));
          } else if (status === "ready" || status === "connecting") {
            setDeadAccounts(prev => {
              const next = { ...prev };
              delete next[accountId];
              return next;
            });
          }
        }
      };
    };

    connect();

    return () => {
      closed = true;
      if (pingInterval) clearInterval(pingInterval);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (pongWatchdog) clearTimeout(pongWatchdog);
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (consoleRef.current) {
      consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
    }
  }, [consoleLines]);

  const { workspace } = useWorkspace();

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight mb-1" style={{ color: "#f0fdf4" }}>
              SYSTEMS OVERVIEW
            </h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>Real-time telemetry &amp; fleet operations</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-xs font-display tracking-widest mb-0.5" style={{ color: "rgba(16,185,129,0.6)" }}>OPERATOR</div>
              <div className="text-sm font-mono flex items-center gap-1.5 justify-end">
                <div className="w-1.5 h-1.5 rounded-full status-dot-online" />
                <span style={{ color: "#34d399" }}>ghostx{workspace?.name}</span>
                <span style={{ color: "rgba(255,255,255,0.3)" }}>signed in</span>
              </div>
            </div>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)" }}>
              <Users className="w-5 h-5" style={{ color: "#34d399" }} />
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard title="Active Rules" value={stats?.activeRules ?? "—"} icon={ShieldCheck} color="#10b981" />
          <StatCard title="Auto Replies" value={stats?.autoReplies ?? "—"} icon={MessageSquare} color="#3b82f6" />
          <StatCard title="Total Logs" value={stats?.totalLogs ?? "—"} icon={Database} color="#8b5cf6" />
          <StatCard title="Total Rules" value={stats?.totalRules ?? "—"} icon={Activity} color="#f59e0b" />
        </div>

        {/* System Stats Row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          {/* CPU / MEM */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(16,185,129,0.15)" }}>
            <div className="flex items-center gap-2 mb-4">
              <Cpu className="w-4 h-4" style={{ color: "#10b981" }} />
              <span className="font-display text-xs tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.7)" }}>System Resources</span>
            </div>
            <LiveBar label="CPU LOAD" value={stats?.cpu ?? 0} color="#10b981" />
            <LiveBar label="MEMORY" value={stats?.mem ?? 0} color="#3b82f6" />
          </div>

          {/* Network */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(59,130,246,0.15)" }}>
            <div className="flex items-center gap-2 mb-4">
              <Wifi className="w-4 h-4" style={{ color: "#3b82f6" }} />
              <span className="font-display text-xs tracking-widest uppercase" style={{ color: "rgba(59,130,246,0.7)" }}>Network Status</span>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-xs font-display tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>WS LATENCY</span>
                <span className="text-lg font-mono font-bold" style={{ color: latency < 50 ? "#10b981" : latency < 100 ? "#f59e0b" : "#ef4444" }}>
                  {latency}ms
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-display tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>SOCKET STATUS</span>
                <span className="flex items-center gap-1.5 text-xs font-display">
                  <div className={`w-2 h-2 rounded-full ${wsStatus === "connected" ? "status-dot-online" : "bg-red-500"}`} />
                  <span style={{ color: wsStatus === "connected" ? "#10b981" : "#ef4444" }}>{wsStatus.toUpperCase()}</span>
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-xs font-display tracking-wider" style={{ color: "rgba(255,255,255,0.4)" }}>ACTIVE NODES</span>
                <span className="text-lg font-mono font-bold" style={{ color: "#3b82f6" }}>{stats?.connectedAccounts ?? 0}</span>
              </div>

              {/* Dev-mode fleet toggle (hidden in production where it's always on) */}
              {devMode && !devMode.production && (
                <div className="flex justify-between items-center pt-3 mt-1 border-t" style={{ borderColor: "rgba(59,130,246,0.1)" }}>
                  <span className="text-xs font-display tracking-wider flex items-center gap-1.5" style={{ color: "rgba(255,255,255,0.4)" }}>
                    <Power className="w-3 h-3" style={{ color: devMode.enabled ? "#10b981" : "#6b7280" }} />
                    DEV FLEET
                  </span>
                  <button
                    type="button"
                    disabled={toggleDevMode.isPending}
                    onClick={() => toggleDevMode.mutate(!devMode.enabled)}
                    className="relative inline-flex items-center h-6 w-11 rounded-full transition-colors duration-200 disabled:opacity-50"
                    style={{
                      background: devMode.enabled ? "rgba(16,185,129,0.4)" : "rgba(75,85,99,0.4)",
                      border: `1px solid ${devMode.enabled ? "rgba(16,185,129,0.6)" : "rgba(107,114,128,0.4)"}`,
                    }}
                    aria-label="Toggle dev-mode fleet"
                  >
                    <span
                      className="inline-block w-4 h-4 rounded-full transition-transform duration-200"
                      style={{
                        background: devMode.enabled ? "#10b981" : "#9ca3af",
                        transform: devMode.enabled ? "translateX(22px)" : "translateX(3px)",
                        boxShadow: devMode.enabled ? "0 0 8px rgba(16,185,129,0.8)" : "none",
                      }}
                    />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Timing */}
          <div className="rounded-2xl p-5" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(139,92,246,0.15)" }}>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-4 h-4" style={{ color: "#8b5cf6" }} />
              <span className="font-display text-xs tracking-widest uppercase" style={{ color: "rgba(139,92,246,0.7)" }}>Time</span>
            </div>
            <div className="text-3xl font-mono font-bold mb-1" style={{ color: "#f0fdf4" }}>
              {format(new Date(), "HH:mm:ss")}
            </div>
            <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>{format(new Date(), "EEE, MMM dd yyyy")}</div>
            <div className="mt-4 text-xs font-display tracking-wider" style={{ color: "rgba(139,92,246,0.6)" }}>UTC SYNC ACTIVE</div>
          </div>
        </div>

        {/* Gateway health alert bar — shown only when sessions drop */}
        {Object.keys(deadAccounts).length > 0 && (
          <div className="mb-4 rounded-xl px-4 py-3 flex items-center gap-3"
            style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.35)", backdropFilter: "blur(12px)" }}>
            <ShieldAlert className="w-4 h-4 flex-shrink-0" style={{ color: "#f87171" }} />
            <div className="flex-1 min-w-0">
              <span className="text-xs font-display tracking-wider" style={{ color: "#f87171" }}>
                GATEWAY ALERT —{" "}
              </span>
              <span className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
                {Object.values(deadAccounts).join(", ")} dropped
                {gatewayHealth && gatewayHealth.recovering > 0
                  ? ` · ${gatewayHealth.recovering} reconnecting…`
                  : " · reconnecting…"}
              </span>
            </div>
            {gatewayHealth && (
              <span className="text-xs font-mono flex-shrink-0" style={{ color: "rgba(255,255,255,0.3)" }}>
                {gatewayHealth.ready}/{gatewayHealth.total} up
              </span>
            )}
          </div>
        )}
        {Object.keys(deadAccounts).length === 0 && gatewayHealth && gatewayHealth.total > 0 && (
          <div className="mb-4 rounded-xl px-4 py-2.5 flex items-center gap-3"
            style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)" }}>
            <ShieldOk className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "#10b981" }} />
            <span className="text-xs font-display tracking-wider" style={{ color: "rgba(16,185,129,0.7)" }}>
              ALL {gatewayHealth.total} GATEWAY SESSIONS HEALTHY
            </span>
          </div>
        )}

        {/* Bottom Grid: Live Feed + Console */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Live Activity Feed */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(16,185,129,0.15)" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "rgba(16,185,129,0.1)" }}>
              <div className="w-2 h-2 rounded-full status-dot-online" />
              <span className="font-display text-sm tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.8)" }}>Live Feed</span>
            </div>
            <div className="divide-y" style={{ borderColor: "rgba(16,185,129,0.05)" }}>
              {!history || history.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>No activity detected</div>
              ) : (
                history.slice(0, 6).map((log) => (
                  <div key={log.id} className="px-5 py-3 flex items-start gap-3 group transition-colors duration-200"
                    style={{ borderColor: "rgba(16,185,129,0.05)" }}>
                    <div className="w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center mt-0.5"
                      style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                      <MessageSquare className="w-3 h-3" style={{ color: "#34d399" }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono font-bold" style={{ color: "#34d399" }}>{log.accName}</span>
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>→</span>
                        <span className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>@{log.target}</span>
                        <span className="text-xs ml-auto flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }}>
                          {format(new Date(log.ts), "HH:mm:ss")}
                        </span>
                      </div>
                      <p className="text-xs truncate" style={{ color: "rgba(255,255,255,0.4)" }}>{log.msg}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Live Console */}
          <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(16px)", border: "1px solid rgba(16,185,129,0.1)" }}>
            <div className="flex items-center gap-3 px-5 py-4 border-b" style={{ borderColor: "rgba(16,185,129,0.08)" }}>
              <Terminal className="w-4 h-4" style={{ color: "#10b981" }} />
              <span className="font-display text-sm tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.7)" }}>Live Console</span>
              <span className="ml-auto text-xs font-mono blink" style={{ color: "rgba(16,185,129,0.5)" }}>█</span>
            </div>
            <div
              ref={consoleRef}
              className="p-3 overflow-y-auto space-y-1"
              style={{ height: "280px" }}
            >
              {consoleLines.length === 0 ? (
                <div className="text-xs font-mono" style={{ color: "rgba(16,185,129,0.3)" }}>Awaiting system events...</div>
              ) : (
                consoleLines.map((line, i) => {
                  const { icon: Icon, color, badge, badgeColor, text } = parseConsoleLine(line);
                  const isLatest = i === consoleLines.length - 1;
                  return (
                    <div key={i} className="flex items-start gap-2 rounded-lg px-2 py-1 group transition-all duration-150"
                      style={{ background: isLatest ? `${color}10` : "transparent" }}>
                      <Icon className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color }} />
                      {badge && (
                        <span className="text-[9px] font-display tracking-widest px-1 rounded flex-shrink-0 mt-px leading-4"
                          style={{ background: `${badgeColor}20`, color: badgeColor, border: `1px solid ${badgeColor}40` }}>
                          {badge}
                        </span>
                      )}
                      <span className="font-mono text-[11px] leading-4 break-all"
                        style={{ color: isLatest ? "#e2e8f0" : color }}>
                        {text}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
