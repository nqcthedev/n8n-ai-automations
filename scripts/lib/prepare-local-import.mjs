#!/usr/bin/env node
// Stage workflows + credentials for a local `n8n import:*`.
// usage: node prepare-local-import.mjs <workflowsDir> <stageDir>
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const [wfDir, stage] = process.argv.slice(2);
const env = process.env;

// Workflows that should be active (published) locally.
// Order matters: sub-workflows must be published before their callers.
const PUBLISH = ['n8nAiErrorAlerts', 'n8nAiLeadQualify', 'n8nAiInvoiceExtr', 'n8nAiSupportWork', 'n8nAiDevErrorTst', 'n8nAiDevSupportH'];
const disableGmail = (env.LOCAL_DISABLE_GMAIL_TRIGGERS ?? 'true') === 'true';

const files = [
  ...readdirSync(wfDir).filter((f) => f.endsWith('.json')).map((f) => path.join(wfDir, f)),
  ...readdirSync(path.join(wfDir, 'dev')).filter((f) => f.endsWith('.json')).map((f) => path.join(wfDir, 'dev', f)),
];
for (const file of files) {
  const wf = JSON.parse(readFileSync(file, 'utf8'));
  if (disableGmail) {
    for (const n of wf.nodes) {
      if (n.type === 'n8n-nodes-base.gmailTrigger') n.disabled = true;
    }
  }
  writeFileSync(path.join(stage, 'workflows', path.basename(file)), JSON.stringify(wf, null, 2));
}
writeFileSync(path.join(stage, 'publish-ids.txt'), PUBLISH.join('\n') + '\n');

// Credentials: real LLM credential, placeholders for the rest (cannot connect).
const placeholder = 'local-placeholder-not-a-real-secret';
const creds = [
  {
    id: 'llmOpenAiCompat1', name: 'OpenAI-compatible LLM', type: 'openAiApi',
    data: { apiKey: env.LLM_API_KEY, url: (env.LLM_BASE_URL || '').replace(/\/+$/, ''), header: false },
  },
  { id: 'slackBotToken001', name: 'Slack bot', type: 'slackApi', data: { accessToken: placeholder } },
  { id: 'gmailOAuth2Acct1', name: 'Gmail account', type: 'gmailOAuth2', data: { clientId: placeholder, clientSecret: placeholder } },
  { id: 'gSheetsOAuth2001', name: 'Google Sheets account', type: 'googleSheetsOAuth2Api', data: { clientId: placeholder, clientSecret: placeholder } },
];
writeFileSync(path.join(stage, 'credentials.json'), JSON.stringify(creds, null, 2), { mode: 0o600 });
console.log(`staged ${files.length} workflows, ${creds.length} credentials`);
