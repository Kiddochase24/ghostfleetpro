---
name: VPS deployment (ghostfleetpro-2)
description: How the production VPS runs Ghost Fleet Pro and how to deploy to it.
---

# VPS deployment — ghostfleetpro-2

Production runs on a self-managed VPS (root@69.164.247.105), not Replit Deployments.

- Repo checkout: `/root/ghostfleetpro-2`; app cwd `/root/ghostfleetpro-2/artifacts/ghostfleetpro`.
- pm2 process name `ghostfleetpro-2` (fork mode, port 5001, BASE_PATH=/).
- Node/pnpm are installed via **nvm** — non-interactive SSH shells don't have them on PATH; run `source ~/.nvm/nvm.sh` first or pnpm is "command not found".
- pm2 config: `artifacts/ghostfleetpro/ecosystem.config.cjs` (git-untracked, lives only on VPS). Env vars (incl. proxy, MONGODB_URI, OPENAI key, SMTP) are inlined there.
- The VPS package.json has extra proxy deps (socks, socks-proxy-agent, undici) not in the Replit workspace — these are VPS-local uncommitted changes; don't clobber them on merge (stash/pop around).

**Deploy flow:** GitHub push auth is unavailable from the Replit workspace. Push directly to the VPS repo over SSH: `git push ssh://root@HOST/root/ghostfleetpro-2 main:refs/heads/deploy -f`, then on VPS `git merge --ff-only deploy` (stash local changes first). Then: `pnpm install`, `NODE_ENV=production PORT=5001 BASE_PATH=/ pnpm --filter @workspace/ghostfleetpro run build`, `cd artifacts/ghostfleetpro && pm2 startOrReload ecosystem.config.cjs --env production --update-env`.

**Proxy lesson:** the shared single SOCKS5 proxy was the cause of constant 1006 gateway drops (all accounts dropped simultaneously when the tunnel hiccuped). Removed proxy → direct connections → zero closes. pm2 quirk: `--update-env` does NOT remove env vars deleted from the config — a `pm2 delete` + `pm2 start` is needed to clear stale env. proxy.ts supports per-account sticky sessions via `PROXY_USERNAME_TEMPLATE` (containing `{session}`) if a proxy is ever reinstated.

**Verify:** `curl localhost:5001/api/stats` → 200; `curl localhost:5001/api/console` shows healthy "RESUMED … session restored cleanly" and controlled "RECONNECT … attempt 1, 8s" (no storm).
