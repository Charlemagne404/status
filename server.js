const fs = require("fs/promises");
const path = require("path");
const { randomUUID } = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");

require("dotenv").config();

const express = require("express");

const execFileAsync = promisify(execFile);
const app = express();
const port = Number.parseInt(process.env.PORT, 10) || 3000;
const publicDir = path.join(__dirname, "public");
const defaultStatusDataPath = path.join(__dirname, "data", "status.json");
const configuredStatusDataPath = process.env.STATUS_DATA_PATH
  ? path.isAbsolute(process.env.STATUS_DATA_PATH)
    ? process.env.STATUS_DATA_PATH
    : path.join(__dirname, process.env.STATUS_DATA_PATH)
  : defaultStatusDataPath;
const systemctlTimeoutMs = clampNumber(
  process.env.SYSTEMCTL_TIMEOUT_MS,
  1_000,
  30_000,
  5_000
);
const healthCheckTimeoutMs = clampNumber(
  process.env.HEALTHCHECK_TIMEOUT_MS,
  1_000,
  15_000,
  4_000
);
const publicServices = [
  {
    name: "Continental Hub",
    category: "Website",
    description: "Main Continental website and navigation.",
    healthUrl: "https://continental-hub.com/",
  },
  {
    unitName: "grimoire-play.service",
    name: "Grimoire",
    category: "Game",
    description: "Gameplay and multiplayer access.",
    healthUrl: "https://grimoire.continental-hub.com/",
  },
  {
    unitName: "vanguard-discord-bot.service",
    name: "Vanguard",
    category: "Community",
    description: "Community automation and Discord features.",
    healthUrl: "https://vanguard.continental-hub.com/",
  },
  {
    unitName: "blueprint.service",
    name: "Blueprint",
    category: "Community",
    description: "Community tools and shared service access.",
    healthUrl: "https://blueprint.continental-hub.com/",
  },
  {
    name: "Auth",
    category: "Account",
    description: "Login and account services.",
    healthUrl: "https://auth.continental-hub.com/api/health",
  },
  {
    unitName: "contact.service",
    name: "Contact",
    category: "Website",
    description: "Contact forms and support requests.",
    healthUrl: "https://contact.continental-hub.com/",
  },
  {
    unitName: "status.service",
    name: "Status Page",
    category: "Website",
    description: "Public status updates.",
    healthUrl: `http://127.0.0.1:${port}/health`,
  },
];

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

app.use((req, res) => {
  res.status(404).sendFile(path.join(publicDir, "404.html"));
});

async function loadStatusPayload() {
  const overridePayload = await loadConfiguredStatusPayload();

  try {
    return normalizeStatusPayload(applyStatusOverrides(await loadLiveStatusPayload(), overridePayload));
  } catch (error) {
    log("warn", `Falling back to file-based status payload. ${error.message || error}`);
  }

  return normalizeStatusPayload(applyStatusOverrides(buildFallbackPayload(), overridePayload));
}

async function loadConfiguredStatusPayload() {
  try {
    const fileContents = await fs.readFile(configuredStatusDataPath, "utf8");
    return JSON.parse(fileContents);
  } catch (error) {
    log("warn", `Status override payload unavailable. ${error.message || error}`);
    return {};
  }
}

async function loadLiveStatusPayload() {
  const generatedAt = new Date().toISOString();
  const runningUnitNames = await listRunningServiceNames();
  const services = await Promise.all(
    publicServices.map((service) => buildPublicService(service, runningUnitNames))
  );

  return buildPublicStatusPayload({
    generatedAt,
    refreshIntervalMs: 30_000,
    services,
    incidents: [],
    maintenance: [],
  });
}

async function listRunningServiceNames() {
  const { stdout } = await execFileAsync(
    "systemctl",
    [
      "list-units",
      "--type=service",
      "--state=running",
      "--plain",
      "--no-pager",
      "--no-legend",
    ],
    {
      timeout: systemctlTimeoutMs,
      maxBuffer: 1024 * 1024,
    }
  );

  return new Set(
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseSystemctlUnitName)
      .filter(Boolean)
  );
}

