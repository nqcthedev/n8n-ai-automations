#!/usr/bin/env node
// Capture clean screenshots of every workflow canvas and of one successful
// execution per workflow, at 2x device scale, into docs/screenshots/.
//
//   npm run local          # terminal 1 (fresh import)
//   npm run screenshots    # terminal 2
//
// The script first creates fresh demo executions through the webhooks (real
// LLM calls, dry-run side effects), then logs into the editor with the local
// owner account and screenshots the canvases. Requires Playwright + Chromium.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { N8nClient } from '../test/lib/n8n-api.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.N8N_URL || 'http://localhost:5678';
const OUT = path.join(ROOT, 'docs', 'screenshots');
const EMAIL = process.env.LOCAL_OWNER_EMAIL || 'admin@example.com';
const PASSWORD = process.env.LOCAL_OWNER_PASSWORD || 'LocalDemo-2026';
const ONLY = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const nonce = Date.now().toString(36);

const api = new N8nClient(BASE, EMAIL, PASSWORD);
await api.login();

async function latestExecution(workflowId, after) {
  for (let i = 0; i < 40; i++) {
    const [e] = await api.listExecutions(workflowId, 1);
    if (e && e.id !== after && e.status === 'success') return e.id;
    await sleep(1000);
  }
  throw new Error(`no new successful execution for ${workflowId}`);
}
const lastId = async (wf) => (await api.listExecutions(wf, 1))[0]?.id;

