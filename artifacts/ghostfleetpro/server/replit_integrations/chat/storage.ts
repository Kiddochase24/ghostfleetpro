import { getDb, nextId } from "../../db";
import type { Conversation, Message } from "@shared/models/chat";

export interface IChatStorage {
  getConversation(id: number): Promise<Conversation | undefined>;
  getAllConversations(): Promise<Conversation[]>;
  createConversation(title: string): Promise<Conversation>;
  deleteConversation(id: number): Promise<void>;
  getMessagesByConversation(conversationId: number): Promise<Message[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<Message>;
}

function clean<T>(doc: any): T {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest as T;
}

export const chatStorage: IChatStorage = {
  async getConversation(id: number) {
    const db = await getDb();
    const doc = await db.collection("conversations").findOne({ id });
    return doc ? clean<Conversation>(doc) : undefined;
  },

  async getAllConversations() {
    const db = await getDb();
    const docs = await db.collection("conversations").find().sort({ createdAt: -1 }).toArray();
    return docs.map(d => clean<Conversation>(d));
  },

  async createConversation(title: string) {
    const db = await getDb();
    const id = await nextId(db, "conversations");
    const doc: Conversation = { id, title, createdAt: new Date() };
    await db.collection("conversations").insertOne({ ...doc });
    return doc;
  },

  async deleteConversation(id: number) {
    const db = await getDb();
    await db.collection("messages").deleteMany({ conversationId: id });
    await db.collection("conversations").deleteOne({ id });
  },

  async getMessagesByConversation(conversationId: number) {
    const db = await getDb();
    const docs = await db.collection("messages").find({ conversationId }).sort({ createdAt: 1 }).toArray();
    return docs.map(d => clean<Message>(d));
  },

  async createMessage(conversationId: number, role: string, content: string) {
    const db = await getDb();
    const id = await nextId(db, "messages");
    const doc: Message = { id, conversationId, role, content, createdAt: new Date() };
    await db.collection("messages").insertOne({ ...doc });
    return doc;
  },
};
