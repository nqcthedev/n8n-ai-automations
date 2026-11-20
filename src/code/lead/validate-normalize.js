/* global $ */
// Validate & normalize one website-form submission.
// Mode: Run once for all items (a webhook call carries exactly one submission).
//
// Accepts JSON or form-encoded bodies with these fields (aliases in brackets):
//   name [full_name, fullName], email, company [organization], website, phone,
//   message [details, msg], budget, timeline, source [utm_source], page_url,
//   _gotcha  (honeypot: must stay empty - bots tend to fill every field)
//
// Output: { ok, httpStatus, responseBody, errors[], lead }

const req = $('Website form webhook').first().json;

let body = req.body;
if (typeof body === 'string') {
  try { body = JSON.parse(body); } catch { body = {}; }
}
if (!body || typeof body !== 'object' || Array.isArray(body)) body = {};

const pick = (...keys) => {
  for (const k of keys) {
    const v = body[k];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
};

// Strip tags/control chars, collapse whitespace, cap length.
const clean = (v, max) => {
  let s = String(v ?? '')
    .replace(/<[^>]*>/g, ' ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (s.length > max) s = s.slice(0, max).trimEnd() + '…';
  return s;
};

const FREE_MAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
  'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.de',
  'yandex.com', 'mail.com', 'zoho.com',
]);
const DISPOSABLE = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com', 'temp-mail.org',
  'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com', 'dispostable.com',
  'maildrop.cc', 'throwawaymail.com',
]);

// Honeypot: pretend success so bots learn nothing, but do not process.
if (String(body._gotcha ?? '').trim() !== '') {
  return [{
    json: {
      ok: false,
      spam: true,
      httpStatus: 200,
      errors: ['honeypot_filled'],
      responseBody: { status: 'received' },
    },
  }];
}

const name = clean(pick('name', 'full_name', 'fullName'), 120);
const email = clean(pick('email', 'Email'), 254).toLowerCase();
const message = clean(pick('message', 'details', 'msg'), 4000);
const errors = [];

const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const emailDomain = email.includes('@') ? email.split('@').pop() : '';

if (name.length < 2) errors.push('name: required (min. 2 characters)');
if (!EMAIL_RE.test(email)) errors.push('email: a valid email address is required');
else if (DISPOSABLE.has(emailDomain)) errors.push('email: please use a permanent email address');
if (message.length < 10) errors.push('message: please describe your request (min. 10 characters)');

if (errors.length) {
  return [{
    json: {
      ok: false,
      spam: false,
      httpStatus: 422,
      errors,
      responseBody: { status: 'rejected', errors },
    },
  }];
}

let website = clean(pick('website', 'url'), 200);
if (website && !/^https?:\/\//i.test(website)) website = 'https://' + website;
let websiteDomain = '';
try { websiteDomain = website ? new URL(website).hostname.replace(/^www\./, '') : ''; } catch { website = ''; }

const company = clean(pick('company', 'organization', 'organisation'), 160);
const phoneRaw = clean(pick('phone', 'tel'), 40);
const phone = phoneRaw.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');

const leadId = 'lead_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

const lead = {
  lead_id: leadId,
  received_at: new Date().toISOString(),
  name,
  email,
  email_domain: emailDomain,
  free_email: FREE_MAIL.has(emailDomain),
  company,
  website,
  website_domain: websiteDomain,
  phone: phone.length >= 7 ? phone : '',
  message,
  budget_stated: clean(pick('budget'), 120),
  timeline_stated: clean(pick('timeline'), 120),
  source: clean(pick('source', 'utm_source'), 80) || 'website',
  page_url: clean(pick('page_url', 'pageUrl'), 300),
};

// The subset of fields the LLM is allowed to see (no internal ids/metadata).
const llmInput = {
  name: lead.name,
  email: lead.email,
  email_is_free_provider: lead.free_email,
  company: lead.company || null,
  website: lead.website || null,
  message: lead.message,
  budget: lead.budget_stated || null,
  timeline: lead.timeline_stated || null,
  source: lead.source,
};

return [{
  json: { ok: true, spam: false, httpStatus: 200, errors: [], lead, llm_input: llmInput },
}];
