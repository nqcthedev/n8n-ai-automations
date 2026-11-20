#!/usr/bin/env node
// End-to-end test harness: drives the REAL workflows in a local n8n through
// their webhooks, with REAL LLM calls, and asserts on the responses.
//
//   npm run test:e2e              # starts a fresh local n8n, runs everything, stops it
//   npm run test:e2e -- --reuse   # use an already running instance (http://localhost:5678)
//   npm run test:e2e -- --no-outage
//
// Phase 1 (normal): lead qualifier, invoice extraction, support triage (via the
//   dev harness webhook -> real sub-workflow), global error workflow.
// Phase 2 (simulated LLM outage): n8n is restarted with a non-existent model
//   name, proving that leads still get logged as "needs_manual_review" and
//   invoices go to the review queue instead of failing.
//
// Runs with AUTOMATION_DRY_RUN=true: Slack / Gmail / Google Sheets are not
// called (those need client accounts). Everything else is real.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, openSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { N8nClient } from './lib/n8n-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.N8N_URL || 'http://localhost:5678';
const args = new Set(process.argv.slice(2));
const OUT_DIR = path.join(ROOT, 'test', 'output');
mkdirSync(OUT_DIR, { recursive: true });

const RUN = Date.now().toString(36);
const results = [];
const evidence = {};
let failures = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const c = { green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };

async function check(name, fn) {
  const t0 = Date.now();
  try {
    const info = await fn();
    const ms = Date.now() - t0;
    results.push({ name, ok: true, ms });
    console.log(`  ${c.green('✓')} ${name} ${c.dim(`(${ms} ms)`)}${info ? c.dim('  ' + info) : ''}`);
  } catch (e) {
    failures += 1;
    results.push({ name, ok: false, ms: Date.now() - t0, error: e.message });
    console.log(`  ${c.red('✗')} ${name}\n      ${c.red(e.message.split('\n').join('\n      '))}`);
  }
}

async function up() {
  try { return (await fetch(`${BASE}/healthz`)).ok; } catch { return false; }
}

