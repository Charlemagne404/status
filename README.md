# Continental Status

Branded status page for Continental, prepared for future live service, incident, and maintenance integration.

## Run locally

```bash
npm install
npm run dev
```

The site runs on `http://localhost:3000` by default.

## Data shape

The frontend fetches `GET /api/status`. Right now that route reads from `data/status.json`, which gives you a simple handoff point for later integrations.

Current top-level fields:

- `generatedAt`
- `refreshIntervalMs`
- `summary`
- `services`
- `incidents`
- `maintenance`
- `metrics`
- `history`

You can either keep writing to `data/status.json` or replace the route in [server.js](/Users/charliearnerstal/Documents/GitHub/status/server.js) with a live source later.
