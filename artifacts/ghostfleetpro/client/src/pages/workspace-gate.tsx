import { useState } from "react";
import { useWorkspace } from "@/context/workspace";
import { useToast } from "@/hooks/use-toast";
import { appUrl } from "@/lib/queryClient";
import { TerminalSquare, Plus, LogIn, Eye, EyeOff, Loader2, Shield, Lock, Unlock } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type Mode = "choose" | "login" | "create";

const WORKSPACE_REQUEST_TIMEOUT_MS = 15000;

async function fetchWorkspaceRequest(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), WORKSPACE_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function WorkspaceGate() {
  const { setWorkspace } = useWorkspace();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("choose");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const reset = (newMode: Mode) => {
    setMode(newMode);
    setName("");
    setPassword("");
    setError("");
  };

  const handleCreate = async () => {
    if (!name.trim()) return setError("Workspace name is required");
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) return setError("Only letters, numbers, _ and - allowed");
    setLoading(true);
    setError("");
    try {
      const res = await fetchWorkspaceRequest(appUrl("/api/workspaces"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password: password || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Failed to create workspace"); setLoading(false); return; }
      setWorkspace({ id: data.id, name: data.name, createdAt: data.createdAt });
    } catch (err: any) {
      setError(err?.name === "AbortError"
        ? "The server took too long to respond. Check the VPS connection and try again."
        : "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async () => {
    if (!name.trim()) return setError("Workspace name is required");
    setLoading(true);
    setError("");
    try {
      const res = await fetchWorkspaceRequest(appUrl("/api/workspaces/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password: password || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || "Login failed"); setLoading(false); return; }
      setWorkspace({ id: data.id, name: data.name, createdAt: data.createdAt });
    } catch (err: any) {
      setError(err?.name === "AbortError"
        ? "The server took too long to respond. Check the VPS connection and try again."
        : "Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "create") handleCreate();
    else if (mode === "login") handleLogin();
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4"
      style={{
        background: "hsl(160, 50%, 2%)",
        backgroundImage: "radial-gradient(circle at 20% 50%, rgba(16,185,129,0.08), transparent 40%), radial-gradient(circle at 80% 30%, rgba(16,185,129,0.05), transparent 40%)"
      }}>

      {/* Decorative grid lines */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{ backgroundImage: "linear-gradient(rgba(16,185,129,1) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,1) 1px, transparent 1px)", backgroundSize: "64px 64px" }} />

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 relative"
            style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.3)", boxShadow: "0 0 40px rgba(16,185,129,0.2)" }}>
            <TerminalSquare className="w-8 h-8" style={{ color: "#34d399" }} />
            <div className="absolute inset-0 rounded-2xl animate-ping opacity-20"
              style={{ background: "rgba(16,185,129,0.3)", animationDuration: "3s" }} />
          </div>
          <h1 className="text-4xl font-display font-extrabold tracking-tighter cyber-gradient-text">GHOST FLEET</h1>
          <p className="text-sm mt-1 font-display tracking-widest" style={{ color: "rgba(255,255,255,0.2)" }}>PRO · WORKSPACE ACCESS</p>
        </div>

        <AnimatePresence mode="wait">
          {/* CHOOSE screen */}
          {mode === "choose" && (
            <motion.div
              key="choose"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              className="space-y-3"
            >
              <button
                onClick={() => reset("create")}
                className="w-full p-5 rounded-2xl text-left flex items-center gap-4 group transition-all duration-300"
                style={{ background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.2)", boxShadow: "0 0 0 0 rgba(16,185,129,0.3)" }}
                onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 0 20px rgba(16,185,129,0.15)")}
                onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 0 0 0 rgba(16,185,129,0.3)")}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
                  <Plus className="w-6 h-6" style={{ color: "#34d399" }} />
                </div>
                <div>
                  <div className="font-display font-bold text-base" style={{ color: "#f0fdf4" }}>Create Workspace</div>
                  <div className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>Set up a new isolated workspace with your own accounts and rules</div>
                </div>
              </button>

              <button
                onClick={() => reset("login")}
                className="w-full p-5 rounded-2xl text-left flex items-center gap-4 group transition-all duration-300"
                style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)")}
                onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)")}
              >
                <div className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}>
                  <LogIn className="w-6 h-6" style={{ color: "rgba(255,255,255,0.5)" }} />
                </div>
                <div>
                  <div className="font-display font-bold text-base" style={{ color: "#f0fdf4" }}>Access Workspace</div>
                  <div className="text-sm mt-0.5" style={{ color: "rgba(255,255,255,0.35)" }}>Log into an existing workspace by name and password</div>
                </div>
              </button>

              <div className="pt-4 text-center">
                <p className="text-xs" style={{ color: "rgba(255,255,255,0.15)" }}>
                  Each workspace is isolated — accounts, rules and history are private to each workspace.
                </p>
              </div>
            </motion.div>
          )}

          {/* FORM screen (login or create) */}
          {(mode === "login" || mode === "create") && (
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
            >
              <div className="rounded-2xl overflow-hidden"
                style={{ background: "rgba(0,0,0,0.5)", border: "1px solid rgba(16,185,129,0.2)", backdropFilter: "blur(20px)" }}>
                {/* Header */}
                <div className="px-6 py-5 border-b flex items-center gap-3" style={{ borderColor: "rgba(16,185,129,0.1)" }}>
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)" }}>
                    {mode === "create" ? <Plus className="w-4 h-4" style={{ color: "#34d399" }} /> : <LogIn className="w-4 h-4" style={{ color: "#34d399" }} />}
                  </div>
                  <div>
                    <div className="font-display font-bold" style={{ color: "#f0fdf4" }}>
                      {mode === "create" ? "Create Workspace" : "Access Workspace"}
                    </div>
                    <div className="text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
                      {mode === "create" ? "Your personal Ghost Fleet operator environment" : "Enter your workspace credentials"}
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                  {/* Preview */}
                  <div className="px-4 py-3 rounded-xl flex items-center gap-2"
                    style={{ background: "rgba(16,185,129,0.05)", border: "1px solid rgba(16,185,129,0.1)" }}>
                    <div className="w-2 h-2 rounded-full status-dot-online flex-shrink-0" />
                    <span className="text-sm font-mono" style={{ color: "#34d399" }}>
                      ghostx<span style={{ color: name || mode === "login" ? "#86efac" : "rgba(255,255,255,0.2)" }}>{name || "yourname"}</span>
                      <span style={{ color: "rgba(255,255,255,0.3)" }}> signed in</span>
                    </span>
                  </div>

                  {/* Workspace Name */}
                  <div>
                    <label className="text-xs font-display tracking-widest uppercase mb-2 block" style={{ color: "rgba(16,185,129,0.6)" }}>
                      Workspace Name
                    </label>
                    <input
                      autoFocus
                      value={name}
                      onChange={e => { setName(e.target.value); setError(""); }}
                      placeholder="e.g. alpha, cryptoking, trader1"
                      className="w-full px-4 py-3 rounded-xl text-sm outline-none transition-all duration-200"
                      style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4", fontFamily: "var(--font-mono)" }}
                      onFocus={e => e.target.style.borderColor = "rgba(16,185,129,0.5)"}
                      onBlur={e => e.target.style.borderColor = "rgba(16,185,129,0.2)"}
                    />
                    {mode === "create" && (
                      <p className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>Letters, numbers, underscores and hyphens only</p>
                    )}
                  </div>

                  {/* Password */}
                  <div>
                    <label className="text-xs font-display tracking-widest uppercase mb-2 flex items-center gap-2" style={{ color: "rgba(16,185,129,0.6)" }}>
                      <Lock className="w-3 h-3" />
                      Password {mode === "create" && <span style={{ color: "rgba(255,255,255,0.2)", fontWeight: "normal", textTransform: "none", letterSpacing: "normal" }}>(optional)</span>}
                    </label>
                    <div className="relative">
                      <input
                        type={showPass ? "text" : "password"}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder={mode === "create" ? "Leave blank for no password" : "Enter password if required"}
                        className="w-full pl-4 pr-10 py-3 rounded-xl text-sm outline-none transition-all duration-200 font-mono"
                        style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(16,185,129,0.2)", color: "#f0fdf4" }}
                        onFocus={e => e.target.style.borderColor = "rgba(16,185,129,0.5)"}
                        onBlur={e => e.target.style.borderColor = "rgba(16,185,129,0.2)"}
                      />
                      <button type="button" onClick={() => setShowPass(!showPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: "rgba(255,255,255,0.3)" }}>
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Error */}
                  {error && (
                    <div className="px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#fca5a5" }}>
                      {error}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3 pt-1">
                    <button type="button" onClick={() => reset("choose")}
                      className="flex-1 py-3 rounded-xl text-sm font-display tracking-wide transition-all"
                      style={{ background: "rgba(255,255,255,0.04)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}>
                      Back
                    </button>
                    <button type="submit" disabled={loading || !name}
                      className="flex-2 flex-1 py-3 rounded-xl text-sm font-display tracking-wide font-semibold flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
                      style={{ background: "rgba(16,185,129,0.85)", color: "#000", boxShadow: "0 0 20px rgba(16,185,129,0.25)" }}>
                      {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Working...</> : mode === "create" ? <><Plus className="w-4 h-4" /> Create</> : <><LogIn className="w-4 h-4" /> Access</>}
                    </button>
                  </div>
                </form>
              </div>

              <p className="text-center text-xs mt-4" style={{ color: "rgba(255,255,255,0.15)" }}>
                Your workspace data is stored privately. Others cannot see your accounts or rules.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
