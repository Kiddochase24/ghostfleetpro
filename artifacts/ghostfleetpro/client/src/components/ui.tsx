import React, { forwardRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X } from "lucide-react";

export const GlassCard = ({ children, className = "", hover = false }: { children: React.ReactNode, className?: string, hover?: boolean }) => (
  <div className={`glass-panel rounded-2xl ${hover ? 'glass-panel-hover' : ''} ${className}`}>
    {children}
  </div>
);

export const NeonButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'danger' | 'ghost' }>(
  ({ children, className = "", variant = 'primary', ...props }, ref) => {
    const variants = {
      primary: "bg-emerald-500/10 text-emerald-400 border-emerald-500/50 hover:bg-emerald-500/20 hover:shadow-[0_0_20px_rgba(16,185,129,0.3)]",
      danger: "bg-red-500/10 text-red-400 border-red-500/50 hover:bg-red-500/20 hover:shadow-[0_0_20px_rgba(239,68,68,0.3)]",
      ghost: "bg-transparent text-emerald-200 border-transparent hover:bg-white/5 hover:text-emerald-400"
    };
    
    return (
      <button
        ref={ref}
        className={`border px-5 py-2.5 rounded-xl font-display font-semibold tracking-widest uppercase transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}
        {...props}
      >
        {children}
      </button>
    );
  }
);
NeonButton.displayName = "NeonButton";

export const CyberInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className = "", ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={`w-full bg-black/50 border border-emerald-500/20 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 rounded-xl px-4 py-3 text-emerald-50 placeholder:text-emerald-800/60 outline-none transition-all duration-300 font-sans shadow-inner ${className}`}
        {...props}
      />
    );
  }
);
CyberInput.displayName = "CyberInput";

export const CyberSelect = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = "", children, ...props }, ref) => {
    return (
      <select
        ref={ref}
        className={`w-full bg-[#030a07] border border-emerald-500/30 focus:border-emerald-400 focus:ring-1 focus:ring-emerald-500/50 rounded-xl px-4 py-3 text-emerald-100 outline-none transition-all duration-300 font-sans appearance-none ${className}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);
CyberSelect.displayName = "CyberSelect";

export const CyberSwitch = ({ checked, onChange }: { checked: boolean, onChange: (v: boolean) => void }) => (
  <button
    type="button"
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-7 w-14 items-center rounded-full transition-all duration-400 ${
      checked ? 'bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.6)]' : 'bg-black/60 border border-emerald-500/30'
    }`}
  >
    <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform duration-400 ${
      checked ? 'translate-x-8 shadow-[0_0_10px_rgba(255,255,255,0.8)]' : 'translate-x-1 opacity-50'
    }`} />
  </button>
);

export const CyberModal = ({ isOpen, onClose, title, children }: { isOpen: boolean, onClose: () => void, title: string, children: React.ReactNode }) => {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/80 backdrop-blur-md"
            onClick={onClose}
          />
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="relative w-full max-w-2xl glass-panel border-emerald-500/40 rounded-2xl shadow-[0_0_50px_rgba(16,185,129,0.15)] overflow-hidden flex flex-col max-h-[90vh]"
          >
            <div className="p-6 border-b border-emerald-500/20 flex justify-between items-center bg-emerald-950/20">
              <h2 className="text-2xl font-display font-bold cyber-gradient-text">{title}</h2>
              <button onClick={onClose} className="text-emerald-500/60 hover:text-emerald-400 transition-colors p-2 rounded-full hover:bg-emerald-500/10">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto">
              {children}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export const PageHeader = ({ title, subtitle, action }: { title: string, subtitle?: string, action?: React.ReactNode }) => (
  <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8 relative">
    <div className="absolute -left-8 top-0 bottom-0 w-1 bg-emerald-500/50 shadow-[0_0_10px_rgba(16,185,129,1)] rounded-r" />
    <div>
      <h1 className="text-4xl font-display font-bold text-emerald-50 tracking-tight">{title}</h1>
      {subtitle && <p className="text-emerald-400/60 mt-1 font-sans text-lg">{subtitle}</p>}
    </div>
    {action && <div>{action}</div>}
  </div>
);
