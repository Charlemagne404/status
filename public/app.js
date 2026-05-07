const summaryTitle = document.querySelector("#summary-title");
const summaryDetail = document.querySelector("#summary-detail");
const summaryBadge = document.querySelector("#summary-badge");
const summaryUpdated = document.querySelector("#summary-updated");
const metricsGrid = document.querySelector("#metrics-grid");
const servicesGrid = document.querySelector("#services-grid");
const incidentsList = document.querySelector("#incidents-list");
const maintenanceList = document.querySelector("#maintenance-list");
const historyList = document.querySelector("#history-list");

const DEFAULT_REFRESH_INTERVAL_MS = 60_000;
const KIND_LABELS = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  maintenance: "Maintenance",
  pending: "Pending",
};

const PLACEHOLDER_METRICS = [
  {
    label: "Primary rollup",
    value: "Live soon",
    detail: "Overall status messaging appears here after integration.",
  },
  {
    label: "Telemetry slot",
    value: "Awaiting feed",
    detail: "Use for latency, uptime, or region-level highlights.",
  },
  {
    label: "Dispatch lane",
    value: "Standing by",
    detail: "Best for current incident count or maintenance count.",
  },
];

let refreshTimer = null;

function normalizePayload(value) {
  const payload = value && typeof value === "object" ? value : {};

  return {
    generatedAt: normalizeTimestamp(payload.generatedAt),
    refreshIntervalMs: normalizeRefreshInterval(payload.refreshIntervalMs),
    summary: normalizeSummary(payload.summary),
    services: normalizeArray(payload.services).map(normalizeService).filter(Boolean),
    incidents: normalizeArray(payload.incidents).map(normalizeIncident).filter(Boolean),
    maintenance: normalizeArray(payload.maintenance).map(normalizeMaintenance).filter(Boolean),
    metrics: normalizeArray(payload.metrics).map(normalizeMetric).filter(Boolean),
    history: normalizeArray(payload.history).map(normalizeHistory).filter(Boolean),
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
      "This page is ready to display live service health, incidents, maintenance windows, and release notes.",
  };
}

function normalizeService(value) {
  const service = value && typeof value === "object" ? value : {};
  const name = normalizeText(service.name);

  if (!name) {
    return null;
  }

  return {
    name,
    category: normalizeText(service.category),
    description: normalizeText(service.description),
    kind: normalizeKind(service.kind, "pending"),
    badge: normalizeText(service.badge),
    note: normalizeText(service.note),
    updatedAt: normalizeTimestamp(service.updatedAt),
    link: normalizeLink(service.link),
  };
}

function normalizeIncident(value) {
  const incident = value && typeof value === "object" ? value : {};
  const title = normalizeText(incident.title);

  if (!title) {
    return null;
  }

  return {
    title,
    status: normalizeText(incident.status) || "Update pending",
    impact: normalizeText(incident.impact),
    description: normalizeText(incident.description),
    startedAt: normalizeTimestamp(incident.startedAt),
    updatedAt: normalizeTimestamp(incident.updatedAt),
    link: normalizeLink(incident.link),
  };
}

function normalizeMaintenance(value) {
  const maintenance = value && typeof value === "object" ? value : {};
  const title = normalizeText(maintenance.title);

  if (!title) {
    return null;
  }

  return {
    title,
    status: normalizeText(maintenance.status) || "Scheduling pending",
    description: normalizeText(maintenance.description),
    startsAt: normalizeTimestamp(maintenance.startsAt),
    endsAt: normalizeTimestamp(maintenance.endsAt),
    link: normalizeLink(maintenance.link),
  };
}

function normalizeMetric(value) {
  const metric = value && typeof value === "object" ? value : {};
  const label = normalizeText(metric.label);

  if (!label) {
    return null;
  }

  return {
    label,
    value: normalizeText(metric.value) || "Pending",
    detail: normalizeText(metric.detail),
  };
}

