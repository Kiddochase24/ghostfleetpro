import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout";
import { useToast } from "@/hooks/use-toast";
import {
  Save, Loader2, Shield, Bell, Globe, Zap, Info, KeyRound,
  Trash2, Copy, CheckCircle2, RefreshCw, ExternalLink,
  Download, Upload
} from "lucide-react";
import { apiRequest, appUrl, getWorkspaceId } from "@/lib/queryClient";
import { motion, AnimatePresence } from "framer-motion";
import { format } from "date-fns";

const CONFIG_SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: Globe,
    keys: [
      { key: "operator_name", label: "Operator Display Name", placeholder: "Ghost Fleet Operator", type: "text" },
      { key: "max_accounts", label: "Max Concurrent Accounts", placeholder: "10", type: "number" },
      { key: "log_level", label: "Log Level", placeholder: "info", type: "select", options: ["debug", "info", "warn", "error"] },
    ]
  },
  {
    id: "messaging",
    label: "Messaging",
    icon: Zap,
    keys: [
      { key: "global_delay_ms", label: "Global Delay Fallback (ms)", placeholder: "0", type: "number" },
      { key: "max_messages_per_hour", label: "Max Messages / Hour", placeholder: "100", type: "number" },
      { key: "anti_detection", label: "Anti-Detection Mode", placeholder: "true", type: "select", options: ["true", "false"] },
    ]
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: Bell,
    keys: [
      { key: "telegram_bot_token", label: "Default Telegram Bot Token", placeholder: "Bot token from @BotFather", type: "password" },
      { key: "telegram_chat_id", label: "Default Telegram Chat ID", placeholder: "-100xxxxxxxxx", type: "text" },
      { key: "notify_on_error", label: "Notify on Errors", placeholder: "true", type: "select", options: ["true", "false"] },
    ]
  },
  {
    id: "security",
    label: "Security",
    icon: Shield,
    keys: [
      { key: "operator_password", label: "Dashboard Password", placeholder: "Leave blank to disable", type: "password" },
      { key: "whitelist_ips", label: "Allowed IPs (comma-sep)", placeholder: "127.0.0.1, x.x.x.x", type: "text" },
    ]
  },
];

type License = {
  code: string;
  label: string | null;
  fingerprint: string | null;
  activatedAt: string | null;
  createdAt: string;
  isActive: boolean;
};

const PURCHASE_URL = "https://ghostfleet.netlify.app";

