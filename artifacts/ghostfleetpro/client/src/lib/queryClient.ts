import { QueryClient, QueryFunction } from "@tanstack/react-query";

export function appUrl(path: string): string {
  const base = (import.meta.env.BASE_URL || "/").replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalizedPath}`;
}

// Get workspace ID from localStorage for all requests
export function getWorkspaceId(): string | null {
  try {
    const ws = localStorage.getItem("gf_workspace");
    if (ws) return JSON.parse(ws).id?.toString() ?? null;
  } catch {}
  return null;
}

function getWorkspaceHeaders(): Record<string, string> {
  const wsId = getWorkspaceId();
  return wsId ? { "X-Workspace-Id": wsId } : {};
}

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // 30s hard timeout — a slow/hung server must surface an error instead of
  // leaving buttons (e.g. "Update Rule") spinning forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(appUrl(url), {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...getWorkspaceHeaders(),
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      signal: controller.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("Request timed out after 30s — the server may be overloaded. Try again.");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey[0] as string;
    const extra = queryKey.slice(1).join("/");
    const fullUrl = extra ? `${url}/${extra}` : url;

    const res = await fetch(appUrl(fullUrl), {
      credentials: "include",
      headers: getWorkspaceHeaders(),
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
