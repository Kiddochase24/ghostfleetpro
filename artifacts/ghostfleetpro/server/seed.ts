import { db } from './db';
import { accounts, rules, history, config } from '../shared/schema';

async function seed() {
  const existingAccs = await db.select().from(accounts);
  if (existingAccs.length === 0) {
    await db.insert(accounts).values([
      { id: "10123456789", name: "Main Profile", token: "MTEw...", status: "Connected", avatar: "https://cdn.discordapp.com/embed/avatars/0.png" },
      { id: "20123456789", name: "Backup Bot", token: "MTEw...", status: "Disconnected", avatar: "https://cdn.discordapp.com/embed/avatars/1.png" }
    ]);
    console.log("Seeded accounts.");
  }
  
  const existingRules = await db.select().from(rules);
  if (existingRules.length === 0) {
    await db.insert(rules).values([
      { label: "Crypto Help AI", triggerCondition: "AI Analysis", keyword: "", profileId: "all", serverId: "all", channelId: "all", actionType: "Text Reply", message: "It looks like you need help with crypto. Check our official guide.", delay: 5, isActive: true },
      { label: "Keyword Mod", triggerCondition: "Keyword Match", keyword: "scam", profileId: "10123456789", serverId: "789101112", channelId: "all", actionType: "Embed", message: "Please avoid using banned words.", delay: 0, isActive: true }
    ]);
    console.log("Seeded rules.");
  }

  const existingHistory = await db.select().from(history);
  if (existingHistory.length === 0) {
    await db.insert(history).values([
      { accName: "Main Profile", srvName: "Crypto Traders", chanName: "general", target: "user123", msg: "It looks like you need help with crypto. Check our official guide." },
      { accName: "Backup Bot", srvName: "DeFi Lounge", chanName: "support", target: "crypto_fan", msg: "Please verify your wallet first." }
    ]);
    console.log("Seeded history.");
  }
}

seed().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