function LicenseManager() {
  const { toast } = useToast();
  const [adminKey, setAdminKey] = useState(localStorage.getItem("gfp_admin_key") || "");
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const { data: licenses = [], isLoading, refetch } = useQuery<License[]>({
    queryKey: ["/api/admin/licenses", adminKey],
    queryFn: async () => {
      const res = await fetch(appUrl("/api/admin/licenses"), { headers: { "x-admin-key": adminKey } });
      if (res.status === 403) throw new Error("Invalid admin key");
      return res.json();
    },
    enabled: adminKey.length > 0,
    retry: false,
  });

  const revokeMutation = useMutation({
    mutationFn: async (code: string) => {
      await fetch(appUrl(`/api/admin/licenses/${code}`), { method: "DELETE", headers: { "x-admin-key": adminKey } });
    },
    onSuccess: () => { refetch(); toast({ title: "License revoked" }); },
  });

  const copyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Purchase new license — directs to payment site */}
      <a
        href={PURCHASE_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-between w-full px-5 py-4 rounded-xl transition-all duration-200 group"
        style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}
      >
        <div>
          <p className="font-display text-sm font-bold tracking-wide" style={{ color: "#34d399" }}>Purchase New License</p>
          <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>
            Licenses are issued automatically after payment
          </p>
        </div>
        <ExternalLink className="w-4 h-4 flex-shrink-0 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" style={{ color: "#10b981" }} />
      </a>

      {/* Admin key input */}
      <div>
        <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>
          Admin Key
        </label>
        <input
          type="password"
          value={adminKey}
          onChange={e => { setAdminKey(e.target.value); localStorage.setItem("gfp_admin_key", e.target.value); }}
          placeholder="Enter your ADMIN_SECRET to manage licenses..."
          className="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono"
          style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }}
          onFocus={e => e.target.style.borderColor = "rgba(16,185,129,0.5)"}
          onBlur={e => e.target.style.borderColor = "rgba(16,185,129,0.2)"}
        />
      </div>

      {/* License list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.5)" }}>
            Issued Licenses ({licenses.length})
          </p>
          <button onClick={() => refetch()} className="p-1.5 rounded-lg transition-colors" style={{ color: "rgba(255,255,255,0.3)" }}>
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {!adminKey ? (
          <div className="text-center py-8 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Enter admin key above to view and manage licenses</div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-8" style={{ color: "rgba(16,185,129,0.4)" }}>
            <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
          </div>
        ) : licenses.length === 0 ? (
          <div className="text-center py-8 text-xs rounded-xl" style={{ color: "rgba(255,255,255,0.2)", border: "1px dashed rgba(255,255,255,0.08)" }}>
            No licenses yet. They will appear here automatically after purchases.
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {licenses.map(lic => (
              <motion.div
                key={lic.code}
                layout
                className="flex items-center gap-3 px-4 py-3 rounded-xl"
                style={{
                  background: "rgba(0,0,0,0.3)",
                  border: `1px solid ${lic.isActive ? (lic.fingerprint ? "rgba(16,185,129,0.2)" : "rgba(255,255,255,0.07)") : "rgba(239,68,68,0.15)"}`,
                  opacity: lic.isActive ? 1 : 0.5,
                }}>
                {/* Status dot */}
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${!lic.isActive ? "bg-red-500" : lic.fingerprint ? "bg-emerald-500" : "bg-yellow-500"}`} />

                {/* Code */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold tracking-widest" style={{ color: "#f0fdf4" }}>{lic.code}</span>
                    {lic.label && (
                      <span className="text-xs px-1.5 py-0.5 rounded font-display" style={{ background: "rgba(16,185,129,0.1)", color: "rgba(16,185,129,0.7)" }}>
                        {lic.label}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    {lic.fingerprint ? (
                      <span className="text-xs flex items-center gap-1" style={{ color: "#10b981" }}>
                        <CheckCircle2 className="w-3 h-3" />
                        Activated {lic.activatedAt ? format(new Date(lic.activatedAt), "MMM d, yyyy") : ""}
                      </span>
                    ) : (
                      <span className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>Not yet activated</span>
                    )}
                    <span className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>
                      Created {format(new Date(lic.createdAt), "MMM d")}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => copyCode(lic.code)}
                    className="p-1.5 rounded-lg transition-colors"
                    title="Copy code"
                    style={{ color: copiedCode === lic.code ? "#10b981" : "rgba(255,255,255,0.3)" }}
                  >
                    {copiedCode === lic.code ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  {lic.isActive && (
                    <button
                      onClick={() => { if (confirm(`Revoke license ${lic.code}?`)) revokeMutation.mutate(lic.code); }}
                      className="p-1.5 rounded-lg transition-colors"
                      title="Revoke license"
                      style={{ color: "rgba(239,68,68,0.5)" }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {!lic.isActive && (
                    <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>
                      Revoked
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Activated</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" /> Unused</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Revoked</span>
      </div>
    </div>
  );
}

export default function ConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [activeSection, setActiveSection] = useState("general");
  const initialized = useRef(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const handleDownloadConfig = async () => {
    setIsExporting(true);
    try {
      const wsId = getWorkspaceId();
      const res = await fetch("/api/workspace/export", {
        headers: wsId ? { "X-Workspace-Id": wsId } : {},
      });
      if (!res.ok) throw new Error("Export failed");
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ghostfleet-config-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Config Downloaded", description: `${data.accounts.length} accounts + ${data.rules.length} rules exported.` });
    } catch (err: any) {
      toast({ title: "Export Failed", description: err.message, variant: "destructive" });
    }
    setIsExporting(false);
  };

  const handleUploadConfig = async (file: File) => {
    setIsImporting(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.accounts || !data.rules) throw new Error("Invalid config file format");
      const wsId = getWorkspaceId();
      const res = await fetch("/api/workspace/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(wsId ? { "X-Workspace-Id": wsId } : {}) },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Import failed");
      const result = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rules"] });
      toast({
        title: "Config Imported",
        description: `${result.accountsImported} accounts + ${result.rulesImported} rules imported. ${result.accountsSkipped > 0 ? `${result.accountsSkipped} accounts already existed.` : ""}`,
      });
    } catch (err: any) {
      toast({ title: "Import Failed", description: err.message, variant: "destructive" });
    }
    setIsImporting(false);
    if (uploadInputRef.current) uploadInputRef.current.value = "";
  };

  const { data: configData, isLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/config"],
  });

  useEffect(() => {
    if (configData && !initialized.current) {
      initialized.current = true;
      setValues(configData);
    }
  }, [configData]);

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, string>) => apiRequest("POST", "/api/config", data).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/config"] });
      initialized.current = false;
      toast({ title: "Configuration Saved", description: "All settings have been persisted." });
    },
    onError: (err: any) => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
  });

  const section = CONFIG_SECTIONS.find(s => s.id === activeSection);
  const isLicenseSection = activeSection === "licenses";

  return (
    <AppLayout>
      <div className="p-6 md:p-8 max-w-5xl mx-auto">
        <div className="flex items-start justify-between mb-8 gap-4">
          <div>
            <h1 className="font-display text-3xl font-bold tracking-tight mb-1" style={{ color: "#f0fdf4" }}>CONFIGURATION</h1>
            <p className="text-sm" style={{ color: "rgba(255,255,255,0.3)" }}>System-wide settings and defaults</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
            {/* Download Config */}
            <button
              onClick={handleDownloadConfig}
              disabled={isExporting}
              title="Download your tokens and rules as a backup file"
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-display tracking-wide text-sm font-semibold transition-all duration-200 disabled:opacity-50"
              style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)" }}
            >
              {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
              Download Config
            </button>

            {/* Upload Config */}
            <label
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-display tracking-wide text-sm font-semibold transition-all duration-200 cursor-pointer"
              style={{ background: "rgba(16,185,129,0.12)", color: "#34d399", border: "1px solid rgba(16,185,129,0.25)", opacity: isImporting ? 0.5 : 1 }}
              title="Upload a config file to restore tokens and rules"
            >
              {isImporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              Upload Config
              <input
                ref={uploadInputRef}
                type="file"
                accept=".json,application/json"
                className="hidden"
                disabled={isImporting}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleUploadConfig(f); }}
              />
            </label>

            {/* Save Config — only for settings sections */}
            {!isLicenseSection && (
              <button
                onClick={() => saveMutation.mutate(values)}
                disabled={saveMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-display tracking-wide text-sm font-semibold transition-all duration-200 disabled:opacity-50"
                style={{ background: "rgba(16,185,129,0.85)", color: "#000", boxShadow: "0 0 20px rgba(16,185,129,0.3)" }}
              >
                {saveMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                ) : (
                  <><Save className="w-4 h-4" /> Save Config</>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="md:col-span-1 space-y-1">
            {CONFIG_SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200"
                style={{
                  background: activeSection === s.id ? "rgba(16,185,129,0.1)" : "transparent",
                  color: activeSection === s.id ? "#34d399" : "rgba(255,255,255,0.4)",
                  border: activeSection === s.id ? "1px solid rgba(16,185,129,0.25)" : "1px solid transparent",
                }}
              >
                <s.icon className="w-4 h-4 flex-shrink-0" />
                <span className="font-display text-sm tracking-wide">{s.label}</span>
              </button>
            ))}
            {/* Licenses section */}
            <button
              onClick={() => setActiveSection("licenses")}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all duration-200"
              style={{
                background: isLicenseSection ? "rgba(16,185,129,0.1)" : "transparent",
                color: isLicenseSection ? "#34d399" : "rgba(255,255,255,0.4)",
                border: isLicenseSection ? "1px solid rgba(16,185,129,0.25)" : "1px solid transparent",
              }}
            >
              <KeyRound className="w-4 h-4 flex-shrink-0" />
              <span className="font-display text-sm tracking-wide">Licenses</span>
            </button>
          </div>

          <div className="md:col-span-3">
            <div className="rounded-2xl overflow-hidden"
              style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(16px)", border: "1px solid rgba(16,185,129,0.15)" }}>
              <div className="flex items-center gap-3 px-6 py-5 border-b" style={{ borderColor: "rgba(16,185,129,0.1)" }}>
                {isLicenseSection ? (
                  <KeyRound className="w-5 h-5" style={{ color: "#10b981" }} />
                ) : (
                  section && <section.icon className="w-5 h-5" style={{ color: "#10b981" }} />
                )}
                <h2 className="font-display text-lg font-bold" style={{ color: "#f0fdf4" }}>
                  {isLicenseSection ? "License Manager" : `${section?.label} Settings`}
                </h2>
              </div>

              <div className="p-6">
                {isLicenseSection ? (
                  <LicenseManager />
                ) : isLoading ? (
                  <div className="flex items-center justify-center py-10" style={{ color: "rgba(16,185,129,0.4)" }}>
                    <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading...
                  </div>
                ) : (
                  <div className="space-y-5">
                    {section?.keys.map(field => (
                      <div key={field.key}>
                        <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>
                          {field.label}
                        </label>
                        {field.type === "select" ? (
                          <select
                            value={values[field.key] ?? ""}
                            onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                            className="w-full px-4 py-3 rounded-xl text-sm outline-none"
                            style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }}
                          >
                            <option value="">{field.placeholder}</option>
                            {field.options?.map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            value={values[field.key] ?? ""}
                            onChange={e => setValues(v => ({ ...v, [field.key]: e.target.value }))}
                            placeholder={field.placeholder}
                            className="w-full px-4 py-3 rounded-xl text-sm outline-none font-mono"
                            style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }}
                            onFocus={e => e.target.style.borderColor = "rgba(16,185,129,0.5)"}
                            onBlur={e => e.target.style.borderColor = "rgba(16,185,129,0.2)"}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {!isLicenseSection && (
                <div className="px-6 py-4 flex items-center gap-2 border-t" style={{ borderColor: "rgba(16,185,129,0.06)", background: "rgba(16,185,129,0.02)" }}>
                  <Info className="w-4 h-4 flex-shrink-0" style={{ color: "rgba(16,185,129,0.4)" }} />
                  <p className="text-xs" style={{ color: "rgba(255,255,255,0.25)" }}>
                    Settings are stored globally. Restart after changing security settings.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
