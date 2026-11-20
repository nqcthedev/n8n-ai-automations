/* global $, $input */
// Assemble the ticket (email + classification + draft) and the Slack approval
// message. Mode: Run once for each item.

const cfg = $('Config').first().json;
const norm = $('Normalize email').item.json;
const { classification } = $('Parse classification').item.json;
const d = $input.item.json; // from "Validate draft"
const email = norm.email;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const quote = (s, max) => {
  const t = String(s ?? '');
  return esc(t.length > max ? t.slice(0, max) + '…' : t).split('\n').map((l) => '> ' + l).join('\n');
};
const urgencyIcon = { critical: ':red_circle:', high: ':large_orange_circle:', normal: ':large_blue_circle:', low: ':white_circle:' }[classification.urgency] || '';

const approvalText = [
  `${urgencyIcon} *Support reply needs approval* - ${classification.category} · ${classification.urgency} urgency · ${classification.sentiment}`,
  `*From:* ${esc(email.from_name)} ${esc(email.from_address)}`,
  `*Subject:* ${esc(email.subject)}`,
  `*Summary:* ${esc(classification.summary)}`,
  `*Customer wrote:*`,
  quote(email.body, 700),
  `*Proposed reply:*`,
  quote(d.draft ? d.draft.body : '', 2500),
  `_Knowledge used: ${d.draft && d.draft.faq_ids_used.length ? d.draft.faq_ids_used.join(', ') : 'none'} · confidence ${d.draft ? d.draft.confidence : 0}_`,
  d.needs_human_attention ? ':warning: *Flagged for careful review:* ' + esc([...(d.draft_warnings || []), d.draft && d.draft.needs_human_attention ? 'model asked for human attention' : ''].filter(Boolean).join('; ')) : '',
  'Approve to send this reply from the support inbox. Reject to handle it manually (the email stays unread).',
].filter(Boolean).join('\n');

const manualText = [
  `:warning: *Support email needs a manual reply* (no usable AI draft) - ${classification.category} · ${classification.urgency} urgency`,
  `*From:* ${esc(email.from_name)} ${esc(email.from_address)}`,
  `*Subject:* ${esc(email.subject)}`,
  `*Summary:* ${esc(classification.summary)}`,
  `*Reason:* ${esc((d.draft_errors || []).join('; ') || 'n/a')}`,
].join('\n');

return {
  json: {
    dry_run: Boolean(cfg.dryRun) || norm.is_sample,
    email,
    classification,
    draft: d.draft,
    draft_usable: d.draft_usable,
    draft_errors: d.draft_errors,
    draft_warnings: d.draft_warnings,
    needs_human_attention: d.needs_human_attention,
    slack_approval_text: approvalText,
    slack_manual_text: manualText,
  },
};
