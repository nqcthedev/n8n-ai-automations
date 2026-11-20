/* global $ */
// Turn the Error Trigger payload into a readable alert.
// Handles both failure kinds n8n reports:
//  - execution errors:  { execution: { id, url, error, lastNodeExecuted, mode }, workflow }
//  - trigger/activation errors: { trigger: { error, mode }, workflow }
// Mode: Run once for all items.

const cfg = $('Config').first().json;
const e = $('Error Trigger').first().json;
const wf = e.workflow || {};
const exec = e.execution || null;
const trig = e.trigger || null;
const err = (exec && exec.error) || (trig && trig.error) || {};

const message = String(err.message || err.description || 'Unknown error').slice(0, 1000);
const failedNode = (err.node && err.node.name) || (exec && exec.lastNodeExecuted) || 'n/a';
const stackTop = String(err.stack || '').split('\n').slice(0, 4).join('\n').slice(0, 800);
const when = new Date().toISOString();
const kind = exec ? 'Execution failed' : 'Trigger / activation failed';
const url = (exec && exec.url) || '';

// Slack mrkdwn escaping for untrusted error text.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const slackText = [
  `:rotating_light: *${kind}: ${esc(wf.name || 'unknown workflow')}*`,
  `*Node:* ${esc(failedNode)}   *Mode:* ${esc((exec && exec.mode) || (trig && trig.mode) || 'n/a')}   *Time:* ${when}`,
  `*Error:* ${esc(message)}`,
  url ? `<${url}|Open execution ${exec.id}>` : (exec ? `Execution id: ${exec.id}` : ''),
  exec && exec.retryOf ? `_(retry of execution ${exec.retryOf})_` : '',
].filter(Boolean).join('\n');

const emailSubject = `[n8n] ${kind}: ${wf.name || 'unknown workflow'} (${failedNode})`;
const emailBody = [
  `${kind}`,
  ``,
  `Workflow:   ${wf.name || 'n/a'} (id ${wf.id || 'n/a'})`,
  `Node:       ${failedNode}`,
  `Execution:  ${exec ? exec.id : 'n/a'}`,
  `Link:       ${url || 'n/a'}`,
  `Time (UTC): ${when}`,
  ``,
  `Error:`,
  message,
  ``,
  stackTop ? `Stack (top):\n${stackTop}` : '',
].join('\n');

return [{
  json: {
    workflow_id: wf.id || null,
    workflow_name: wf.name || null,
    execution_id: exec ? exec.id : null,
    execution_url: url || null,
    failed_node: failedNode,
    error_message: message,
    kind,
    occurred_at: when,
    slack_text: slackText,
    email_subject: emailSubject,
    email_body: emailBody,
    alert_email_to: cfg.alertEmailTo,
  },
}];
