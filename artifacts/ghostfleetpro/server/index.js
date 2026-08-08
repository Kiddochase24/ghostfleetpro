import express from 'express';
import WebSocket from 'ws';
import axios from 'axios';
import Database from 'better-sqlite3';
import cors from 'cors';

const app = express();
const db = new Database('ghost_fleet.db');

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, name TEXT, token TEXT);
  CREATE TABLE IF NOT EXISTS rules (id TEXT PRIMARY KEY, account_id TEXT, guild_id TEXT, keyword TEXT, reply TEXT);
`);

app.use(cors());
app.use(express.json());

let ACTIVE_NODES = new Map();

// --- DISCORD NODE CLASS ---
class GhostNode {
    constructor(id, token) {
        this.id = id;
        this.token = token;
        this.ws = null;
    }

    connect() {
        this.ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');

        this.ws.on('open', () => {
            this.ws.send(JSON.stringify({
                op: 2,
                d: {
                    token: this.token,
                    properties: { os: 'Windows', browser: 'Chrome', device: '' }
                }
            }));
        });

        this.ws.on('message', (data) => {
            const msg = JSON.parse(data);
            if (msg.op === 10) {
                setInterval(() => this.ws.send(JSON.stringify({ op: 1, d: null })), msg.d.heartbeat_interval);
            }
        });
    }
}

// --- API ROUTES ---
app.get('/api/accounts', (req, res) => {
    res.json(db.prepare('SELECT * FROM accounts').all());
});

app.post('/api/login', async (req, res) => {
    const { token, name } = req.body;
    try {
        const dRes = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: token }});
        db.prepare('INSERT OR REPLACE INTO accounts VALUES (?, ?, ?)').run(dRes.data.id, name, token);

        const node = new GhostNode(dRes.data.id, token);
        node.connect();
        ACTIVE_NODES.set(dRes.data.id, node);

        res.json(dRes.data);
    } catch (e) { 
        res.status(401).json({ error: "Unauthorized" }); 
    }
});

app.get('/api/guilds/:id', async (req, res) => {
    const acc = db.prepare('SELECT token FROM accounts WHERE id = ?').get(req.params.id);
    if (!acc) return res.status(404).json({ error: "Account not found" });

    const gRes = await axios.get('https://discord.com/api/v10/users/@me/guilds', { headers: { Authorization: acc.token }});
    res.json(gRes.data);
});

app.get('/api/guilds/:id/map', async (req, res) => {
    const acc = db.prepare('SELECT token FROM accounts WHERE id = ?').get(req.params.id);
    if (!acc) return res.status(404).json({ error: "Account not found" });

    try {
        const cRes = await axios.get(`https://discord.com/api/v10/guilds/${req.query.guildId}/channels`, { 
            headers: { Authorization: acc.token }
        });

        const channels = cRes.data;
        const categories = channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position);

        const map = categories.map(cat => ({
            ...cat,
            children: channels.filter(c => c.parent_id === cat.id && c.type === 0).sort((a, b) => a.position - b.position)
        }));

        const orphans = channels.filter(c => !c.parent_id && c.type === 0);
        if (orphans.length > 0) {
            map.unshift({ name: "Uncategorized", id: "0", children: orphans });
        }

        res.json(map);
    } catch (e) {
        res.status(500).json({ error: "Failed to map server topology" });
    }
});

app.listen(8080, () => console.log("🚀 Ghost Fleet Backend Live on 8080"));