// ---------------------------------------------------------------- demo runs
// EXEC_IDS='{"lead":"1","invoice":"2","support":"3","error":"4"}' reuses existing executions.
const exec = process.env.EXEC_IDS ? JSON.parse(process.env.EXEC_IDS) : {};
if (!process.env.EXEC_IDS) {
console.log('Creating demo executions ...');
{
  const before = await lastId('n8nAiLeadQualify');
  await fetch(`${BASE}/webhook/lead-intake`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Maria Lopez', email: `maria.lopez+${nonce}@brightpath-logistics.com`, company: 'BrightPath Logistics',
      message: 'We run a 40-person logistics company and want to automate our quote requests: customers email us PDFs and we retype them into our TMS. Looking for an AI workflow that extracts the data and drafts quotes. Budget around 15k USD, we would like to start next month.',
      budget: '~15k USD', timeline: 'start next month',
    }),
  });
  exec.lead = await latestExecution('n8nAiLeadQualify', before);
}
{
  const before = await lastId('n8nAiInvoiceExtr');
  const bytes = Buffer.concat([readFileSync(path.join(ROOT, 'samples/invoices/invoice-02-wrong-total.pdf')), Buffer.from(`\n%demo-${nonce}\n`)]);
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type: 'application/pdf' }), 'invoice-02-wrong-total.pdf');
  await fetch(`${BASE}/webhook/invoice-upload`, { method: 'POST', body: fd });
  exec.invoice = await latestExecution('n8nAiInvoiceExtr', before);
}
{
  const before = await lastId('n8nAiSupportWork');
  await fetch(`${BASE}/webhook/dev-support-triage`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ emails: [{ from: 'jordan.lee@northbeam-studio.example', from_name: 'Jordan Lee', subject: 'Charged twice this month?', body: 'Hi,\n\nI just noticed two charges of $39 on my card for November. We are on the Team plan with one seat. Can you refund the duplicate charge? Also, where can I download the invoice with our VAT number on it?\n\nThanks,\nJordan' }] }),
  });
  exec.support = await latestExecution('n8nAiSupportWork', before);
}
{
  const before = await lastId('n8nAiErrorAlerts');
  await fetch(`${BASE}/webhook/dev-fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ marker: 'demo' }) });
  exec.error = await latestExecution('n8nAiErrorAlerts', before);
}
}
console.log('executions:', exec);

// ---------------------------------------------------------------- browser
const VIEW = { width: 1920, height: 1080 };
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: VIEW, deviceScaleFactor: 2 });
await context.addCookies(api.cookie.split('; ').map((kv) => {
  const i = kv.indexOf('=');
  return { name: kv.slice(0, i), value: kv.slice(i + 1), domain: 'localhost', path: '/' };
}));
const page = await context.newPage();

// Hide editor chrome that is irrelevant in a portfolio screenshot.
const CLEAN_CSS = `
  [data-test-id="logs-panel"], [data-test-id="canvas-controls"], [data-test-id="canvas-minimap"],
  .vue-flow__minimap, [data-test-id="ask-assistant-floating-button"], [data-test-id="ask-assistant-sidebar"],
  [data-test-id="version-updates-panel"], [data-test-id="banner-stack"], .el-notification,
  [data-test-id="executions-sidebar"], [data-test-id="execute-workflow-button"],
  [data-test-id="execution-debug-button"], [data-test-id="execution-preview-delete-button"],
  .el-popper, .el-popover, [class*="_popoverContent_"],
  [data-test-id="canvas-wrapper"] [class*="_toolbar_"][class*="_vertical_"] { display: none !important; }
`;

// Park the mouse in a corner so no hover toolbars / tooltips end up in the shot.
async function parkMouse() {
  await page.mouse.move(VIEW.width - 4, VIEW.height - 4);
  await sleep(400);
}

async function prepare() {
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape');
  await page.addStyleTag({ content: CLEAN_CSS });
  await sleep(500);
}

async function fit() {
  const btn = page.locator('[data-test-id="zoom-to-fit"]').first();
  // The button is hidden by CSS; trigger it programmatically, fall back to the "1" shortcut.
  const clicked = await btn.evaluate((el) => { el.click(); return true; }).catch(() => false);
  if (!clicked) {
    await page.locator('.vue-flow__pane').first().click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('1');
  }
  await sleep(1200);
}

/** Zoom/pan the canvas so that `box()` fills most of the viewport. */
async function zoomTo(getBox) {
  const pane = page.locator('.vue-flow__pane').first();
  const paneBox = await pane.boundingBox();
  for (let i = 0; i < 40; i++) {
    const b = await getBox();
    const fx = (paneBox.width * 0.94) / b.width;
    const fy = (paneBox.height * 0.88) / b.height;
    const f = Math.min(fx, fy);
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    const tx = paneBox.x + paneBox.width / 2;
    const ty = paneBox.y + paneBox.height / 2;
    if (Math.abs(f - 1) < 0.04 && Math.abs(cx - tx) < 12 && Math.abs(cy - ty) < 12) break;
    if (Math.abs(cx - tx) >= 12 || Math.abs(cy - ty) >= 12) {
      await page.mouse.move(tx, ty);
      await page.mouse.wheel(cx - tx, cy - ty); // plain wheel pans the canvas
    } else {
      await page.mouse.move(cx, cy);
      await page.keyboard.down('Control');
      await page.mouse.wheel(0, f > 1 ? -Math.min(60, (f - 1) * 120) : Math.min(60, (1 - f) * 120));
      await page.keyboard.up('Control');
    }
    await sleep(250);
  }
  await sleep(600);
}

async function stickyBoxes() {
  const stickies = page.locator('[data-test-id="sticky"]');
  const n = await stickies.count();
  const out = [];
  for (let i = 0; i < n; i++) out.push(stickies.nth(i));
  return out;
}

/**
 * Screenshot a workflow canvas (or an execution of it):
 *  - <name>.png            whole workflow, zoomed to fit
 *  - <name>-part<N>.png    one shot per sticky-note section, zoomed in (if sections > 1)
 */
async function shoot(name, url, { sections = true } = {}) {
  if (ONLY.length && !ONLY.some((o) => name.includes(o))) return;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.locator('.vue-flow__pane').first().waitFor({ timeout: 30000 });
  await prepare();
  await fit();
  // Overview: crop to the workflow content (nodes + sticky notes) plus a margin.
  const box = await page.evaluate(() => {
    const els = [...document.querySelectorAll('.vue-flow__node')];
    const r = els.map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0);
    return { x1: Math.min(...r.map((b) => b.left)), y1: Math.min(...r.map((b) => b.top)), x2: Math.max(...r.map((b) => b.right)), y2: Math.max(...r.map((b) => b.bottom)) };
  });
  const m = 40;
  const clip = { x: Math.max(0, box.x1 - m), y: Math.max(0, box.y1 - m) };
  clip.width = Math.min(VIEW.width, box.x2 + m) - clip.x;
  clip.height = Math.min(VIEW.height, box.y2 + m + 20) - clip.y;
  await parkMouse();
  await page.screenshot({ path: path.join(OUT, `${name}.png`), clip });
  console.log('saved', `docs/screenshots/${name}.png`);
  if (!sections) return;
  const parts = await stickyBoxes();
  if (parts.length < 2) return;
  for (let i = 0; i < parts.length; i++) {
    await fit();
    await zoomTo(() => parts[i].boundingBox());
    await parkMouse();
    await page.screenshot({ path: path.join(OUT, `${name}-part${i + 1}.png`) });
    console.log('saved', `docs/screenshots/${name}-part${i + 1}.png`);
  }
}

const W = {
  lead: 'n8nAiLeadQualify', support: 'n8nAiSupportTria', supportWorker: 'n8nAiSupportWork',
  invoice: 'n8nAiInvoiceExtr', error: 'n8nAiErrorAlerts',
};
await shoot('01-lead-qualifier-canvas', `${BASE}/workflow/${W.lead}`);
await shoot('01-lead-qualifier-execution', `${BASE}/workflow/${W.lead}/executions/${exec.lead}`);
await shoot('02-support-inbox-canvas', `${BASE}/workflow/${W.support}`, { sections: false });
await shoot('02-support-worker-canvas', `${BASE}/workflow/${W.supportWorker}`);
await shoot('02-support-worker-execution', `${BASE}/workflow/${W.supportWorker}/executions/${exec.support}`);
await shoot('03-invoice-extraction-canvas', `${BASE}/workflow/${W.invoice}`);
await shoot('03-invoice-extraction-execution', `${BASE}/workflow/${W.invoice}/executions/${exec.invoice}`);
await shoot('00-error-alerts-canvas', `${BASE}/workflow/${W.error}`, { sections: false });
await shoot('00-error-alerts-execution', `${BASE}/workflow/${W.error}/executions/${exec.error}`, { sections: false });

await browser.close();
