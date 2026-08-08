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
  await db.collection("rules").createIndex({ workspaceId: 1 });
  await db.collection("history").createIndex({ workspaceId: 1 });
  await db.collection("history").createIndex({ ts: -1 });
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

// Auto-increment helper using a counters collection
export async function nextId(db: Db, name: string): Promise<number> {
  const result = await db.collection("counters").findOneAndUpdate(
    { _id: name as any },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return result!.seq as number;
}
