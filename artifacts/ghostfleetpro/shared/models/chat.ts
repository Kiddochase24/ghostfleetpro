import { z } from "zod";

export interface Conversation {
  id: number;
  title: string;
  createdAt: Date;
}

export interface Message {
  id: number;
  conversationId: number;
  role: string;
  content: string;
  createdAt: Date;
}

export type InsertConversation = { title: string };
export type InsertMessage = { conversationId: number; role: string; content: string };

export const insertConversationSchema = z.object({ title: z.string() });
export const insertMessageSchema = z.object({
  conversationId: z.number(),
  role:           z.string(),
  content:        z.string(),
});
