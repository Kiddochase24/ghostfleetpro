import { z } from 'zod';
import { insertAccountSchema, accounts, rules, insertRuleSchema, history, config } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  accounts: {
    list: {
      method: 'GET' as const,
      path: '/api/accounts' as const,
      responses: {
        200: z.array(z.custom<typeof accounts.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/accounts' as const,
      input: z.object({ token: z.string(), name: z.string() }),
      responses: {
        201: z.custom<typeof accounts.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/accounts/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  rules: {
    list: {
      method: 'GET' as const,
      path: '/api/rules' as const,
      responses: {
        200: z.array(z.custom<typeof rules.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/rules' as const,
      input: insertRuleSchema,
      responses: {
        201: z.custom<typeof rules.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/rules/:id' as const,
      input: insertRuleSchema.partial(),
      responses: {
        200: z.custom<typeof rules.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/rules/:id' as const,
      responses: {
        204: z.void(),
        404: errorSchemas.notFound,
      },
    },
  },
  history: {
    list: {
      method: 'GET' as const,
      path: '/api/history' as const,
      responses: {
        200: z.array(z.custom<typeof history.$inferSelect>()),
      },
    },
  },
  config: {
    list: {
      method: 'GET' as const,
      path: '/api/config' as const,
      responses: {
        200: z.record(z.string()),
      },
    },
    update: {
      method: 'POST' as const,
      path: '/api/config' as const,
      input: z.object({
        telegram_enabled: z.string().optional(),
        telegram_token: z.string().optional(),
        telegram_chat_id: z.string().optional(),
      }),
      responses: {
        200: z.object({ success: z.boolean() }),
      },
    },
  },
  stats: {
    get: {
      method: 'GET' as const,
      path: '/api/stats' as const,
      responses: {
        200: z.object({
          activeRules: z.number(),
          totalLogs: z.number(),
          autoReplies: z.number(),
          totalRules: z.number(),
        })
      }
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
