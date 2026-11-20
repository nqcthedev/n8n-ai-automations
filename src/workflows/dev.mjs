// Local-development helper workflows (imported by scripts/local-n8n.sh only).
// Do NOT import these into production.
import { Workflow, WORKFLOW_IDS, rl, stableId } from '../lib/builder.mjs';
import { addCode, addRespond } from './shared.mjs';
import { SUPPORT_WORKER_ID } from './support-triage.mjs';

/** POST /webhook/dev-fail -> fails on purpose -> triggers the error workflow. */
export function buildDevErrorSmokeTest() {
  const wf = new Workflow({
    id: WORKFLOW_IDS.devErrorSmokeTest,
    name: 'DEV - Error workflow smoke test',
    tags: ['dev'],
    description: 'Local testing only. Fails on purpose so the global error workflow runs.',
  });
  wf.node({
    name: 'Webhook: dev-fail',
    type: 'n8n-nodes-base.webhook',
    version: 2.1,
    at: [0, 0],
    webhookId: stableId('webhook:dev-fail'),
    parameters: { httpMethod: 'POST', path: 'dev-fail', responseMode: 'onReceived', options: {} },
  });
  wf.node({
    name: 'Simulated failure',
    type: 'n8n-nodes-base.stopAndError',
    version: 1,
    at: [1.2, 0],
    parameters: { errorType: 'errorMessage', errorMessage: '={{ "Simulated failure for smoke test " + ($json.body.marker || "") }}' },
  });
  wf.connect('Webhook: dev-fail', 'Simulated failure');
  return wf.toJSON();
}

/**
 * POST /webhook/dev-support-triage  { emails: [{ from, from_name, subject, body }] }
 * Runs each email through the real support worker sub-workflow (dry-run,
 * because the emails are marked as samples) and returns the log rows.
 */
export function buildDevSupportHarness() {
  const wf = new Workflow({
    id: 'n8nAiDevSupportH',
    name: 'DEV - Support triage test harness',
    tags: ['dev'],
    description: 'Local testing only. Feeds test emails into the support worker sub-workflow (dry run) and returns its results.',
  });
  wf.node({
    name: 'Webhook: dev-support-triage',
    type: 'n8n-nodes-base.webhook',
    version: 2.1,
    at: [0, 0],
    webhookId: stableId('webhook:dev-support-triage'),
    parameters: { httpMethod: 'POST', path: 'dev-support-triage', responseMode: 'responseNode', options: {} },
  });
  addCode(wf, 'To Gmail message shape', [1.2, 0], `// Convert simple test emails into the Gmail Trigger (Simplify OFF) shape.
const emails = ($input.first().json.body && $input.first().json.body.emails) || [];
return emails.map((e, i) => ({
  json: {
    id: 'test-' + i + '-' + Date.now(),
    threadId: 'test-thread-' + i,
    isSample: true, // forces dry run in the worker
    date: new Date().toISOString(),
    subject: e.subject || '',
    text: e.body || '',
    from: { value: [{ address: e.from || '', name: e.from_name || '' }], text: e.from || '' },
    headers: e.headers || {},
  },
}));
`);
  wf.node({
    name: 'Run support worker',
    type: 'n8n-nodes-base.executeWorkflow',
    version: 1.2,
    at: [2.4, 0],
    parameters: {
      source: 'database',
      workflowId: rl(SUPPORT_WORKER_ID, 'list', { cachedResultName: 'AI Support Inbox Triage - process one email' }),
      workflowInputs: { mappingMode: 'defineBelow', value: {}, matchingColumns: [], schema: [], attemptToConvertTypes: false, convertFieldsToString: true },
      mode: 'each',
      options: { waitForSubWorkflow: true },
    },
  });
  wf.node({
    name: 'Respond with results',
    type: 'n8n-nodes-base.respondToWebhook',
    version: 1.4,
    at: [3.6, 0],
    parameters: { respondWith: 'allIncomingItems', options: {} },
  });
  wf.connect('Webhook: dev-support-triage', 'To Gmail message shape');
  wf.connect('To Gmail message shape', 'Run support worker');
  wf.connect('Run support worker', 'Respond with results');
  return wf.toJSON();
}
