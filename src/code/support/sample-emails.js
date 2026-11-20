// Three sample emails in the same shape the Gmail Trigger produces
// (Simplify OFF). Used by "Test with sample emails" - samples always run in
// dry-run mode (no Slack, no Gmail send, no Sheets), whatever the env says.
// Mode: Run once for all items.

const now = new Date().toISOString();
const mk = (n, address, name, subject, text) => ({
  json: {
    id: `sample-${n}`,
    threadId: `sample-thread-${n}`,
    isSample: true,
    date: now,
    subject,
    text,
    from: { value: [{ address, name }], text: `${name} <${address}>` },
    headers: {},
  },
});

return [
  mk(1, 'jordan.lee@northbeam-studio.example', 'Jordan Lee', 'Charged twice this month?',
    'Hi,\n\nI just noticed two charges of $39 on my card for November. We are on the Team plan with one seat. Can you refund the duplicate charge? Also, where can I download the invoice with our VAT number on it?\n\nThanks,\nJordan'),
  mk(2, 'priya.sharma@quantaops.example', 'Priya Sharma', 'CSV export not working - urgent',
    'Hello support,\n\nEvery time I try to export our customer list (about 120k rows) to CSV the browser just spins and nothing downloads. We need this report for a board meeting tomorrow morning. This is really frustrating.\n\nPriya'),
  mk(3, 'growth@seo-rank-boost.example', 'Rank Boost Agency', 'Guaranteed #1 Google ranking for example.com',
    'Dear website owner, we noticed your site is not ranking on page 1. Our link-building package guarantees #1 positions in 30 days for only $99. Reply YES to get started!'),
];