function parseSystemctlUnitName(line) {
  const match = line.match(/^(\S+)\s+/);
  return match ? normalizeText(match[1]) : "";
}

async function buildPublicService(service, runningUnitNames) {
  const check = service.healthUrl
    ? await checkHttpAvailability(service.healthUrl)
    : { ok: runningUnitNames.has(service.unitName) };

  return {
    name: service.name,
    category: service.category,
    description: check.ok
      ? service.description
      : "We are investigating availability for this service.",
    kind: check.ok ? "operational" : "outage",
    badge: check.ok ? "Operational" : "Issue detected",
  };
}

async function checkHttpAvailability(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), healthCheckTimeoutMs);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });

    return {
      ok: response.status >= 200 && response.status < 400,
    };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timeout);
  }
}

function buildPublicStatusPayload(payload) {
  const generatedAt = normalizeTimestamp(payload.generatedAt) || new Date().toISOString();
  const services = normalizeServices(payload.services);
  const manualIncidents = normalizeIncidents(payload.incidents);
  const incidents = manualIncidents.length > 0 ? manualIncidents : buildLiveIncidents(services, generatedAt);
  const maintenance = normalizeMaintenance(payload.maintenance);

  return {
    generatedAt,
    refreshIntervalMs: clampNumber(payload.refreshIntervalMs, 30_000, 3_600_000, 60_000),
    summary: buildLiveSummary(services, incidents),
    services,
    incidents,
    maintenance,
    metrics: buildStatusMetrics(services, incidents, maintenance),
    history: buildServiceHistory(services, payload.history),
  };
}

function buildLiveIncidents(services, generatedAt) {
  const issueServices = services.filter((service) => service.kind === "degraded" || service.kind === "outage");

  if (issueServices.length === 0) {
    return [];
  }

  const serviceNames = issueServices.map((service) => service.name).join(", ");

  return [
    {
      title: "Service availability issue",
      status: "Investigating",
      impact: `${serviceNames} may be unavailable or degraded.`,
      description: "We are checking this and will update the page when the service is healthy again.",
      startedAt: generatedAt,
      updatedAt: generatedAt,
    },
  ];
}

function buildLiveSummary(services, incidents = []) {
  const issueServices = services.filter((service) => service.kind !== "operational");
  const activeIncidents = incidents.filter((incident) => !/^resolved$/i.test(incident.status));

  if (issueServices.length > 0) {
    const plural = issueServices.length === 1 ? "service is" : "services are";

    return {
      kind: issueServices.length === services.length ? "outage" : "degraded",
      badge: "Issue detected",
      headline: `${issueServices.length} ${plural} having issues`,
      detail: "Some Continental services may be unavailable or degraded. Updates will appear here as the status changes.",
    };
  }

  if (activeIncidents.length > 0) {
    return {
      kind: "degraded",
      badge: activeIncidents[0].status || "Incident posted",
      headline: activeIncidents[0].title,
      detail:
        activeIncidents[0].description ||
        activeIncidents[0].impact ||
        "A status update has been posted for Continental services.",
    };
  }

  return {
    kind: "operational",
    badge: "All systems operational",
    headline: "All Continental services are operational",
    detail: "No known issues are affecting the public Continental services listed below.",
  };
}

function buildStatusMetrics(services, incidents, maintenance) {
  const operationalServices = services.filter((service) => service.kind === "operational").length;
  const issueServices = services.length - operationalServices;
  const activeIncidents = incidents.filter((incident) => !/^resolved$/i.test(incident.status)).length;

  return [
    {
      label: "Operational",
      value: String(operationalServices),
      detail: "Services currently available.",
    },
    {
      label: "Issues",
      value: String(issueServices || activeIncidents),
      detail: issueServices === 0 && activeIncidents === 0
        ? "No known service issues."
        : "Updates are published below.",
    },
    {
      label: "Maintenance",
      value: String(maintenance.length),
      detail: maintenance.length === 0 ? "No planned work right now." : "Planned work is listed below.",
    },
  ];
}

