import { Switch, Route, Router as WouterRouter } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { WorkspaceProvider, useWorkspace } from "@/context/workspace";
import { LicenseGate } from "@/components/LicenseGate";
import NotFound from "@/pages/not-found";

import Dashboard from "./pages/dashboard";
import Accounts from "./pages/accounts";
import Rules from "./pages/rules";
import History from "./pages/history";
import Config from "./pages/config";
import WorkspaceGate from "./pages/workspace-gate";
import Admin from "./pages/admin";

function Router() {
  const { workspace } = useWorkspace();

  if (!workspace) {
    return <WorkspaceGate />;
  }

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/accounts" component={Accounts} />
      <Route path="/rules" component={Rules} />
      <Route path="/history" component={History} />
      <Route path="/config" component={Config} />
      <Route component={NotFound} />
    </Switch>
  );
}

const APP_BASE_PATH = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");

function App() {
  const isAdmin = window.location.pathname === `${APP_BASE_PATH}/admin` ||
    window.location.pathname.startsWith(`${APP_BASE_PATH}/admin/`);
  return (
    <QueryClientProvider client={queryClient}>
      {isAdmin ? (
        <Admin />
      ) : (
        <LicenseGate>
          <WorkspaceProvider>
            <TooltipProvider>
              <Toaster />
              <WouterRouter base={APP_BASE_PATH}>
                <Router />
              </WouterRouter>
            </TooltipProvider>
          </WorkspaceProvider>
        </LicenseGate>
      )}
    </QueryClientProvider>
  );
}

export default App;
