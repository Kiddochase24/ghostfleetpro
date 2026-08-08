import { Switch, Route } from "wouter";
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


function App() {
  const isAdmin = window.location.pathname.startsWith("/admin");
  return (
    <QueryClientProvider client={queryClient}>
      {isAdmin ? (
        <Admin />
      ) : (
        <LicenseGate>
          <WorkspaceProvider>
            <TooltipProvider>
              <Toaster />
              <Router />
            </TooltipProvider>
          </WorkspaceProvider>
        </LicenseGate>
      )}
    </QueryClientProvider>
  );
}

export default App;
