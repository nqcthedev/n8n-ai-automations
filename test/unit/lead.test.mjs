import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeNode } from '../lib/code-node.mjs';

const WF = '01-ai-lead-qualifier.json';
const config = { dryRun: true, hotScoreThreshold: 70, dedupeWindowHours: 72, responseDetails: true, slackChannel: '#sales' };
const webhook = (body) => ({ 'Website form webhook': [{ body, headers: {}, query: {} }], Config: [config] });

const validate = codeNode(WF, 'Validate & normalize lead');
const dedupe = codeNode(WF, 'Dedupe (72h window)');
const parseAi = codeNode(WF, 'Validate AI output');
const parseAiRetry = codeNode(WF, 'Validate AI output (retry)');
const buildRecord = codeNode(WF, 'Build lead record');
const buildResponse = codeNode(WF, 'Build webhook response');

test('valid submission is normalized', async () => {
  const [out] = await validate({
    items: [config],
    nodes: webhook({ name: '  Maria <b>Lopez</b> ', email: 'Maria@BrightPath.COM ', message: 'We need an AI workflow for quotes.', website: 'brightpath.com', phone: '+1 (555) 010-2030' }),
  });
  assert.equal(out.json.ok, true);
  const { lead, llm_input: llm } = out.json;
  assert.equal(lead.name, 'Maria Lopez');
  assert.equal(lead.email, 'maria@brightpath.com');
  assert.equal(lead.website, 'https://brightpath.com');
  assert.equal(lead.website_domain, 'brightpath.com');
  assert.equal(lead.phone, '+15550102030');
  assert.match(lead.lead_id, /^lead_/);
  assert.equal(llm.email_is_free_provider, false);
  assert.equal(llm.lead_id, undefined, 'internal ids are not sent to the LLM');
});

test('invalid submission is rejected with 422 and field errors', async () => {
  const [out] = await validate({ items: [config], nodes: webhook({ name: 'A', email: 'not-an-email', message: 'hi' }) });
  assert.equal(out.json.ok, false);
  assert.equal(out.json.httpStatus, 422);
  assert.equal(out.json.errors.length, 3);
  assert.equal(out.json.responseBody.status, 'rejected');
});

test('disposable email domains are rejected', async () => {
  const [out] = await validate({ items: [config], nodes: webhook({ name: 'Bob', email: 'bob@mailinator.com', message: 'Please call me about a project' }) });
  assert.equal(out.json.ok, false);
  assert.match(out.json.errors.join(), /permanent email/);
});

test('honeypot submissions get a silent 200', async () => {
  const [out] = await validate({ items: [config], nodes: webhook({ name: 'Bot', email: 'bot@spam.com', message: 'Buy now buy now', _gotcha: 'x' }) });
  assert.equal(out.json.ok, false);
  assert.equal(out.json.spam, true);
  assert.equal(out.json.httpStatus, 200);
  assert.deepEqual(out.json.responseBody, { status: 'received' });
});

test('form-encoded string body that is JSON is parsed', async () => {
  const [out] = await validate({ items: [config], nodes: webhook(JSON.stringify({ name: 'Ann', email: 'ann@acme.io', message: 'Need a chatbot for support' })) });
  assert.equal(out.json.ok, true);
});

test('dedupe: same email within the window is a duplicate', async () => {
  const staticData = {};
  const item = { ok: true, lead: { email: 'a@b.co' } };
  const [first] = await dedupe({ items: [item], nodes: { Config: [config] }, staticData });
  const [second] = await dedupe({ items: [item], nodes: { Config: [config] }, staticData });
  assert.equal(first.json.duplicate, false);
  assert.equal(second.json.duplicate, true);
  assert.ok(second.json.previous_submission_at);
});

test('dedupe: expired entries are pruned', async () => {
  const staticData = { leadsSeen: { 'old@x.co': Date.now() - 100 * 3600e3 } };
  const [out] = await dedupe({ items: [{ lead: { email: 'old@x.co' } }], nodes: { Config: [config] }, staticData });
  assert.equal(out.json.duplicate, false);
});