function buildServiceHistory(services, overrideHistory) {
  const historyByName = new Map(
    normalizeHistory(overrideHistory).map((entry) => [entry.label.toLowerCase(), entry])
  );

  return services.map((service) => {
    const override = historyByName.get(service.name.toLowerCase());

    if (override) {
      return override;
    }

    return {
      label: service.name,
      detail: "7-day availability",
      kind: service.kind,
      days: buildDefaultHistoryDays(service.kind),
    };
  });
}

function buildDefaultHistoryDays(kind) {
  const today = new Date();

  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (6 - index));

    return {
      label: date.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }),
      kind,
    };
  });
}

function applyStatusOverrides(livePayload, overridePayload) {
  const overrides = overridePayload && typeof overridePayload === "object" ? overridePayload : {};
  const overrideServices = new Map(
    normalizeServices(overrides.services).map((service) => [service.name.toLowerCase(), service])
  );
  const services = normalizeServices(livePayload.services).map((service) =>
    mergeServiceOverride(service, overrideServices.get(service.name.toLowerCase()))
  );
  const extraServices = normalizeServices(overrides.services).filter(
    (service) => !services.some((item) => item.name.toLowerCase() === service.name.toLowerCase())
  );
  const incidents = normalizeIncidents(overrides.incidents);
  const maintenance = normalizeMaintenance(overrides.maintenance);
  const mergedPayload = buildPublicStatusPayload({
    ...livePayload,
    generatedAt: livePayload.generatedAt,
    refreshIntervalMs: overrides.refreshIntervalMs || livePayload.refreshIntervalMs,
    services: [...services, ...extraServices],
    incidents,
    maintenance,
    history: overrides.history,
  });

  if (overrides.summary && Object.keys(overrides.summary).length > 0) {
    mergedPayload.summary = {
      ...mergedPayload.summary,
      ...normalizeSummaryOverride(overrides.summary),
    };
  }

  return mergedPayload;
}

function mergeServiceOverride(service, override) {
  if (!override) {
    return service;
  }

  const merged = { ...service };

  for (const field of ["category", "description", "badge", "link"]) {
    if (override[field]) {
      merged[field] = override[field];
    }
  }

  if (override.kind && override.kind !== "pending") {
    merged.kind = override.kind;
  }

  return merged;
}

function normalizeSummaryOverride(value) {
  const summary = value && typeof value === "object" ? value : {};
  const override = {};
  const badge = normalizeText(summary.badge);
  const headline = normalizeText(summary.headline);
  const detail = normalizeText(summary.detail);
  const kind = normalizeKind(summary.kind, "");

  if (kind) {
    override.kind = kind;
  }

  if (badge) {
    override.badge = badge;
  }

  if (headline) {
    override.headline = headline;
  }

  if (detail) {
    override.detail = detail;
  }

  return override;
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
    badge: normalizeText(summary.badge) || "Checking status",
    headline: normalizeText(summary.headline) || "Checking Continental services",
    detail:
      normalizeText(summary.detail) ||
      "Current availability for public Continental services will appear here.",
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

      const link = normalizeUrl(item.link);

      return {
        name,
        category: normalizeText(item.category),
        description: normalizeText(item.description),
        kind: normalizeKind(item.kind, "pending"),
        badge: normalizeText(item.badge),
        ...(link ? { link } : {}),
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
        kind: normalizeKind(item.kind, "pending"),
        days: normalizeHistoryDays(item.days),
      };
    })
    .filter(Boolean);
}

function normalizeHistoryDays(value) {
  return normalizeArray(value)
    .map((day) => {
      const item = day && typeof day === "object" ? day : {};
      const label = normalizeText(item.label);

      if (!label) {
        return null;
      }

      return {
        label,
        kind: normalizeKind(item.kind, "pending"),
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
