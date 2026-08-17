/**
 * One-time migration: slim existing guild data in MongoDB.
 *
 * Every account document may hold full Discord guild objects that include
 * `features[]`, `permissions`, `owner`, etc.  Only `id` and `name` are ever
 * read at runtime.  This script strips each account's guilds array to
 * `{ id, name }` pairs in a single bulk-write pass.
 *
 * Run once on the VPS:
 *   MONGODB_URI=<uri> npx tsx artifacts/ghostfleetpro/scripts/migrate-slim-guilds.ts
 *
 * Or trigger via the admin API endpoint (no restart required):
 *   POST /api/admin/migrate-slim-guilds   Header: x-admin-key: <ADMIN_SECRET>
 *
 * The script is idempotent — running it multiple times is safe.
 */

import { MongoClient } from "mongodb";

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("ERROR: MONGODB_URI environment variable is not set.");
  process.exit(1);
}

async function run() {
  const client = new MongoClient(MONGODB_URI!);
  try {
    await client.connect();
    console.log("[migrate] Connected to MongoDB.");

    const db = client.db("ghostfleet");
    const accounts = db.collection("accounts");

    const cursor = accounts.find({});
    let checked = 0;
    let updated = 0;
    let skipped = 0;

    const bulkOps: any[] = [];

    while (await cursor.hasNext()) {
      const doc = await cursor.next();
      if (!doc) continue;
      checked++;

      const guilds: any[] = doc.guilds ?? [];
      if (!Array.isArray(guilds) || guilds.length === 0) {
        skipped++;
        continue;
      }

      // Check if any guild has keys beyond id + name
      const needsSlim = guilds.some((g) => Object.keys(g).some((k) => k !== "id" && k !== "name"));
      if (!needsSlim) {
        skipped++;
        continue;
      }

      const slim = guilds.map((g: any) => ({ id: g.id, name: g.name }));
      bulkOps.push({
        updateOne: {
          filter: { _id: doc._id },
          update: { $set: { guilds: slim } },
        },
      });
      updated++;
    }

    await cursor.close();

    if (bulkOps.length > 0) {
      await accounts.bulkWrite(bulkOps, { ordered: false });
    }

    console.log(`[migrate] Done. Checked: ${checked}, Updated: ${updated}, Skipped (already slim): ${skipped}`);
    return { checked, updated, skipped };
  } finally {
    await client.close();
  }
}

run().catch((err) => {
  console.error("[migrate] Fatal error:", err);
  process.exit(1);
});