const goodAi = { company: 'BrightPath', intent: 'quote_request', budget_band: '5k-20k', urgency: 'high', score: 88, reasoning: 'Clear need and budget.', suggested_reply: 'Hi Maria, thanks for reaching out about automating quotes. Could we book a 15-minute call next week?' };

test('AI output: unwrapped JSON object (JSON mode) is accepted', async () => {
  const [out] = await parseAi({ items: [goodAi] });
  assert.equal(out.json.aiValid, true, out.json.aiErrors.join());
  assert.equal(out.json.ai.score, 88);
  assert.equal(out.json.attempt, 1);
});

test('AI output: {text} with markdown fences is accepted', async () => {
  const [out] = await parseAiRetry({ items: [{ text: '```json\n' + JSON.stringify({ ...goodAi, score: '72' }) + '\n```' }] });
  assert.equal(out.json.aiValid, true);
  assert.equal(out.json.ai.score, 72);
  assert.equal(out.json.attempt, 2);
});

test('AI output: invalid enum / range values are rejected with reasons', async () => {
  const [out] = await parseAi({ items: [{ ...goodAi, intent: 'buying stuff', score: 140, budget_band: 'lots' }] });
  assert.equal(out.json.aiValid, false);
  assert.equal(out.json.aiErrors.length, 3);
  assert.equal(out.json.ai, null);
});

test('AI output: spam with a high score is inconsistent', async () => {
  const [out] = await parseAi({ items: [{ ...goodAi, intent: 'spam', score: 90 }] });
  assert.equal(out.json.aiValid, false);
  assert.match(out.json.aiErrors.join(), /spam leads must score/);
});

test('AI output: non-JSON text and API errors are invalid', async () => {
  const [a] = await parseAi({ items: [{ text: 'Sure! The lead looks great.' }] });
  const [b] = await parseAi({ items: [{ error: 'Request failed with status code 429' }] });
  assert.equal(a.json.aiValid, false);
  assert.equal(b.json.aiValid, false);
  assert.match(b.json.aiErrors[0], /429/);
});

const lead = { lead_id: 'lead_1', received_at: 'now', name: 'Eve <!channel>', email: 'eve@x.co', company: 'X', phone: '', website: '', message: 'Hello <@U123> please ping everyone', budget_stated: '', timeline_stated: '', source: 'website' };

test('record: tiers follow the score threshold; Slack text is escaped', async () => {
  const run = (ai) => buildRecord({ items: [{ aiValid: true, ai, attempt: 1, aiErrors: [] }], nodes: { Config: [config], 'Dedupe (72h window)': [{ lead }] } });
  assert.equal((await run({ ...goodAi, score: 70 }))[0].json.tier, 'hot');
  assert.equal((await run({ ...goodAi, score: 69 }))[0].json.tier, 'warm');
  assert.equal((await run({ ...goodAi, score: 39 }))[0].json.tier, 'cold');
  assert.equal((await run({ ...goodAi, intent: 'spam', score: 5 }))[0].json.tier, 'spam');
  const [hot] = await run(goodAi);
  assert.ok(!hot.json.slack_text.includes('<!channel>'), 'no raw Slack mention');
  assert.ok(hot.json.slack_text.includes('&lt;!channel&gt;'));
});

test('record: failed AI becomes needs_manual_review, never dropped', async () => {
  const [out] = await buildRecord({ items: [{ aiValid: false, ai: null, attempt: 2, aiErrors: ['bad'] }], nodes: { Config: [config], 'Dedupe (72h window)': [{ lead }] } });
  assert.equal(out.json.status, 'needs_manual_review');
  assert.equal(out.json.tier, 'review');
  assert.equal(out.json.ai_errors, 'bad');
});

test('response hides AI details unless enabled', async () => {
  const rec = { lead_id: 'lead_1', status: 'qualified', tier: 'hot', score: 90 };
  const [withDetails] = await buildResponse({ nodes: { Config: [config], 'Build lead record': [rec] } });
  const [without] = await buildResponse({ nodes: { Config: [{ ...config, responseDetails: false }], 'Build lead record': [rec] } });
  assert.equal(withDetails.json.body.details.tier, 'hot');
  assert.equal(without.json.body.details, undefined);
  assert.equal(without.json.body.lead_id, 'lead_1');
});
