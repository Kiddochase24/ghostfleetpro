import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { format } from "date-fns";
import { MessageSquare, Server, Hash, User, Activity, Loader2 } from "lucide-react";

type History = {
  id: number;
  accName: string;
  accId?: string;
  srvName: string;
  chanName: string;
  target: string;
  msg: string;
  ruleLabel?: string;
  latencyMs?: number;
  ts: string;
};

export default function HistoryPage() {
  const { data: history = [], isLoading } = useQuery<History[]>({
    queryKey: ["/api/history"],
    refetchInterval: 5000,
  });

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="font-display text-3xl font-bold tracking-tight mb-1" style={{ color: "#f0fdf4" }}>RESPONSE HISTORY</h1>
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>
            {history.length} logged response{history.length !== 1 ? "s" : ""} — auto-refreshing
          </p>
        </div>

        <div className="rounded-2xl overflow-hidden" style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(16,185,129,0.15)" }}>
          {/* Table Header */}
          <div className="hidden md:grid gap-4 px-5 py-3 border-b"
            style={{ gridTemplateColumns: "2rem 1.2fr 1fr 1fr 2fr 6rem", borderColor: "rgba(16,185,129,0.1)", background: "rgba(16,185,129,0.03)" }}>
            {["", "Account", "Target User", "Location", "Message", "Time"].map((h, i) => (
              <div key={i} className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.5)" }}>{h}</div>
            ))}
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16" style={{ color: "rgba(16,185,129,0.4)" }}>
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading history...
            </div>
          ) : history.length === 0 ? (
            <div className="py-16 text-center">
              <Activity className="w-10 h-10 mx-auto mb-3" style={{ color: "rgba(16,185,129,0.15)" }} />
              <p className="text-sm" style={{ color: "rgba(255,255,255,0.2)" }}>No responses logged yet. Rules in active state will log here.</p>
            </div>
          ) : (
            history.map(log => (
              <div key={log.id}
                className="flex md:grid gap-4 px-5 py-4 items-start md:items-center"
                style={{ gridTemplateColumns: "2rem 1.2fr 1fr 1fr 2fr 6rem", borderBottom: "1px solid rgba(16,185,129,0.04)" }}>
                <div className="flex-shrink-0">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
                    <MessageSquare className="w-3.5 h-3.5" style={{ color: "#34d399" }} />
                  </div>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-6 rounded-md flex-shrink-0 flex items-center justify-center text-xs font-bold"
                    style={{ background: "rgba(16,185,129,0.15)", color: "#34d399" }}>
                    {log.accName[0]}
                  </div>
                  <span className="text-sm truncate" style={{ color: "#f0fdf4" }}>{log.accName}</span>
                </div>

                <div className="flex items-center gap-1.5 min-w-0">
                  <User className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                  <span className="text-sm truncate" style={{ color: "rgba(255,255,255,0.6)" }}>@{log.target}</span>
                </div>

                <div className="flex flex-col gap-0.5 min-w-0">
                  <div className="flex items-center gap-1">
                    <Server className="w-3 h-3 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                    <span className="text-xs truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{log.srvName}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Hash className="w-3 h-3 flex-shrink-0" style={{ color: "rgba(255,255,255,0.2)" }} />
                    <span className="text-xs truncate" style={{ color: "rgba(255,255,255,0.35)" }}>{log.chanName}</span>
                  </div>
                </div>

                <p className="text-sm truncate" style={{ color: "rgba(255,255,255,0.5)" }}>{log.msg}</p>

                <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                  <span className="text-xs font-mono" style={{ color: "rgba(255,255,255,0.3)" }}>
                    {format(new Date(log.ts), "HH:mm:ss")}
                  </span>
                  {log.latencyMs != null && (
                    <span className="text-xs font-mono" style={{ color: log.latencyMs < 100 ? "#10b981" : "#f59e0b" }}>
                      {log.latencyMs}ms
                    </span>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}
