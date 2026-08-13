import { useState, useEffect } from "react";
import { getDeviceFingerprint, getCachedLicenseState, setCachedLicenseState } from "@/lib/device";
import { Shield, KeyRound, Loader2, CheckCircle2, Lock, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { appUrl } from "@/lib/queryClient";

type State = "checking" | "locked" | "unlocked" | "activating" | "error";

export function LicenseGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>("checking");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [fingerprint, setFingerprint] = useState("");

  useEffect(() => {
    (async () => {
      const fp = await getDeviceFingerprint();
      setFingerprint(fp);

      // If cached as licensed, do a fast background verify
      if (getCachedLicenseState()) {
        setState("unlocked");
        // Silently verify in background
          fetch(appUrl("/api/license/check"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint: fp }),
        })
          .then(r => r.json())
          .then(d => {
            if (!d.licensed) {
              setCachedLicenseState(false);
              setState("locked");
            }
          })
          .catch(() => {});
        return;
      }

      // No cache — must check server (8s timeout so a slow/blocked DB doesn't hang forever)
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const res = await fetch(appUrl("/api/license/check"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fingerprint: fp }),
          signal: controller.signal,
        });
        clearTimeout(timer);
        const data = await res.json();
        if (data.licensed) {
          setCachedLicenseState(true);
          setState("unlocked");
        } else {
          setState("locked");
        }
      } catch {
        // Network error or timeout — show locked so user can enter key
        setState("locked");
      }
    })();
  }, []);

  const activate = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setState("activating");
    setError("");

    try {
      const res = await fetch(appUrl("/api/license/activate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed, fingerprint }),
      });
      const data = await res.json();
      if (data.success) {
        setCachedLicenseState(true);
        setState("unlocked");
      } else {
        setError(data.message || "Invalid license code.");
        setState("locked");
      }
    } catch {
      setError("Network error. Please try again.");
      setState("locked");
    }
  };

  if (state === "unlocked") return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(16,185,129,0.06) 0%, #030b06 70%)" }}>

      {/* Animated grid background */}
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: "linear-gradient(rgba(16,185,129,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.04) 1px, transparent 1px)",
        backgroundSize: "40px 40px"
      }} />

      {/* Glow blobs */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(16,185,129,0.08) 0%, transparent 70%)", filter: "blur(40px)" }} />
      <div className="absolute bottom-1/4 right-1/4 w-64 h-64 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, rgba(52,211,153,0.05) 0%, transparent 70%)", filter: "blur(40px)" }} />

      <AnimatePresence mode="wait">
        {state === "checking" && (
          <motion.div key="checking"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-2"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)" }}>
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: "#10b981" }} />
            </div>
            <p className="font-display text-sm tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.6)" }}>
              Verifying Device License...
            </p>
          </motion.div>
        )}

        {(state === "locked" || state === "activating" || state === "error") && (
          <motion.div key="gate"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="w-full max-w-md mx-4">

            {/* Card */}
            <div className="rounded-3xl overflow-hidden"
              style={{
                background: "rgba(0,0,0,0.6)",
                backdropFilter: "blur(24px)",
                border: "1px solid rgba(16,185,129,0.2)",
                boxShadow: "0 0 60px rgba(16,185,129,0.08), 0 0 0 1px rgba(16,185,129,0.05)"
              }}>

              {/* Header bar */}
              <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #10b981, #34d399, #10b981)" }} />

              <div className="p-8">
                {/* Logo / icon */}
                <div className="flex flex-col items-center mb-8">
                  <div className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4 relative"
                    style={{ background: "rgba(16,185,129,0.08)", border: "1px solid rgba(16,185,129,0.25)" }}>
                    <Shield className="w-10 h-10" style={{ color: "#10b981" }} />
                    <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                      style={{ background: "#ef4444", border: "2px solid #030b06" }}>
                      <Lock className="w-2.5 h-2.5 text-white" />
                    </div>
                  </div>
                  <h1 className="font-display text-2xl font-bold tracking-tight mb-1" style={{ color: "#f0fdf4" }}>
                    GHOST FLEET PRO
                  </h1>
                  <p className="text-xs font-display tracking-widest uppercase" style={{ color: "rgba(16,185,129,0.5)" }}>
                    Licensed Access Required
                  </p>
                </div>

                {/* Device lock notice */}
                <div className="rounded-xl p-3 mb-6 flex items-start gap-3"
                  style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                  <Lock className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: "#ef4444" }} />
                  <div>
                    <p className="text-xs font-semibold mb-0.5" style={{ color: "#ef4444" }}>Device Not Licensed</p>
                    <p className="text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
                      This device requires a valid license key to access Ghost Fleet Pro. Each license is bound to one device.
                    </p>
                  </div>
                </div>

                {/* License input */}
                <div className="space-y-3">
                  <label className="text-xs font-display tracking-widest uppercase block" style={{ color: "rgba(16,185,129,0.5)" }}>
                    License Key
                  </label>
                  <div className="relative">
                    <KeyRound className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "rgba(16,185,129,0.4)" }} />
                    <input
                      value={code}
                      onChange={e => setCode(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === "Enter" && activate()}
                      placeholder="XXXX-XXXX-XXXX-XXXX"
                      className="w-full pl-11 pr-4 py-4 rounded-xl text-sm font-mono outline-none transition-all duration-200 tracking-widest"
                      style={{
                        background: "rgba(0,0,0,0.5)",
                        border: `1px solid ${error ? "rgba(239,68,68,0.4)" : "rgba(16,185,129,0.2)"}`,
                        color: "#f0fdf4",
                      }}
                      onFocus={e => { if (!error) e.target.style.borderColor = "rgba(16,185,129,0.6)"; }}
                      onBlur={e => { if (!error) e.target.style.borderColor = "rgba(16,185,129,0.2)"; }}
                      disabled={state === "activating"}
                    />
                  </div>

                  <AnimatePresence>
                    {error && (
                      <motion.p
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        className="text-xs px-1"
                        style={{ color: "#ef4444" }}>
                        {error}
                      </motion.p>
                    )}
                  </AnimatePresence>

                  <button
                    onClick={activate}
                    disabled={state === "activating" || !code.trim()}
                    className="w-full py-4 rounded-xl font-display tracking-widest text-sm font-bold transition-all duration-200 disabled:opacity-50 flex items-center justify-center gap-2"
                    style={{ background: "linear-gradient(135deg, #10b981, #059669)", color: "#000" }}>
                    {state === "activating" ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Activating...</>
                    ) : (
                      <><Zap className="w-4 h-4" /> Activate License</>
                    )}
                  </button>
                </div>

                {/* Footer */}
                <div className="mt-6 pt-6 border-t" style={{ borderColor: "rgba(255,255,255,0.05)" }}>
                  <a
                    href="https://ghostfleet.netlify.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-3 rounded-xl text-sm font-display tracking-wide transition-all duration-200"
                    style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.5)" }}
                  >
                    Purchase a license at ghostfleet.netlify.app
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
