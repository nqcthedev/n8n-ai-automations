/* global $, $input, $getWorkflowStaticData */
// Dedupe leads by email within a rolling window (LEAD_DEDUPE_WINDOW_HOURS).
// Mode: Run once for all items.
//
// Uses n8n workflow static data, which is persisted for production
// (webhook-triggered) executions only - manual test runs never mark leads as seen.
// The registry is capped and pruned so it cannot grow without bound.

const cfg = $('Config').first().json;
const item = $input.first().json;
const lead = item.lead;

const store = $getWorkflowStaticData('global');
store.leadsSeen = store.leadsSeen || {};

const now = Date.now();
const windowMs = Math.max(0, Number(cfg.dedupeWindowHours) || 0) * 3600 * 1000;

// Prune expired entries and keep at most 5,000 most recent.
for (const [key, ts] of Object.entries(store.leadsSeen)) {
  if (now - ts > windowMs) delete store.leadsSeen[key];
}
const keys = Object.keys(store.leadsSeen);
if (keys.length > 5000) {
  keys.sort((a, b) => store.leadsSeen[a] - store.leadsSeen[b])
    .slice(0, keys.length - 5000)
    .forEach((k) => delete store.leadsSeen[k]);
}

const key = lead.email;
const previous = store.leadsSeen[key];
const duplicate = windowMs > 0 && previous !== undefined;
if (!duplicate) store.leadsSeen[key] = now;

return [{
  json: {
    ...item,
    duplicate,
    previous_submission_at: duplicate ? new Date(previous).toISOString() : null,
  },
}];
