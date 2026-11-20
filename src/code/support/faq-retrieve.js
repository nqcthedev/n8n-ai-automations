/* global $, $input */
// FAQ knowledge base + lightweight retrieval (no vector DB needed).
// EDIT THE KNOWLEDGE BASE BELOW with your real policies. The reply-drafting
// LLM is instructed to use ONLY these snippets, so keep them accurate.
// Mode: Run once for each item.
//
// Retrieval: keyword overlap between the email and each entry's tags/question,
// plus a bonus for entries in the predicted category. Top 4 entries are sent.

const KB = [
  { id: 'billing-refund', category: 'billing', tags: 'refund money back cancel charge charged return', q: 'Can I get a refund?',
    a: 'New subscriptions have a 14-day money-back guarantee on the first payment (monthly and annual plans). After 14 days we do not refund partial billing periods, but you can cancel any time and keep access until the end of the paid period. Approved refunds reach the original payment method within 5-10 business days.' },
  { id: 'billing-invoice', category: 'billing', tags: 'invoice receipt vat tax company address billing details download pdf', q: 'Where are my invoices / how do I add VAT details?',
    a: 'Invoices are available under Settings > Billing > Invoices (PDF download). Company name, address and VAT ID can be added there and apply to all future invoices. Support can re-issue a past invoice once with corrected details.' },
  { id: 'billing-failed-payment', category: 'billing', tags: 'payment failed declined card expired update card overdue', q: 'My payment failed',
    a: 'If a card payment fails we retry automatically 3 times over 7 days and the account stays fully active during that period. You can update the card under Settings > Billing > Payment method; the outstanding invoice is charged right after the update.' },
  { id: 'billing-plan-change', category: 'billing', tags: 'upgrade downgrade change plan seats users add remove prorate', q: 'How do plan changes work?',
    a: 'Upgrades and added seats take effect immediately and are pro-rated. Downgrades and removed seats take effect at the start of the next billing period.' },
  { id: 'bug-report', category: 'bug', tags: 'bug error broken crash not working issue problem page blank 500', q: 'How do I report a bug?',
    a: 'To investigate we need: the steps to reproduce, the browser and operating system, a screenshot or screen recording, and the approximate time it happened (with time zone). Live service status is published at status.example.com.' },
  { id: 'bug-login', category: 'bug', tags: 'login log in sign in password reset magic link locked 2fa sso', q: 'I cannot log in',
    a: 'Use "Forgot password" on the login page to reset your password. Magic links expire after 15 minutes and can land in spam. Accounts on SSO must sign in through the company SSO button. After 10 failed attempts an account is locked for 30 minutes.' },
  { id: 'bug-export', category: 'bug', tags: 'export csv download report large file timeout', q: 'My CSV export does not download',
    a: 'Exports larger than 50,000 rows are generated in the background and emailed as a download link within about 15 minutes instead of downloading directly in the browser.' },
  { id: 'sales-pricing', category: 'sales', tags: 'price pricing cost plan quote discount annual enterprise nonprofit', q: 'What does it cost?',
    a: 'Starter is $19 per user/month, Team is $39 per user/month, Enterprise is custom-priced (SSO, audit log, SLA, dedicated support). Annual billing saves 15%. Volume and non-profit discounts are handled by the sales team.' },
  { id: 'sales-demo', category: 'sales', tags: 'demo trial test try evaluate call meeting onboarding', q: 'Can I get a demo or trial?',
    a: 'There is a free 14-day trial with no credit card required. A 30-minute live demo with the sales team can be booked on the website (example.com/demo).' },
  { id: 'account-security', category: 'other', tags: 'security password phishing 2fa two factor gdpr data privacy', q: 'Security & privacy',
    a: 'We never ask for passwords by email. Two-factor authentication can be enabled under Settings > Security. Account owners can export all data at any time; deletion requests are completed within 30 days.' },
];

const item = $input.item.json;
const email = $('Normalize email').item.json.email;
const category = item.classification.category;

const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
const emailWords = new Set(words(email.subject + ' ' + email.body));

const scored = KB.map((e) => {
  const kw = new Set([...words(e.tags), ...words(e.q)]);
  let score = 0;
  for (const w of kw) if (emailWords.has(w)) score += 1;
  if (e.category === category) score += 2;
  return { e, score };
}).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 4);

const snippets = scored.map(({ e }) => `[${e.id}] Q: ${e.q}\nA: ${e.a}`).join('\n\n');

return {
  json: {
    ...item,
    kb_ids: scored.map(({ e }) => e.id),
    kb_snippets: snippets || '(no relevant knowledge base entries found)',
  },
};
