/* global $input */
// Normalize a Gmail message (Gmail Trigger with "Simplify" OFF) into a compact
// email object, and decide whether it should be processed at all.
// Mode: Run once for each item.
//
// Skips: auto-replies / out-of-office, bounces, mailing lists & bulk mail,
// no-reply senders. Those never reach the LLM (saves cost, avoids loops).

const m = $input.item.json;

const header = (name) => {
  const h = m.headers || {};
  const key = Object.keys(h).find((k) => k.toLowerCase() === name.toLowerCase());
  const v = key ? h[key] : undefined;
  // Gmail trigger headers come as "Name: value" strings.
  if (typeof v === 'string') return v.replace(new RegExp('^' + name + ':\\s*', 'i'), '').trim();
  return v === undefined ? '' : String(v);
};

const fromObj = (m.from && Array.isArray(m.from.value) && m.from.value[0]) || {};
const fromAddress = String(fromObj.address || m.From || '').toLowerCase().replace(/^.*<|>.*$/g, '').trim();
const fromName = String(fromObj.name || '').trim();
const subject = String(m.subject || m.Subject || '(no subject)').trim().slice(0, 300);

// Body: prefer plain text; fall back to HTML stripped of tags.
let body = typeof m.text === 'string' && m.text.trim() ? m.text : '';
if (!body && typeof m.html === 'string') {
  body = m.html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
if (!body) body = String(m.snippet || '');

// Drop quoted history ("On ... wrote:" and "> " lines) and signatures delimiter.
const lines = body.replace(/\r\n?/g, '\n').split('\n');
const out = [];
for (const line of lines) {
  if (/^On .+wrote:\s*$/i.test(line.trim()) || /^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
  if (line.trim() === '-- ') break;
  if (/^\s*>/.test(line)) continue;
  out.push(line);
}
body = out.join('\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const truncated = body.length > 6000;
if (truncated) body = body.slice(0, 6000) + '\n[...truncated]';

let skipReason = '';
const autoSubmitted = header('auto-submitted');
const precedence = header('precedence').toLowerCase();
if (!fromAddress) skipReason = 'no sender address';
else if (/(^|[._-])(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounce)/i.test(fromAddress)) skipReason = 'no-reply / system sender';
else if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') skipReason = 'auto-submitted (auto-reply)';
else if (['bulk', 'list', 'junk', 'auto_reply'].includes(precedence)) skipReason = `precedence: ${precedence}`;
else if (header('list-unsubscribe') || header('list-id')) skipReason = 'mailing list / newsletter';
else if (/^(automatic reply|auto(matic)?[- ]?reply|out of (the )?office)/i.test(subject)) skipReason = 'out-of-office reply';
else if (body.length < 5) skipReason = 'empty body';

return {
  json: {
    skip: Boolean(skipReason),
    skip_reason: skipReason,
    is_sample: Boolean(m.isSample),
    email: {
      message_id: m.id || '',
      thread_id: m.threadId || '',
      from_address: fromAddress,
      from_name: fromName,
      subject,
      body,
      truncated,
      received_at: m.date ? new Date(m.date).toISOString() : new Date().toISOString(),
    },
  },
};
