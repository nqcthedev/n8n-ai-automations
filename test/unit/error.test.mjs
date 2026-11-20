import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeNode } from '../lib/code-node.mjs';

const format = codeNode('00-error-alerts.json', 'Format alert');
const config = { dryRun: true, alertEmailTo: 'ops@example.com' };
// The formatter reads the payload from the "Error Trigger" node (its direct input is the Config node).
const run = (payload) => format({ items: [config], nodes: { Config: [config], 'Error Trigger': [payload] } });

test('execution error alert contains workflow, node, error and link', async () => {
  const [out] = await run({
      execution: { id: '231', url: 'https://n8n.example.com/workflow/abc/executions/231', mode: 'webhook', lastNodeExecuted: 'Sheets', error: { message: 'Quota exceeded <script>', node: { name: 'Log lead to Google Sheets' } } },
      workflow: { id: 'abc', name: 'AI Lead Qualifier' },
  });
  const j = out.json;
  assert.equal(j.failed_node, 'Log lead to Google Sheets');
  assert.equal(j.execution_url, 'https://n8n.example.com/workflow/abc/executions/231');
  assert.match(j.slack_text, /AI Lead Qualifier/);
  assert.match(j.slack_text, /<https:\/\/n8n\.example\.com\/workflow\/abc\/executions\/231\|Open execution 231>/);
  assert.ok(j.slack_text.includes('&lt;script&gt;'));
  assert.match(j.email_subject, /Execution failed: AI Lead Qualifier \(Log lead to Google Sheets\)/);
});

test('trigger/activation errors are handled', async () => {
  const [out] = await run({ trigger: { error: { message: 'Gmail auth expired' }, mode: 'trigger' }, workflow: { id: 'x', name: 'AI Invoice Extraction' } });
  assert.equal(out.json.kind, 'Trigger / activation failed');
  assert.equal(out.json.execution_id, null);
  assert.match(out.json.email_body, /Gmail auth expired/);
});
