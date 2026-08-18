import { MongoClient, Db } from "mongodb";

if (!process.env.MONGODB_URI) {
  throw new Error("MONGODB_URI must be set.");
}

const client = new MongoClient(process.env.MONGODB_URI);

let _db: Db | null = null;
let _connecting: Promise<Db> | null = null;

export async function getDb(): Promise<Db> {
  if (_db) return _db;
  if (_connecting) return _connecting;
  _connecting = (async () => {
    await client.connect();
    const db = client.db("ghostfleet");
    await ensureIndexes(db);
    await migrateLegacyGuildDocuments(db);
    _db = db;
    console.log("[mongodb] connected to ghostfleet");
    return db;
  })();
  try {
    return await _connecting;
  } finally {
    _connecting = null;
  }
}

async function ensureIndexes(db: Db) {
  await db.collection("workspaces").createIndex({ name: 1 }, { unique: true });
  await db.collection("accounts").createIndex({ workspaceId: 1 });
  await db.collection("accounts").createIndex({ workspaceId: 1, status: 1 });
  await db.collection("rules").createIndex({ workspaceId: 1 });
  await db.collection("rules").createIndex({ workspaceId: 1, isActive: 1 });
  await db.collection("history").createIndex({ workspaceId: 1 });
  await db.collection("history").createIndex({ ts: -1 });
  await db.collection("history").createIndex({ workspaceId: 1, ts: -1 });
  await db.collection("licenses").createIndex({ fingerprint: 1 });
  // Cross-process dedup: TTL index auto-purges entries after 10 minutes.
  // _id is the dedup key (msgId:ruleId). Insert is the lock — duplicate
  // key error means another process already claimed it.
  await db.collection("processed_messages").createIndex(
    { ts: 1 },
    { expireAfterSeconds: 600 },
  );
  // Server roster — cross-workspace account presence tracker
  await db.collection("server_roster").createIndex(
    { guildId: 1, accountId: 1 },
    { unique: true },
  );
  await db.collection("server_roster").createIndex({ guildId: 1, joinedAt: 1 });
}

// Older deployments persisted the complete Discord /users/@me/guilds payload,
// which included very large permissions/features arrays. Migrate one document
// at a time on startup so the fix does not depend on a manual VPS shell step.
// The query becomes empty after the first successful run.
async function migrateLegacyGuildDocuments(db: Db): Promise<void> {
  const cursor = db.collection("accounts").find(
    {
      guilds: { $elemMatch: { $or: [
        { features: { $exists: true } },
        { permissions: { $exists: true } },
        { banner: { $exists: true } },
      ] } },
    },
    { projection: { _id: 1, guilds: 1 } },
  ).batchSize(1);
  let migrated = 0;
  for await (const doc of cursor) {
    const guilds = Array.isArray(doc.guilds)
      ? doc.guilds.map((guild: any) => ({ id: guild.id, name: guild.name, icon: guild.icon ?? null }))
      : [];
    await db.collection("accounts").updateOne(
      { _id: doc._id },
      { $set: { guilds } },
    );
    migrated++;
  }
  if (migrated > 0) {
    console.log(`[mongodb] slimmed guild data in ${migrated} legacy account document(s)`);
  } else {
    console.log("[mongodb] guild data migration complete — no legacy oversized documents found");
  }
}

// Auto-increment helper using a counters collection
export async function nextId(db: Db, name: string): Promise<number> {
  const result = await db.collection("counters").findOneAndUpdate(
    { _id: name as any },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return result!.seq as number;
}
