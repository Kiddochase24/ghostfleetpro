import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { z } from "zod";

export function useConfig() {
  return useQuery({
    queryKey: [api.config.list.path],
    queryFn: async () => {
      const res = await fetch(api.config.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch config");
      return api.config.list.responses[200].parse(await res.json());
    },
  });
}

export function useUpdateConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: z.infer<typeof api.config.update.input>) => {
      const res = await fetch(api.config.update.path, {
        method: api.config.update.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to update config");
      return api.config.update.responses[200].parse(await res.json());
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [api.config.list.path] }),
  });
}
