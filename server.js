const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");

require("dotenv").config();

const express = require("express");

const app = express();
const port = Number.parseInt(process.env.PORT, 10) || 3000;
const publicDir = path.join(__dirname, "public");
const defaultStatusDataPath = path.join(__dirname, "data", "status.json");
const configuredStatusDataPath = process.env.STATUS_DATA_PATH
  ? path.isAbsolute(process.env.STATUS_DATA_PATH)
    ? process.env.STATUS_DATA_PATH
    : path.join(__dirname, process.env.STATUS_DATA_PATH)
  : defaultStatusDataPath;

app.disable("x-powered-by");

app.use((req, res, next) => {
  req.requestId = randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  next();
});

app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'"
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=(), microphone=()");

  if (req.secure || req.get("x-forwarded-proto") === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    requestId: req.requestId,
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/status", async (req, res) => {
  const payload = await loadStatusPayload();

  res.setHeader("Cache-Control", "no-store");
  res.json(payload);
});

app.use(express.static(publicDir));

app.use("/api", (req, res) => {
  res.status(404).json({
    error: "API route not found.",
    requestId: req.requestId,
  });
});

app.get("/", (req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.get("*", (req, res) => {
  res.status(404).sendFile(path.join(publicDir, "404.html"));
});

async function loadStatusPayload() {
  try {
    const fileContents = await fs.readFile(configuredStatusDataPath, "utf8");
    return normalizeStatusPayload(JSON.parse(fileContents));
  } catch (error) {
    log("warn", `Falling back to built-in status payload. ${error.message || error}`);
    return buildFallbackPayload();
  }
}

function normalizeStatusPayload(value) {
  const payload = value && typeof value === "object" ? value : {};

  return {
    generatedAt: normalizeTimestamp(payload.generatedAt),
    refreshIntervalMs: clampNumber(payload.refreshIntervalMs, 30_000, 3_600_000, 60_000),
    summary: normalizeSummary(payload.summary),
    services: normalizeServices(payload.services),
    incidents: normalizeIncidents(payload.incidents),
    maintenance: normalizeMaintenance(payload.maintenance),
    metrics: normalizeMetrics(payload.metrics),
    history: normalizeHistory(payload.history),
  };
}

function normalizeSummary(value) {
  const summary = value && typeof value === "object" ? value : {};

  return {
    kind: normalizeKind(summary.kind, "pending"),
    badge: normalizeText(summary.badge) || "Integration pending",
    headline: normalizeText(summary.headline) || "Status canvas ready for live data",
    detail:
      normalizeText(summary.detail) ||
      "No Continental service telemetry is connected yet. This interface is prepared to show service health, incidents, maintenance windows, and release notes once the live feed is wired in.",
  };
}

function normalizeServices(value) {
  return normalizeArray(value)
    .map((service) => {
      const item = service && typeof service === "object" ? service : {};
      const name = normalizeText(item.name);

      if (!name) {
        return null;
      }

      return {
        name,
        category: normalizeText(item.category),
        description: normalizeText(item.description),
        kind: normalizeKind(item.kind, "pending"),
        badge: normalizeText(item.badge),
        note: normalizeText(item.note),
        updatedAt: normalizeTimestamp(item.updatedAt),
        link: normalizeUrl(item.link),
      };
    })
    .filter(Boolean);
}

function normalizeIncidents(value) {
  return normalizeArray(value)
    .map((incident) => {
      const item = incident && typeof incident === "object" ? incident : {};
      const title = normalizeText(item.title);

      if (!title) {
        return null;
      }

      return {
        title,
        status: normalizeText(item.status) || "Update pending",
        impact: normalizeText(item.impact),
        description: normalizeText(item.description),
        startedAt: normalizeTimestamp(item.startedAt),
        updatedAt: normalizeTimestamp(item.updatedAt),
        link: normalizeUrl(item.link),
      };
    })
    .filter(Boolean);
}

function normalizeMaintenance(value) {
  return normalizeArray(value)
    .map((maintenance) => {
      const item = maintenance && typeof maintenance === "object" ? maintenance : {};
      const title = normalizeText(item.title);

      if (!title) {
        return null;
      }

      return {
        title,
        status: normalizeText(item.status) || "Scheduling pending",
        description: normalizeText(item.description),
        startsAt: normalizeTimestamp(item.startsAt),
        endsAt: normalizeTimestamp(item.endsAt),
        link: normalizeUrl(item.link),
      };
    })
    .filter(Boolean);
}

function normalizeMetrics(value) {
  return normalizeArray(value)
    .map((metric) => {
      const item = metric && typeof metric === "object" ? metric : {};
      const label = normalizeText(item.label);

      if (!label) {
        return null;
      }

      return {
        label,
        value: normalizeText(item.value) || "Pending",
        detail: normalizeText(item.detail),
      };
    })
    .filter(Boolean);
}

function normalizeHistory(value) {
  return normalizeArray(value)
    .map((entry) => {
      const item = entry && typeof entry === "object" ? entry : {};
      const label = normalizeText(item.label);

      if (!label) {
        return null;
      }

      return {
        label,
        date: normalizeTimestamp(item.date),
        detail: normalizeText(item.detail),
      };
    })
    .filter(Boolean);
}

function buildFallbackPayload() {
  return {
    generatedAt: null,
    refreshIntervalMs: 60_000,
    summary: normalizeSummary({}),
    services: [],
    incidents: [],
    maintenance: [],
    metrics: [],
    history: [],
  };
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeTimestamp(value) {
  const text = normalizeText(value);

  if (!text) {
    return null;
  }

  const timestamp = Date.parse(text);

  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeUrl(value) {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  if (text.startsWith("/")) {
    return text;
  }

  try {
    const parsed = new URL(text);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function normalizeKind(value, fallback) {
  const allowedKinds = new Set(["operational", "degraded", "outage", "maintenance", "pending"]);
  const kind = normalizeText(value).toLowerCase();

  return allowedKinds.has(kind) ? kind : fallback;
}

function clampNumber(value, minimum, maximum, fallback) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(numericValue)));
}

function log(level, message) {
  if (level === "warn") {
    console.warn(`[status] ${message}`);
    return;
  }

  console.info(`[status] ${message}`);
}

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Continental status site running on http://localhost:${port}`);
  });
}

module.exports = app;