// ------------------------------------------------------------ n8n lifecycle
let child = null;
async function startN8n(extraEnv = {}, mode = '') {
  const log = openSync(path.join(OUT_DIR, `n8n${mode ? '-' + mode.replace(/^--/, '') : ''}.log`), 'w');
  child = spawn('bash', [path.join(ROOT, 'scripts', 'local-n8n.sh'), ...(mode ? [mode] : [])], {
    cwd: ROOT, env: { ...process.env, ...extraEnv }, stdio: ['ignore', log, log], detached: true,
  });
  // Ready = webhooks registered: an invalid lead must get the 422 from the workflow.
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/webhook/lead-intake`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      if (r.status === 422) { await sleep(3000); return; }
    } catch { /* starting */ }
    if (child.exitCode !== null) throw new Error('n8n exited during start-up, see test/output/n8n*.log');
    await sleep(2000);
  }
  throw new Error('n8n did not become ready within 5 minutes');
}
async function stopN8n() {
  if (!child) return;
  try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
  for (let i = 0; i < 30 && (await up()); i++) await sleep(1000);
  child = null;
}

// ------------------------------------------------------------ HTTP helpers
async function postJson(p, body) {
  const r = await fetch(`${BASE}/webhook/${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
async function postFile(p, file) {
  const fd = new FormData();
  fd.append('file', new Blob([readFileSync(file)], { type: 'application/pdf' }), path.basename(file));
  const r = await fetch(`${BASE}/webhook/${p}`, { method: 'POST', body: fd });
  return { status: r.status, body: await r.json() };
}
const pdf = (n) => path.join(ROOT, 'samples', 'invoices', n);

// ------------------------------------------------------------ scenarios
const LEADS = {
  hot: {
    name: 'Maria Lopez', email: `maria.lopez+${RUN}@brightpath-logistics.com`, company: 'BrightPath Logistics', website: 'brightpath-logistics.com',
    message: 'We run a 40-person logistics company and want to automate our quote requests: customers email us PDFs and we retype them into our TMS. Looking for an AI workflow that extracts the data and drafts quotes. Budget around 15k USD, we would like to start next month.',
    budget: '~15k USD', timeline: 'start next month',
  },
  cold: {
    name: 'Tom', email: `tom.student+${RUN}@gmail.com`,
    message: 'hi, I am a student. can you design a logo for my school chess club for free? thanks',
  },
  spam: {
    name: 'SEO Pro Team', email: `offers+${RUN}@rank-boost-agency.example`, company: 'Rank Boost Agency',
    message: 'Dear Sir/Madam, we can get your website to #1 on Google in 30 days with our premium backlink package. Only $99! Reply now to claim the offer.',
  },
};

async function phaseNormal(api) {
  console.log(c.bold('\nAI Lead Qualifier  (POST /webhook/lead-intake)'));
  evidence.leads = {};
  await check('hot lead -> qualified, tier "hot", score >= 70, budget band 5k-20k', async () => {
    const r = await postJson('lead-intake', LEADS.hot);
    assert.equal(r.status, 200);
    const d = r.body.details;
    evidence.leads.hot = { request: LEADS.hot, response: r.body };
    assert.equal(r.body.status, 'received');
    assert.equal(d.qualification_status, 'qualified');
    assert.equal(d.tier, 'hot');
    assert.ok(d.score >= 70, `score ${d.score}`);
    assert.equal(d.budget_band, '5k-20k');
    assert.ok(d.suggested_reply.length > 100);
    assert.deepEqual(d.actions, [], 'dry run: no side effects');
    return `score=${d.score} intent=${d.intent} urgency=${d.urgency}`;
  });
  await check('poor-fit lead (student, free logo) -> score < 40', async () => {
    const r = await postJson('lead-intake', LEADS.cold);
    const d = r.body.details;
    evidence.leads.cold = { request: LEADS.cold, response: r.body };
    assert.equal(d.qualification_status, 'qualified');
    assert.ok(d.score < 40, `score ${d.score}`);
    assert.ok(['cold', 'spam'].includes(d.tier), d.tier);
    return `score=${d.score} intent=${d.intent} tier=${d.tier}`;
  });
  await check('SEO spam lead -> spam / vendor pitch, score < 40', async () => {
    const r = await postJson('lead-intake', LEADS.spam);
    const d = r.body.details;
    evidence.leads.spam = { request: LEADS.spam, response: r.body };
    assert.ok(['spam', 'vendor_pitch'].includes(d.intent), d.intent);
    assert.ok(d.score < 40, `score ${d.score}`);
    return `score=${d.score} intent=${d.intent} tier=${d.tier}`;
  });
  await check('duplicate submission (same email) -> "duplicate", no AI call', async () => {
    const r = await postJson('lead-intake', LEADS.hot);
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'duplicate');
  });
  await check('invalid submission -> HTTP 422 with field errors', async () => {
    const r = await postJson('lead-intake', { name: 'X', email: 'nope', message: '' });
    assert.equal(r.status, 422);
    assert.equal(r.body.status, 'rejected');
    assert.equal(r.body.errors.length, 3);
  });
  await check('honeypot filled -> silent 200 without processing', async () => {
    const r = await postJson('lead-intake', { ...LEADS.hot, email: `bot+${RUN}@x.io`, _gotcha: 'http://spam' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'received' });
  });

  console.log(c.bold('\nAI Invoice Extraction  (POST /webhook/invoice-upload)'));
  evidence.invoices = {};
  await check('invoice-01-valid.pdf -> valid, all fields extracted', async () => {
    const r = await postFile('invoice-upload', pdf('invoice-01-valid.pdf'));
    evidence.invoices.valid = r.body;
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'valid', JSON.stringify(r.body.issue_details));
    const inv = r.body.invoice;
    assert.equal(inv.vendor_name, 'Lumen Cloud Hosting Ltd');
    assert.equal(inv.invoice_number, 'INV-2026-0142');
    assert.equal(inv.issue_date, '2026-10-01');
    assert.equal(inv.due_date, '2026-10-31');
    assert.equal(inv.currency, 'USD');
    assert.equal(inv.line_items.length, 3);
    assert.equal(inv.subtotal, 383);
    assert.equal(inv.tax_amount, 38.3);
    assert.equal(inv.total, 421.3);
    return `${inv.vendor_name} ${inv.invoice_number} total=${inv.total} ${inv.currency}`;
  });
  await check('invoice-02-wrong-total.pdf -> needs_review: line items != subtotal', async () => {
    const r = await postFile('invoice-upload', pdf('invoice-02-wrong-total.pdf'));
    evidence.invoices.wrongTotal = r.body;
    assert.equal(r.body.status, 'needs_review');
    assert.ok(r.body.issues.includes('line_items_sum_mismatch'), JSON.stringify(r.body.issues));
    assert.equal(r.body.invoice.subtotal, 2540, 'model must copy the printed (wrong) subtotal, not fix it');
    return r.body.issue_details.join(' | ');
  });
  await check('invoice-03 (same number, different file) -> duplicate_invoice_number', async () => {
    const r = await postFile('invoice-upload', pdf('invoice-03-duplicate-resend.pdf'));
    evidence.invoices.duplicateNumber = r.body;
    assert.equal(r.body.status, 'needs_review');
    assert.deepEqual(r.body.issues, ['duplicate_invoice_number']);
  });
  await check('same PDF uploaded again -> duplicate_file (caught before the LLM)', async () => {
    const r = await postFile('invoice-upload', pdf('invoice-01-valid.pdf'));
    assert.deepEqual(r.body.issues, ['duplicate_file']);
    assert.equal(r.body.invoice, null);
  });
  await check('upload without a PDF -> HTTP 400', async () => {
    const fd = new FormData();
    fd.append('file', new Blob(['hello'], { type: 'text/plain' }), 'note.txt');
    const r = await fetch(`${BASE}/webhook/invoice-upload`, { method: 'POST', body: fd });
    assert.equal(r.status, 400);
  });

  console.log(c.bold('\nAI Support Inbox Triage  (dev harness -> real "process one email" sub-workflow)'));
  const emails = [
    { from: 'jordan.lee@northbeam-studio.example', from_name: 'Jordan Lee', subject: 'Charged twice this month?', body: 'Hi,\n\nI just noticed two charges of $39 on my card for November. We are on the Team plan with one seat. Can you refund the duplicate charge? Also, where can I download the invoice with our VAT number on it?\n\nThanks,\nJordan' },
    { from: 'priya.sharma@quantaops.example', from_name: 'Priya Sharma', subject: 'CSV export not working - urgent', body: 'Hello support,\n\nEvery time I try to export our customer list (about 120k rows) to CSV the browser just spins and nothing downloads. We need this report for a board meeting tomorrow morning. This is really frustrating.\n\nPriya' },
    { from: 'growth@seo-rank-boost.example', from_name: 'Rank Boost Agency', subject: 'Guaranteed #1 Google ranking for example.com', body: 'Dear website owner, we noticed your site is not ranking on page 1. Our link-building package guarantees #1 positions in 30 days for only $99. Reply YES to get started!' },
    { from: 'alex@partner.example', from_name: 'Alex', subject: 'Automatic reply: Out of office', body: 'I am out of the office until Monday.', headers: { 'auto-submitted': 'Auto-Submitted: auto-replied' } },
  ];
  let rows = [];
  await check('4 emails processed (one sub-workflow execution each)', async () => {
    const r = await postJson('dev-support-triage', { emails });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    rows = Array.isArray(r.body) ? r.body : [r.body];
    evidence.support = rows;
    assert.equal(rows.length, 4);
  });
  const row = (i) => rows[i] || {};
  await check('billing email -> category billing, grounded draft citing billing FAQ', async () => {
    const r = row(0);
    assert.equal(r.category, 'billing');
    assert.equal(r.outcome, 'dry_run');
    assert.match(r.faq_ids_used, /billing-(refund|invoice)/);
    assert.ok(r.reply_body.length > 80);
    assert.match(r.reply_body, /Settings > Billing/);
    return `urgency=${r.urgency} sentiment=${r.sentiment} faq=[${r.faq_ids_used}] attention=${r.needs_human_attention}`;
  });
  await check('CSV export complaint -> category bug, high/critical urgency, export FAQ used', async () => {
    const r = row(1);
    assert.equal(r.category, 'bug');
    assert.ok(['high', 'critical'].includes(r.urgency), r.urgency);
    assert.match(r.faq_ids_used, /bug-export/);
    return `urgency=${r.urgency} sentiment=${r.sentiment}`;
  });
  await check('SEO spam -> spam_ignored (no draft)', async () => {
    assert.equal(row(2).category, 'spam');
    assert.equal(row(2).outcome, 'spam_ignored');
    assert.equal(row(2).reply_body, '');
  });
  await check('auto-reply -> skipped before any AI call', async () => {
    assert.equal(row(3).outcome, 'skipped');
    assert.equal(row(3).category, '');
  });

  console.log(c.bold('\nError Alerts (global error workflow)'));
  await check('a failing production execution triggers the error workflow with node + error + link', async () => {
    const marker = `smoke-${RUN}`;
    const before = (await api.listExecutions('n8nAiErrorAlerts', 1))[0]?.id;
    await postJson('dev-fail', { marker });
    let alert = null;
    for (let i = 0; i < 20 && !alert; i++) {
      await sleep(1500);
      const [latest] = await api.listExecutions('n8nAiErrorAlerts', 1);
      if (latest && latest.id !== before && latest.status !== 'running') {
        const ex = await api.getExecution(latest.id);
        alert = N8nClient.nodeOutput(ex, 'Format alert')?.[0];
      }
    }
    assert.ok(alert, 'error workflow did not run');
    evidence.errorAlert = alert;
    assert.equal(alert.workflow_name, 'DEV - Error workflow smoke test');
    assert.equal(alert.failed_node, 'Simulated failure');
    assert.match(alert.error_message, new RegExp(marker));
    assert.match(alert.execution_url, /^http:\/\/localhost:5678\/workflow\/n8nAiDevErrorTst\/executions\/\d+$/);
    return alert.execution_url;
  });
}

