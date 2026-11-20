#!/usr/bin/env node
// Generates the importable workflow JSON files in workflows/.
//   node src/build-workflows.mjs          (or: npm run build)
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'workflows');
const devDir = path.join(outDir, 'dev');
mkdirSync(devDir, { recursive: true });

const targets = [
  ['00-error-alerts.json', () => import('./workflows/error-alerts.mjs').then((m) => m.buildErrorAlerts())],
  ['01-ai-lead-qualifier.json', () => import('./workflows/lead-qualifier.mjs').then((m) => m.buildLeadQualifier())],
  ['02-ai-support-inbox-triage.json', () => import('./workflows/support-triage.mjs').then((m) => m.buildSupportInbox())],
  ['02b-ai-support-process-email.json', () => import('./workflows/support-triage.mjs').then((m) => m.buildSupportWorker())],
  ['03-ai-invoice-extraction.json', () => import('./workflows/invoice-extraction.mjs').then((m) => m.buildInvoiceExtraction())],
  ['dev/dev-error-smoke-test.json', () => import('./workflows/dev.mjs').then((m) => m.buildDevErrorSmokeTest())],
  ['dev/dev-support-triage-harness.json', () => import('./workflows/dev.mjs').then((m) => m.buildDevSupportHarness())],
];

const only = process.argv.slice(2);
for (const [file, build] of targets) {
  if (only.length && !only.some((o) => file.includes(o))) continue;
  const json = await build();
  writeFileSync(path.join(outDir, file), JSON.stringify(json, null, 2) + '\n');
  console.log(`wrote workflows/${file}  (${json.nodes.length} nodes)`);
}
