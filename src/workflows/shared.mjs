// Shared pieces used by several workflow definitions.
import { assignments, chatModelParams, CREDS } from '../lib/builder.mjs';

/** Expression helpers for reading env-driven configuration. */
export const envBool = (name, dflt = 'false') =>
  `={{ String($env.${name} || '${dflt}').toLowerCase() === 'true' }}`;
export const envNum = (name, dflt) => `={{ Number($env.${name} || ${dflt}) }}`;
export const envStr = (name, dflt) => `={{ $env.${name} || ${JSON.stringify(dflt)} }}`;

export const DEFAULT_BUSINESS_NAME = 'Acme Digital';
export const DEFAULT_BUSINESS_PROFILE =
  'Acme Digital is a 12-person studio that builds web apps, AI assistants and workflow automations ' +
  '(n8n, OpenAI/Gemini, CRM integrations) for small and mid-sized businesses. Typical project size: ' +
  'USD 3k-40k, 2-12 weeks. Ideal customers: SMBs and funded startups with a defined business problem ' +
  'and an internal owner. We do NOT offer: logo design, SEO link building, crypto/gambling projects, ' +
  'or hourly staff augmentation below 3 months.';

/** Primary model = cheap/fast, fallback model = used if the primary errors. */
export const MODEL_PRIMARY = envStr('LLM_MODEL', 'gemini-flash-lite-latest');
export const MODEL_FALLBACK = envStr('LLM_FALLBACK_MODEL', 'gemini-flash-latest');

/** Add an OpenAI-compatible chat model sub-node. */
export function addChatModel(wf, name, at, model = MODEL_PRIMARY, opts = {}) {
  return wf.node({
    name,
    type: '@n8n/n8n-nodes-langchain.lmChatOpenAi',
    version: 1.3,
    at,
    parameters: chatModelParams(model, opts),
    credentials: CREDS.llm,
  });
}

/** Basic LLM Chain root node with a system prompt and a user prompt. */
export function addLlmChain(wf, name, at, { system, user, fallback = false, notes }) {
  return wf.node({
    name,
    type: '@n8n/n8n-nodes-langchain.chainLlm',
    version: 1.9,
    at,
    parameters: {
      promptType: 'define',
      text: user,
      hasOutputParser: false,
      needsFallback: fallback,
      messages: { messageValues: [{ type: 'SystemMessagePromptTemplate', message: system }] },
      batching: {},
    },
    // Transport-level resilience: retry rate limits / timeouts before failing.
    retryOnFail: true,
    maxTries: 2,
    waitBetweenTries: 5000,
    // Never crash the workflow on an LLM failure: route to the error output.
    onError: 'continueErrorOutput',
    ...(notes ? { notes, notesInFlow: false } : {}),
  });
}

export function addCode(wf, name, at, jsCode, { mode = 'runOnceForAllItems', notes } = {}) {
  return wf.node({
    name,
    type: 'n8n-nodes-base.code',
    version: 2,
    at,
    parameters: { mode, language: 'javaScript', jsCode },
    ...(notes ? { notes } : {}),
  });
}

export function addSet(wf, name, at, list, { includeOtherFields = false, keepBinary = false } = {}) {
  return wf.node({
    name,
    type: 'n8n-nodes-base.set',
    version: 3.4,
    at,
    parameters: {
      mode: 'manual',
      assignments: assignments(list),
      includeOtherFields,
      ...(includeOtherFields ? { include: 'all' } : {}),
      options: keepBinary ? { stripBinary: false } : {},
    },
  });
}

export function addIf(wf, name, at, conds, combinator = 'and') {
  return wf.node({
    name,
    type: 'n8n-nodes-base.if',
    version: 2.2,
    at,
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
        conditions: conds,
        combinator,
      },
      looseTypeValidation: true,
      options: {},
    },
  });
}

export function addRespond(wf, name, at, bodyExpr, codeExpr) {
  return wf.node({
    name,
    type: 'n8n-nodes-base.respondToWebhook',
    version: 1.4,
    at,
    parameters: {
      respondWith: 'json',
      responseBody: bodyExpr,
      options: { responseCode: codeExpr },
    },
  });
}

/** Slack "post message" to a channel given by name (e.g. #sales-leads). */
export function addSlackPost(wf, name, at, channelExpr, textExpr, extra = {}) {
  return wf.node({
    name,
    type: 'n8n-nodes-base.slack',
    version: 2.3,
    at,
    parameters: {
      select: 'channel',
      channelId: { __rl: true, value: channelExpr, mode: 'name' },
      text: textExpr,
      otherOptions: { includeLinkToWorkflow: false, mrkdwn: true },
    },
    credentials: CREDS.slack,
    ...extra,
  });
}

/** Google Sheets append with auto-mapped columns (sheet header row = field names). */
export function addSheetsAppend(wf, name, at, sheetTab, extra = {}) {
  return wf.node({
    name,
    type: 'n8n-nodes-base.googleSheets',
    version: 4.6,
    at,
    parameters: {
      operation: 'append',
      documentId: { __rl: true, value: "={{ $('Config').first().json.sheetId }}", mode: 'id' },
      sheetName: { __rl: true, value: sheetTab, mode: 'name' },
      columns: {
        mappingMode: 'autoMapInputData',
        value: {},
        matchingColumns: [],
        schema: [],
        attemptToConvertTypes: false,
        convertFieldsToString: false,
      },
      options: { handlingExtraData: 'ignoreIt', cellFormat: 'RAW' },
    },
    credentials: CREDS.sheets,
    ...extra,
  });
}
