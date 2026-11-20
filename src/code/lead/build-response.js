/* global $ */
// Build the HTTP response for the website form.
// By default the caller only gets an acknowledgement + lead id. The AI
// qualification is internal sales data and is only included when
// LEAD_RESPONSE_DETAILS=true (useful for testing / server-to-server calls).
// Mode: Run once for all items.

const cfg = $('Config').first().json;
const rec = $('Build lead record').first().json;

const ran = (name) => {
  try { return $(name).isExecuted; } catch { return false; }
};
const actions = [];
if (ran('Log lead to Google Sheets')) actions.push('google_sheets_row');
if (ran('Slack: hot lead alert')) actions.push('slack_hot_lead_alert');
if (ran('Gmail: create reply draft')) actions.push('gmail_reply_draft');
if (ran('Slack: manual review alert')) actions.push('slack_manual_review_alert');

const body = {
  status: 'received',
  lead_id: rec.lead_id,
  message: 'Thanks! We received your request and will get back to you shortly.',
};

if (cfg.responseDetails) {
  body.details = {
    qualification_status: rec.status,
    tier: rec.tier,
    score: rec.score === '' ? null : rec.score,
    intent: rec.intent || null,
    budget_band: rec.budget_band || null,
    urgency: rec.urgency || null,
    company: rec.company,
    reasoning: rec.reasoning || null,
    suggested_reply: rec.suggested_reply || null,
    ai_attempts: rec.ai_attempts,
    ai_errors: rec.ai_errors || null,
    dry_run: rec.dry_run,
    actions,
  };
}

return [{ json: { statusCode: 200, body } }];