async function phaseOutage() {
  console.log(c.bold('\nSimulated LLM outage (n8n restarted with LLM_MODEL=model-that-does-not-exist)'));
  evidence.outage = {};
  await check('lead is still accepted and marked needs_manual_review after retry + fallback', async () => {
    const lead = { ...LEADS.hot, email: `outage+${RUN}@brightpath-logistics.com` };
    const r = await postJson('lead-intake', lead);
    evidence.outage.lead = r.body;
    assert.equal(r.status, 200);
    assert.equal(r.body.status, 'received');
    assert.equal(r.body.details.qualification_status, 'needs_manual_review');
    assert.equal(r.body.details.tier, 'review');
    assert.equal(r.body.details.ai_attempts, 2);
    return r.body.details.ai_errors.slice(0, 120);
  });
  await check('invoice goes to the review queue with extraction_failed', async () => {
    // A fresh copy of the file content (different hash) so it is not a duplicate_file.
    const bytes = Buffer.concat([readFileSync(pdf('invoice-02-wrong-total.pdf')), Buffer.from(`\n%outage-test-${RUN}\n`)]);
    const fd = new FormData();
    fd.append('file', new Blob([bytes], { type: 'application/pdf' }), 'outage-test.pdf');
    const r = await (await fetch(`${BASE}/webhook/invoice-upload`, { method: 'POST', body: fd })).json();
    evidence.outage.invoice = r;
    assert.equal(r.status, 'needs_review');
    assert.deepEqual(r.issues, ['extraction_failed']);
  });
}

