# Deploying AliVocab

AliVocab runs as one Docker container (the API also serves the web app) behind
[Caddy](https://caddyserver.com), which handles HTTPS. Everything the app stores (the SQLite
database, word pictures, cached audio and backups) lives on one Docker volume.

```
browser ──HTTPS──▶ caddy (:80, :443) ──▶ app (:3180) ──▶ /data volume
                                                          ├─ alivocab.db
                                                          ├─ media/      pictures, tts/ audio
                                                          └─ backups/    nightly database copies
```

## What you need

- A small Linux server (1 CPU and 1 GB RAM are enough) with
  [Docker Engine and the compose plugin](https://docs.docker.com/engine/install/).
- A domain or subdomain (e.g. `vocab.example.org`) with a DNS **A** (and **AAAA**, if the server
  has IPv6) record pointing at the server.
- Ports **80** and **443** open to the internet. Caddy uses them to get the Let's Encrypt
  certificate and to serve the app.

## First install

```bash
git clone <your repository URL> alivocab
cd alivocab
cp .env.example .env
```

Edit `.env`:

| Variable | Value |
|----------|-------|
| `DOMAIN` | Your domain, without `https://` (e.g. `vocab.example.org`) |
| `APP_ENCRYPTION_KEY` | `openssl rand -base64 32`. Encrypts saved API keys: **keep a copy somewhere safe**. Without it, saved keys can't be read after a restore. |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` (signs sessions) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | The first admin account |
| `PICTURES_CONTACT` | Your site URL or an email: Wikimedia asks for one and limits anonymous clients more |
| `PEXELS_API_KEY` | Optional, better photos of everyday things |

Leave `NODE_ENV`, `PORT`, `DATABASE_URL`, `MEDIA_DIR`, `BACKUP_DIR` and `BETTER_AUTH_URL` as they
are: `compose.yaml` sets the production values.

Start it:

```bash
docker compose up -d --build
docker compose logs -f app      # wait for "AliVocab listening", then Ctrl+C
```

Create the admin account and the first invite code:

```bash
docker compose exec app node dist/scripts/seed.js
```

Open `https://<your domain>`, sign in as the admin, and create invite codes for others in
**Admin → Invites**.

## Updating

```bash
cd alivocab
git pull
APP_VERSION=$(git describe --tags --always) docker compose up -d --build
```

Database migrations run automatically when the app starts. `https://<your domain>/api/health`
shows the running version: a release tag such as `v1.1.0`, or `v1.1.0-3-gabc1234` for commits after
it. What changed in each release is in [CHANGELOG.md](../CHANGELOG.md); read it before updating.
To go back to the previous release, check out its tag and build again (a release says so in the
changelog when that isn't possible). Installed apps (PWA) pick up the new version the next time they open.

## Backups

**Automatic:** every night at 03:00 (server time) the app writes a consistent copy of the
database to `/data/backups/alivocab-<date>T<time>Z.db` and deletes copies older than 14 days.
Change this with `BACKUP_HOUR` and `BACKUP_KEEP_DAYS` (`0` turns nightly backups off).

**Now:** before an update, or whenever you like:

```bash
docker compose exec app node dist/scripts/backup.js
```

**Off the server:** the backups sit on the same disk as the database, so copy them elsewhere
regularly, together with the pictures and audio (`media/`). For example, from your computer:

```bash
ssh you@server 'cd alivocab && docker compose exec -T app tar -C /data -czf - backups media' > alivocab-$(date +%F).tar.gz
```

Or on the server, with a cron job and a tool like [restic](https://restic.net) or
[rclone](https://rclone.org) pointed at the volume's folder (`docker volume inspect
alivocab_app-data` shows where it is).

Keep `.env` (above all `APP_ENCRYPTION_KEY`) somewhere safe as well. It isn't part of the backup.

### Restoring

```bash
docker compose stop app
# Copy the backup over the database (replace the file name), and remove the old WAL files.
docker compose run --rm --no-deps --entrypoint sh app -c \
  'cp /data/backups/alivocab-2026-10-09T030000Z.db /data/alivocab.db && rm -f /data/alivocab.db-wal /data/alivocab.db-shm'
docker compose start app
```

To restore on a new server, install as above with the **same `.env`**, start once, then copy
your `backups/` and `media/` into the volume (`docker compose cp`) and restore as shown.

## Logs and troubleshooting

- `docker compose logs -f app`: the app logs JSON lines (requests, errors, backups, picture
  lookups). `LOG_LEVEL=debug` in `.env` shows more.
- `docker compose logs -f caddy`: certificates and HTTPS.
- In the app, **Settings → Advanced → Activity log** shows each learner's requests, AI calls
  and problems.
- `docker compose ps`: the app should be `healthy`. Caddy waits for that before it starts.

| Problem | Check |
|---------|-------|
| Caddy can't get a certificate | DNS points at this server, ports 80/443 are open (also in your provider's firewall), `DOMAIN` has no `https://` |
| "Invalid environment configuration" on start | The log lists the missing or invalid variables in `.env` |
| Signing in fails or loops | `DOMAIN` must be the exact address you open in the browser (sign-in cookies are tied to it) |
| Role-play replies arrive all at once | Another proxy in front of Caddy (e.g. Cloudflare) is buffering; turn buffering off for `/api/roleplay/*` |
| Microsoft Edge voices stop working | That service is unofficial and Microsoft sometimes changes it. Pronunciation falls back to the browser's voices; update the app (`msedge-tts`) when a fix is out |
| Pictures don't arrive | Set `PICTURES_CONTACT`; Wikimedia limits anonymous clients. See the app log (`"area":"pictures"`) |

## Running without Caddy

If something else already terminates HTTPS on the server (nginx, Traefik, a tunnel), run only
the app and point your proxy at port 3180:

```bash
docker build -f docker/Dockerfile -t alivocab .
docker run -d --name alivocab --restart unless-stopped \
  --env-file .env -e BETTER_AUTH_URL=https://vocab.example.org \
  -v alivocab-data:/data -p 127.0.0.1:3180:3180 alivocab
```

Your proxy must not buffer responses from `/api/roleplay/*/messages` (they stream), and it
should pass `X-Forwarded-For` (used for sign-in rate limits).
