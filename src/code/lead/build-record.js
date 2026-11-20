/* global $, $input */
// Combine the normalized lead with the AI qualification into one flat record.
// The record is what gets written to Google Sheets (columns are matched by
// header name; extra fields such as slack_text are ignored by the Sheets node).
// Mode: Run once for all items.

const cfg = $('Config').first().json;
const { lead } = $('Dedupe (72h window)').first().json;
const result = $input.first().json;
const ai = result.aiValid ? result.ai : null;

const threshold = Number(cfg.hotScoreThreshold) || 70;
let tier = 'review';
if (ai) {
  if (ai.intent === 'spam') tier = 'spam';
  else if (ai.score >= threshold) tier = 'hot';
  else if (ai.score >= 40) tier = 'warm';
  else tier = 'cold';
}

// Escape user-controlled text for Slack mrkdwn (prevents <!channel> pings, fake links).
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const quote = (s, max = 500) => {
  const t = String(s ?? '');
  return esc(t.length > max ? t.slice(0, max) + '…' : t).split('\n').map((l) => '> ' + l).join('\n');
};

const company = (ai && ai.company && ai.company !== 'Unknown' ? ai.company : '') || lead.company || 'Unknown company';

const slackHot = [
  `:fire: *Hot lead - score ${ai?.score}/100* (${ai?.urgency} urgency)`,
  `*${esc(lead.name)}* · ${esc(lead.email)} · ${esc(company)}`,
  `*Intent:* ${ai?.intent} · *Budget:* ${ai?.budget_band}${lead.phone ? ' · *Phone:* ' + esc(lead.phone) : ''}`,
  quote(lead.message),
  `*Why:* ${esc(ai?.reasoning)}`,
  `A personalised reply draft is waiting in Gmail drafts. Lead id: \`${lead.lead_id}\``,
].join('\n');

const slackReview = [
  `:warning: *Lead needs manual review* - the AI could not produce a valid qualification.`,
  `*${esc(lead.name)}* · ${esc(lead.email)} · ${esc(lead.company || 'company not given')}`,
  quote(lead.message),
  `*Reason:* ${esc((result.aiErrors || []).join('; ').slice(0, 400))}`,
  `Lead id: \`${lead.lead_id}\``,
].join('\n');

return [{
  json: {
    lead_id: lead.lead_id,
    received_at: lead.received_at,
    status: ai ? 'qualified' : 'needs_manual_review',
    tier,
    score: ai ? ai.score : '',
    intent: ai ? ai.intent : '',
    budget_band: ai ? ai.budget_band : '',
    urgency: ai ? ai.urgency : '',
    company,
    name: lead.name,
    email: lead.email,
    phone: lead.phone,
    website: lead.website,
    message: lead.message,
    budget_stated: lead.budget_stated,
    timeline_stated: lead.timeline_stated,
    source: lead.source,
    reasoning: ai ? ai.reasoning : '',
    suggested_reply: ai ? ai.suggested_reply : '',
    ai_attempts: result.attempt,
    ai_errors: (result.aiErrors || []).join('; '),
    dry_run: Boolean(cfg.dryRun),
    // Not Sheets columns - used by the notification nodes:
    slack_text: tier === 'hot' ? slackHot : slackReview,
    email_subject: `Re: your enquiry${company !== 'Unknown company' ? ' - ' + company : ''}`,
  },
}];