function normalizeHistory(value) {
  const entry = value && typeof value === "object" ? value : {};
  const label = normalizeText(entry.label);

  if (!label) {
    return null;
  }

  return {
    label,
    date: normalizeTimestamp(entry.date),
    detail: normalizeText(entry.detail),
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

function normalizeRefreshInterval(value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return DEFAULT_REFRESH_INTERVAL_MS;
  }

  return Math.min(3_600_000, Math.max(30_000, Math.round(numericValue)));
}

function normalizeLink(value) {
  const text = normalizeText(value);

  if (!text) {
    return "";
  }

  if (text.startsWith("/")) {
    return text;
  }

  try {
    const parsed = new URL(text, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function normalizeKind(value, fallback) {
  const kind = normalizeText(value).toLowerCase();
  const allowedKinds = new Set(["operational", "degraded", "outage", "maintenance", "pending"]);

  return allowedKinds.has(kind) ? kind : fallback;
}

function formatDateTime(value) {
  if (!value) {
    return "Waiting for first snapshot";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatWindow(start, end) {
  if (!start && !end) {
    return "Schedule pending";
  }

  if (start && end) {
    return `${formatDateTime(start)} to ${formatDateTime(end)}`;
  }

  return start ? `Starts ${formatDateTime(start)}` : `Ends ${formatDateTime(end)}`;
}

function createTextElement(tagName, className, text) {
  const element = document.createElement(tagName);

  if (className) {
    element.className = className;
  }

  element.textContent = text;
  return element;
}

function setBadge(kind, label) {
  summaryBadge.className = `status-badge status-badge-${kind}`;
  summaryBadge.textContent = label;
}

function renderSummary(summary, generatedAt) {
  summaryTitle.textContent = summary.headline;
  summaryDetail.textContent = summary.detail;
  setBadge(summary.kind, summary.badge || KIND_LABELS[summary.kind]);
  summaryUpdated.textContent = generatedAt
    ? `Latest snapshot ${formatDateTime(generatedAt)}`
    : "Waiting for first snapshot";
}

function renderMetrics(metrics) {
  const items = metrics.length > 0 ? metrics : PLACEHOLDER_METRICS;

  metricsGrid.replaceChildren(
    ...items.map((metric, index) => {
      const article = document.createElement("article");
      article.className = "metric-card";

      if (metrics.length === 0) {
        article.dataset.placeholder = "true";
      }

      article.style.animationDelay = `${120 + index * 70}ms`;
      article.append(
        createTextElement("p", "metric-label", metric.label),
        createTextElement("strong", "metric-value", metric.value),
        createTextElement("p", "metric-detail", metric.detail)
      );

      return article;
    })
  );
}

function renderServices(services) {
  if (services.length === 0) {
    servicesGrid.replaceChildren(...buildServicePlaceholders());
    return;
  }

  servicesGrid.replaceChildren(
    ...services.map((service, index) => {
      const article = document.createElement("article");
      const header = document.createElement("div");
      const meta = document.createElement("div");
      const badge = document.createElement("span");

      article.className = "service-card";
      article.dataset.kind = service.kind;
      article.style.animationDelay = `${120 + index * 60}ms`;

      header.className = "service-header";
      meta.className = "service-meta";

      badge.className = `mini-badge mini-badge-${service.kind}`;
      badge.textContent = service.badge || KIND_LABELS[service.kind];

      header.append(
        createTextElement("div", "service-category", service.category || "Service"),
        badge
      );

      article.append(
        header,
        createTextElement("h3", "service-name", service.name),
        createTextElement(
          "p",
          "service-description",
          service.description || "No service note has been published yet."
        )
      );

      if (service.note) {
        article.append(createTextElement("p", "service-note", service.note));
      }

      meta.append(
        createTextElement("span", "", service.updatedAt ? `Updated ${formatDateTime(service.updatedAt)}` : "Awaiting first update")
      );

      if (service.link) {
        const anchor = document.createElement("a");
        anchor.className = "inline-link";
        anchor.href = service.link;
        anchor.textContent = "Open details";
        meta.append(anchor);
      }

      article.append(meta);
      return article;
    })
  );
}

function renderIncidents(incidents) {
  if (incidents.length === 0) {
    incidentsList.replaceChildren(
      buildEmptyState(
        "No incident posts yet",
        "Active and historical incident notes will appear here once the feed starts publishing updates."
      )
    );
    return;
  }

  incidentsList.replaceChildren(
    ...incidents.map((incident, index) =>
      buildStackItem({
        title: incident.title,
        badge: incident.status,
        detail: incident.description || incident.impact || "Incident update published.",
        meta: incident.updatedAt
          ? `Updated ${formatDateTime(incident.updatedAt)}`
          : incident.startedAt
            ? `Started ${formatDateTime(incident.startedAt)}`
            : "Incident timing pending",
        link: incident.link,
        delay: index,
      })
    )
  );
}

function renderMaintenance(maintenanceItems) {
  if (maintenanceItems.length === 0) {
    maintenanceList.replaceChildren(
      buildEmptyState(
        "No maintenance windows yet",
        "Planned work, upgrade windows, and rollout notices will be staged in this column."
      )
    );
    return;
  }

  maintenanceList.replaceChildren(
    ...maintenanceItems.map((item, index) =>
      buildStackItem({
        title: item.title,
        badge: item.status,
        detail: item.description || "Maintenance note published.",
        meta: formatWindow(item.startsAt, item.endsAt),
        link: item.link,
        delay: index,
      })
    )
  );
}

function renderHistory(historyEntries) {
  if (historyEntries.length === 0) {
    historyList.replaceChildren(
      ...[
        {
          label: "Resolved incidents",
          detail: "Fill this lane with postmortem links or closure notes once reporting starts.",
        },
        {
          label: "Launch notes",
          detail: "Use for deploys, migrations, and platform milestones.",
        },
        {
          label: "Regional updates",
          detail: "Useful for region-specific maintenance or recovery history.",
        },
      ].map((entry, index) => {
        const article = document.createElement("article");

        article.className = "history-card";
        article.dataset.placeholder = "true";
        article.style.animationDelay = `${100 + index * 70}ms`;
        article.append(
          createTextElement("p", "history-date", "Timeline slot"),
          createTextElement("h3", "history-label", entry.label),
          createTextElement("p", "history-detail", entry.detail)
        );

        return article;
      })
    );
    return;
  }

  historyList.replaceChildren(
    ...historyEntries.map((entry, index) => {
      const article = document.createElement("article");

      article.className = "history-card";
      article.style.animationDelay = `${100 + index * 70}ms`;
      article.append(
        createTextElement("p", "history-date", entry.date ? formatDateTime(entry.date) : "Date pending"),
        createTextElement("h3", "history-label", entry.label),
        createTextElement("p", "history-detail", entry.detail || "Historical note published.")
      );

      return article;
    })
  );
}

function buildStackItem({ title, badge, detail, meta, link, delay }) {
  const article = document.createElement("article");
  const topRow = document.createElement("div");

  article.className = "stack-item";
  article.style.animationDelay = `${100 + delay * 70}ms`;

  topRow.className = "stack-item-top";
  topRow.append(
    createTextElement("h3", "stack-title", title),
    createTextElement("span", "stack-badge", badge)
  );

  article.append(
    topRow,
    createTextElement("p", "stack-detail", detail),
    createTextElement("p", "stack-meta", meta)
  );

  if (link) {
    const anchor = document.createElement("a");
    anchor.className = "inline-link";
    anchor.href = link;
    anchor.textContent = "Open details";
    article.append(anchor);
  }

  return article;
}

function buildEmptyState(title, detail) {
  const article = document.createElement("article");

  article.className = "empty-state";
  article.append(
    createTextElement("p", "empty-eyebrow", "Awaiting data"),
    createTextElement("h3", "empty-title", title),
    createTextElement("p", "empty-detail", detail)
  );

  return article;
}

function buildServicePlaceholders() {
  return Array.from({ length: 4 }, (_, index) => {
    const article = document.createElement("article");

    article.className = "service-card service-card-placeholder";
    article.dataset.kind = "pending";
    article.dataset.placeholder = "true";
    article.style.animationDelay = `${120 + index * 60}ms`;
    article.innerHTML = `
      <div class="service-header">
        <div class="placeholder-line placeholder-line-short"></div>
        <span class="mini-badge mini-badge-pending">Reserved</span>
      </div>
      <div class="placeholder-line placeholder-line-wide"></div>
      <div class="placeholder-line"></div>
      <div class="placeholder-line placeholder-line-soft"></div>
      <div class="service-meta">
        <span>Service tile reserved for future integration</span>
      </div>
    `;

    return article;
  });
}

function renderPayload(payload) {
  renderSummary(payload.summary, payload.generatedAt);
  renderMetrics(payload.metrics);
  renderServices(payload.services);
  renderIncidents(payload.incidents);
  renderMaintenance(payload.maintenance);
  renderHistory(payload.history);
}

function renderFetchError() {
  renderSummary(
    {
      kind: "degraded",
      badge: "Feed unavailable",
      headline: "Status API could not be loaded",
      detail: "The page shell is ready, but the status endpoint did not respond. Check the server or data source.",
    },
    null
  );
  summaryUpdated.textContent = "Retrying automatically";
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status", {
      headers: {
        Accept: "application/json",
      },
      cache: "no-store",
    });

    if (!response.ok) {
      throw new Error(`Status API failed with ${response.status}`);
    }

    const payload = normalizePayload(await response.json());
    renderPayload(payload);
    scheduleRefresh(payload.refreshIntervalMs);
  } catch (error) {
    console.error(error);
    renderFetchError();
    scheduleRefresh(DEFAULT_REFRESH_INTERVAL_MS);
  }
}

function scheduleRefresh(delay) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(refreshStatus, delay);
}

renderMetrics([]);
renderServices([]);
renderIncidents([]);
renderMaintenance([]);
renderHistory([]);
refreshStatus();
