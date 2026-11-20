import { Workflow, WORKFLOW_IDS, CREDS, code, cond } from '../lib/builder.mjs';
import { addCode, addIf, addSet, addSlackPost, envBool, envStr } from './shared.mjs';

export function buildErrorAlerts() {
  const wf = new Workflow({
    id: WORKFLOW_IDS.errorHandler,
    name: 'Error Alerts (global error workflow)',
    tags: ['ops', 'portfolio'],
    errorWorkflow: null, // an error workflow must not point at itself
    description: 'Set as "Error workflow" in the settings of every production workflow. Alerts Slack + email with workflow, node, error and execution link.',
  });

  wf.sticky('Note: error', '## Global error workflow\nEvery workflow in this repo has **Settings -> Error workflow** set to this one.\nWhen a production execution fails, n8n starts this workflow with the workflow name, failed node, error and a link to the execution.\nSlack and email are sent independently: if one channel is down the other still goes out.', [-0.3, -1.5], { width: 1550, height: 260, color: 3 });

  wf.node({
    name: 'Error Trigger',
    type: 'n8n-nodes-base.errorTrigger',
    version: 1,
    at: [0, 0.2],
    parameters: {},
  });
  addSet(wf, 'Config', [1, 0.2], [
    ['dryRun', 'boolean', envBool('AUTOMATION_DRY_RUN')],
    ['slackChannel', 'string', envStr('SLACK_CHANNEL_ALERTS', '#n8n-alerts')],
    ['alertEmailTo', 'string', envStr('ALERT_EMAIL_TO', 'ops@example.com')],
  ]);
  addCode(wf, 'Format alert', [2, 0.2], code('error/format-alert.js'));
  addIf(wf, 'Dry run?', [3, 0.2], [cond("={{ $('Config').first().json.dryRun }}", 'boolean', 'true')]);
  wf.node({
    name: 'Dry run: alert not sent',
    type: 'n8n-nodes-base.noOp',
    version: 1,
    at: [4.2, -0.4],
    parameters: {},
  });
  addSlackPost(wf, 'Slack: alert channel', [4.2, 0.6],
    "={{ $('Config').first().json.slackChannel }}",
    '={{ $json.slack_text }}',
    { onError: 'continueRegularOutput', retryOnFail: true, maxTries: 3, waitBetweenTries: 5000 });
  wf.node({
    name: 'Gmail: alert email',
    type: 'n8n-nodes-base.gmail',
    version: 2.1,
    at: [4.2, 1.5],
    parameters: {
      sendTo: '={{ $json.alert_email_to }}',
      subject: '={{ $json.email_subject }}',
      emailType: 'text',
      message: '={{ $json.email_body }}',
      options: { appendAttribution: false },
    },
    credentials: CREDS.gmail,
    onError: 'continueRegularOutput',
    retryOnFail: true,
    maxTries: 3,
    waitBetweenTries: 5000,
  });

  wf.connect('Error Trigger', 'Config');
  wf.connect('Config', 'Format alert');
  wf.connect('Format alert', 'Dry run?');
  wf.connect('Dry run?', 'Dry run: alert not sent', 0);
  wf.connect('Dry run?', 'Slack: alert channel', 1);
  wf.connect('Dry run?', 'Gmail: alert email', 1);
  return wf.toJSON();
}
