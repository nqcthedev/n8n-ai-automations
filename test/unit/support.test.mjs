import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeNode } from '../lib/code-node.mjs';

const WF = '02b-ai-support-process-email.json';
const normalize = codeNode(WF, 'Normalize email');
const classify = codeNode(WF, 'Parse classification');
const retrieve = codeNode(WF, 'Retrieve FAQ snippets');
const draft = codeNode(WF, 'Validate draft');
const logRow = codeNode(WF, 'Build log row');

const gmail = (over = {}) => ({
  id: 'm1', threadId: 't1', date: '2026-11-20T10:00:00Z', subject: 'Refund please',
  text: 'Hi, I was charged twice, can I get a refund?\n\nOn Mon, Nov 18, 2026 Support wrote:\n> old quoted text',
  from: { value: [{ address: 'Jordan@Example.com', name: 'Jordan' }] }, headers: {}, ...over,
});

test('normalize: extracts sender, strips quoted history', async () => {
  const [out] = await normalize({ items: [gmail()] });
  assert.equal(out.json.skip, false);
  assert.equal(out.json.email.from_address, 'jordan@example.com');
  assert.ok(!out.json.email.body.includes('old quoted text'));
});

test('normalize: skips auto-replies, mailing lists and no-reply senders', async () => {
  const cases = [
    gmail({ headers: { 'auto-submitted': 'Auto-Submitted: auto-replied' } }),
    gmail({ headers: { 'list-unsubscribe': 'List-Unsubscribe: <mailto:x>' } }),
    gmail({ from: { value: [{ address: 'no-reply@shop.example' }] } }),
    gmail({ subject: 'Automatic reply: Out of office' }),
  ];
  for (const c of cases) {
    const [out] = await normalize({ items: [c] });
    assert.equal(out.json.skip, true, JSON.stringify(c.headers) + c.subject);
  }
});

test('normalize: falls back to HTML body', async () => {
  const [out] = await normalize({ items: [gmail({ text: '', html: '<p>Hello <b>team</b></p><script>x()</script>' })] });
  assert.equal(out.json.email.body, 'Hello team');
});

test('classification: valid output passes, invalid falls back to "other"', async () => {
  const [ok] = await classify({ items: [{ category: 'billing', sentiment: 'negative', urgency: 'high', summary: 'Double charge', language: 'en', confidence: 0.9 }] });
  assert.equal(ok.json.classification_valid, true);
  assert.equal(ok.json.classification.category, 'billing');
  const [bad] = await classify({ items: [{ category: 'refunds', sentiment: 'meh', urgency: 'now', summary: '' }] });
  assert.equal(bad.json.classification_valid, false);
  assert.equal(bad.json.classification.category, 'other');
  const [err] = await classify({ items: [{ error: 'timeout' }] });
  assert.equal(err.json.classification.category, 'other');
});

test('retrieval: billing email gets billing FAQ entries', async () => {
  const email = { subject: 'Charged twice', body: 'Please refund the duplicate charge and send the invoice with VAT' };
  const [out] = await retrieve({
    items: [{ classification: { category: 'billing' } }],
    nodes: { 'Normalize email': [{ email }] },
  });
  assert.ok(out.json.kb_ids.includes('billing-refund'));
  assert.ok(out.json.kb_ids.includes('billing-invoice'));
  assert.ok(out.json.kb_ids.length <= 4);
});

const ctx = { kb_ids: ['billing-refund'], kb_snippets: '[billing-refund] A: 14-day money-back guarantee ... $19 per user' };

test('draft: unknown knowledge-base ids make the draft unusable', async () => {
  const [out] = await draft({
    items: [{ subject: 'Re: x', body: 'Hi Jordan, thanks for writing. We will check this for you.', faq_ids_used: ['made-up-id'], needs_human_attention: false, confidence: 0.8 }],
    nodes: { 'Retrieve FAQ snippets': [ctx] },
  });
  assert.equal(out.json.draft_usable, false);
  assert.match(out.json.draft_errors.join(), /made-up-id/);
});

test('draft: money amounts not in the knowledge base are flagged', async () => {
  const [out] = await draft({
    items: [{ subject: 'Re: x', body: 'Hi Jordan, we will refund $500 and give you a $19 credit.', faq_ids_used: ['billing-refund'], needs_human_attention: false, confidence: 0.9 }],
    nodes: { 'Retrieve FAQ snippets': [ctx] },
  });
  assert.equal(out.json.draft_usable, true);
  assert.equal(out.json.needs_human_attention, true);
  assert.match(out.json.draft_warnings.join(), /\$500/);
  assert.ok(!out.json.draft_warnings.join().includes('$19'));
});

test('log row: works for the skipped path where AI nodes never ran', async () => {
  const [out] = await logRow({
    items: [{ outcome: 'skipped' }],
    nodes: { Config: [{ dryRun: false }], 'Normalize email': [{ skip: true, skip_reason: 'mailing list', email: { message_id: 'm1', from_address: 'news@x.co', subject: 'Weekly' } }] },
  });
  assert.equal(out.json.outcome, 'skipped');
  assert.equal(out.json.summary, 'mailing list');
  assert.equal(out.json.category, '');
});
