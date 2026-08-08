import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard, Users, ShieldAlert, History as HistoryIcon,
  Settings, TerminalSquare, ChevronLeft, ChevronRight,
  Activity, LogOut, UserCircle2, Menu, X
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { useWorkspace } from "@/context/workspace";
import { useIsMobile } from "@/hooks/use-mobile";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/accounts", label: "Account Access", icon: Users },
  { href: "/rules", label: "Rule Manager", icon: ShieldAlert },
  { href: "/history", label: "Response History", icon: HistoryIcon },
  { href: "/config", label: "Configuration", icon: Settings },
];

function SidebarContent({
  collapsed,
  onNavClick,
}: {
  collapsed: boolean;
  onNavClick?: () => void;
}) {
  const [location] = useLocation();
  const { workspace, logout } = useWorkspace();
  const { data: stats } = useQuery<any>({ queryKey: ["/api/stats"], refetchInterval: 3000 });

  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 flex-shrink-0">
        <div className="relative flex-shrink-0">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
            <TerminalSquare className="w-6 h-6" style={{ color: "#34d399" }} />
          </div>
          <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full status-dot-online border-2 border-black" />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden min-w-0"
            >
              <div className="font-display font-extrabold text-xl tracking-tighter leading-none cyber-gradient-text">GHOST</div>
              <div className="font-display font-bold text-xs tracking-widest leading-none mt-0.5" style={{ color: "rgba(255,255,255,0.25)" }}>FLEET PRO</div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Workspace badge */}
      <AnimatePresence>
        {!collapsed && workspace && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="mx-3 mb-3 px-3 py-2 rounded-xl"
            style={{ background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.15)" }}
          >
            <div className="flex items-center gap-2">
              <UserCircle2 className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "rgba(16,185,129,0.6)" }} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-mono truncate" style={{ color: "#34d399" }}>ghostx{workspace.name}</div>
                <div className="text-xs" style={{ color: "rgba(255,255,255,0.2)" }}>signed in</div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mx-3 mb-3 h-px" style={{ background: "linear-gradient(to right, transparent, rgba(16,185,129,0.2), transparent)" }} />

      {/* Nav */}
      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const isActive = location === item.href;
          return (
            <Link key={item.href} href={item.href}>
              <div
                onClick={onNavClick}
                className="flex items-center gap-3 px-3 py-3 rounded-xl transition-all duration-200 cursor-pointer relative group"
                style={{
                  background: isActive ? "rgba(16,185,129,0.1)" : "transparent",
                  color: isActive ? "#34d399" : "rgba(255,255,255,0.4)",
                }}
                title={collapsed ? item.label : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="sidebar-active"
                    className="absolute left-0 top-1/4 bottom-1/4 w-0.5 rounded-r"
                    style={{ background: "#10b981", boxShadow: "0 0 10px rgba(16,185,129,0.8)" }}
                  />
                )}
                <item.icon className="w-5 h-5 flex-shrink-0" style={{ filter: isActive ? "drop-shadow(0 0 6px rgba(16,185,129,0.8))" : undefined }} />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                      transition={{ duration: 0.15 }}
                      className="font-display tracking-wide text-sm whitespace-nowrap"
                      style={{ fontWeight: isActive ? 600 : 400 }}
                    >
                      {item.label}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* System stats */}
      <AnimatePresence>
        {!collapsed && stats && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="mx-3 mb-2 p-3 rounded-xl"
            style={{ background: "rgba(16,185,129,0.04)", border: "1px solid rgba(16,185,129,0.08)" }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Activity className="w-3 h-3" style={{ color: "#34d399" }} />
              <span className="text-xs font-display tracking-widest" style={{ color: "rgba(16,185,129,0.5)" }}>SYSTEM</span>
            </div>
            <div className="space-y-1 text-xs font-mono">
              {[["CPU", `${stats?.cpu ?? 0}%`], ["MEM", `${stats?.mem ?? 0}%`], ["NODES", `${stats?.connectedAccounts ?? 0}`]].map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span style={{ color: "rgba(255,255,255,0.25)" }}>{k}</span>
                  <span style={{ color: "#34d399" }}>{v}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logout */}
      <div className="px-2 pb-4 flex-shrink-0">
        <button
          onClick={() => { if (confirm("Sign out of this workspace?")) logout(); }}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200"
          style={{ color: "rgba(239,68,68,0.5)" }}
          title={collapsed ? "Sign Out" : undefined}
        >
          <LogOut className="w-5 h-5 flex-shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="font-display text-sm tracking-wide whitespace-nowrap">
                Sign Out
              </motion.span>
            )}
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const { workspace } = useWorkspace();

  const sidebarStyle = {
    background: "rgba(0,0,0,0.85)",
    backdropFilter: "blur(24px)",
    borderColor: "rgba(16,185,129,0.1)",
    boxShadow: "10px 0 30px rgba(0,0,0,0.5), inset -1px 0 0 rgba(16,185,129,0.05)",
  };

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "hsl(160, 50%, 2%)" }}>

      {/* ── MOBILE ── */}
      {isMobile && (
        <>
          {/* Sticky top bar */}
          <div
            className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 h-14 border-b flex-shrink-0"
            style={{ background: "rgba(0,0,0,0.9)", backdropFilter: "blur(16px)", borderColor: "rgba(16,185,129,0.1)" }}
          >
            <button
              onClick={() => setMobileOpen(true)}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.2)", color: "#34d399" }}
            >
              <Menu className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)" }}>
                <TerminalSquare className="w-4 h-4" style={{ color: "#34d399" }} />
              </div>
              <span className="font-display font-extrabold text-base tracking-tighter cyber-gradient-text">GHOST FLEET PRO</span>
            </div>

            <div className="w-9 h-9 flex items-center justify-center">
              <div className="w-2 h-2 rounded-full status-dot-online" />
            </div>
          </div>

          {/* Drawer backdrop */}
          <AnimatePresence>
            {mobileOpen && (
              <motion.div
                key="backdrop"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileOpen(false)}
                className="fixed inset-0 z-40"
                style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
              />
            )}
          </AnimatePresence>

          {/* Drawer */}
          <AnimatePresence>
            {mobileOpen && (
              <motion.div
                key="drawer"
                initial={{ x: -280 }}
                animate={{ x: 0 }}
                exit={{ x: -280 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className="fixed left-0 top-0 bottom-0 z-50 w-[260px] border-r overflow-hidden"
                style={sidebarStyle}
              >
                {/* Close button */}
                <button
                  onClick={() => setMobileOpen(false)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-lg flex items-center justify-center z-10"
                  style={{ background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.4)" }}
                >
                  <X className="w-4 h-4" />
                </button>
                <SidebarContent collapsed={false} onNavClick={() => setMobileOpen(false)} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Page content below top bar */}
          <main className="flex-1 overflow-y-auto relative min-w-0 pt-14 w-full">
            <motion.div
              key={location}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.25 }}
            >
              {children}
            </motion.div>
          </main>
        </>
      )}

      {/* ── DESKTOP ── */}
      {!isMobile && (
        <>
          <motion.aside
            animate={{ width: collapsed ? "72px" : "260px" }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="relative z-30 flex flex-col overflow-hidden border-r flex-shrink-0"
            style={sidebarStyle}
          >
            <SidebarContent collapsed={collapsed} />

            {/* Collapse toggle */}
            <button
              onClick={() => setCollapsed(!collapsed)}
              className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center z-50 transition-all duration-200"
              style={{ background: "rgba(16,185,129,0.2)", border: "1px solid rgba(16,185,129,0.4)", color: "#34d399" }}
            >
              {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
            </button>
          </motion.aside>

          <main className="flex-1 overflow-y-auto relative min-w-0">
            <motion.div
              key={location}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.25 }}
              className="h-full"
            >
              {children}
            </motion.div>
          </main>
        </>
      )}
    </div>
  );
}
