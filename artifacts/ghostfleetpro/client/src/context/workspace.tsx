import { createContext, useContext, useState, useCallback } from "react";

export interface WorkspaceInfo {
  id: number;
  name: string;
  createdAt?: string;
}

interface WorkspaceCtx {
  workspace: WorkspaceInfo | null;
  setWorkspace: (ws: WorkspaceInfo | null) => void;
  logout: () => void;
}

const WorkspaceContext = createContext<WorkspaceCtx>({
  workspace: null,
  setWorkspace: () => {},
  logout: () => {},
});

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspaceState] = useState<WorkspaceInfo | null>(() => {
    try {
      const stored = localStorage.getItem("gf_workspace");
      return stored ? JSON.parse(stored) : null;
    } catch {
      return null;
    }
  });

  const setWorkspace = useCallback((ws: WorkspaceInfo | null) => {
    setWorkspaceState(ws);
    if (ws) {
      localStorage.setItem("gf_workspace", JSON.stringify(ws));
    } else {
      localStorage.removeItem("gf_workspace");
    }
  }, []);

  const logout = useCallback(() => {
    setWorkspace(null);
    // Clear all query cache on logout
    window.location.reload();
  }, [setWorkspace]);

  return (
    <WorkspaceContext.Provider value={{ workspace, setWorkspace, logout }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  return useContext(WorkspaceContext);
}
