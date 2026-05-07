# Continental Status

Public status page for user-facing Continental services.

## Run locally

```bash
npm install
npm run dev
```

The committed example environment uses `PORT=3003` to match the production Caddy reverse proxy. If `.env` is absent, the server falls back to `http://localhost:3000`.

## Deploy

The deployment files in `deploy/` assume the repo lives at `/home/charlie/status`, the Node app listens on `127.0.0.1:3003`, and Caddy serves `https://status.continental-hub.com`.

```bash
sudo cp deploy/status.service /etc/systemd/system/status.service
sudo systemctl daemon-reload
sudo systemctl enable --now status.service
sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak.$(date +%Y%m%d%H%M%S)
cat deploy/Caddyfile.status | sudo tee -a /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Data shape

The frontend fetches `GET /api/status`. The response is intentionally public-facing: it contains service names, availability states, and incident/maintenance messages, but not host or unit details.

Current top-level fields:

- `generatedAt`
- `refreshIntervalMs`
- `summary`
- `services`
- `incidents`
- `maintenance`
- `metrics`
- `history`

The server checks the expected Continental services and converts those checks into public status messages. HTTP health checks are used where a public endpoint exists, with process checks as the fallback for services that do not expose one.

`HEALTHCHECK_TIMEOUT_MS` controls how long each public endpoint check can run before it is treated as unavailable.

Currently monitored public surfaces: Continental Hub, Grimoire, Vanguard, Blueprint, Auth, Contact, and Status Page. `www.continental-hub.com` is treated as the same Hub surface.

## Manual updates

Use `data/status.json` to publish public overrides during incidents. Matching `services[].name` entries can override a service `kind`, `badge`, or `description`; `incidents`, `maintenance`, and `history` are published directly when present.

Supported service kinds are `operational`, `degraded`, `outage`, `maintenance`, and `pending`. Incident statuses should use public states such as `Investigating`, `Identified`, `Monitoring`, or `Resolved`.

Example override:

```json
{
  "services": [
    {
      "name": "Grimoire",
      "kind": "degraded",
      "badge": "Degraded",
      "description": "Players may experience connection delays."
    }
  ],
  "incidents": [
    {
      "title": "Grimoire connection delays",
      "status": "Investigating",
      "description": "We are checking reports of delayed multiplayer connections."
    }
  ]
}
```
