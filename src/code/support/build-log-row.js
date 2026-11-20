/* global $, $input */
// One flat row per processed email for the "Support log" sheet.
// Works for every path (skipped, spam, dry run, sent, rejected, ...):
// nodes that did not run for this item are simply treated as empty.
// Mode: Run once for each item.

const get = (node) => {
  try { return $(node).item.json; } catch { return null; }
};
const cfg = $('Config').first().json;
const norm = get('Normalize email') || {};
const cls = get('Parse classification');
const ticket = get('Build ticket');
const outcome = $input.item.json.outcome || 'unknown';
const email = norm.email || {};
const c = (ticket && ticket.classification) || (cls && cls.classification) || {};
const draft = ticket && ticket.draft;

return {
  json: {
    logged_at: new Date().toISOString(),
    outcome,
    message_id: email.message_id || '',
    thread_id: email.thread_id || '',
    from: email.from_address || '',
    subject: email.subject || '',
    category: c.category || '',
    sentiment: c.sentiment || '',
    urgency: c.urgency || '',
    summary: c.summary || norm.skip_reason || '',
    classification_valid: cls ? cls.classification_valid : '',
    faq_ids_used: draft ? draft.faq_ids_used.join(', ') : '',
    draft_confidence: draft ? draft.confidence : '',
    needs_human_attention: ticket ? ticket.needs_human_attention : '',
    reply_subject: draft ? draft.subject : '',
    reply_body: draft ? draft.body : '',
    dry_run: Boolean(cfg.dryRun) || Boolean(norm.is_sample),
  },
};