// ------------------------------------------------------------ main
const t0 = Date.now();
let owned = false;
try {
  if (await up()) {
    if (!args.has('--reuse')) {
      console.error(`n8n is already running at ${BASE}. Stop it (the harness starts a clean instance), or pass --reuse.`);
      process.exit(2);
    }
    console.log(`Using running n8n at ${BASE} (--reuse). Note: duplicate-detection state from earlier runs may differ.`);
  } else {
    console.log('Starting a fresh local n8n (import + publish workflows) ...');
    await startN8n();
    owned = true;
  }
  const api = new N8nClient(BASE, process.env.LOCAL_OWNER_EMAIL || 'admin@example.com', process.env.LOCAL_OWNER_PASSWORD || 'LocalDemo-2026');
  await phaseNormal(api);

  if (owned && !args.has('--no-outage')) {
    await stopN8n();
    console.log(c.dim('\nRestarting n8n with a broken model name ...'));
    await startN8n({ LLM_MODEL: 'model-that-does-not-exist', LLM_FALLBACK_MODEL: 'model-that-does-not-exist-either' }, '--no-import');
    await phaseOutage();
  }
} catch (e) {
  failures += 1;
  console.error(c.red(`\nHarness error: ${e.stack || e.message}`));
} finally {
  if (owned) await stopN8n();
}

const passed = results.filter((r) => r.ok).length;
writeFileSync(path.join(OUT_DIR, 'e2e-results.json'), JSON.stringify({ run: RUN, at: new Date().toISOString(), base: BASE, passed, failed: failures, results, evidence }, null, 2));
console.log(`\n${failures ? c.red(`${failures} failed`) : c.green('all passed')}: ${passed}/${results.length} checks in ${Math.round((Date.now() - t0) / 1000)} s` +
  c.dim(`  -> test/output/e2e-results.json`));
process.exit(failures ? 1 : 0);
