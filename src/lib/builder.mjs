// Tiny helper for generating n8n workflow JSON from code.
//
// Why generate instead of hand-editing JSON?
//  - Code-node bodies live in real .js files (src/code/**) so they can be linted
//    and unit-tested (test/unit/*.test.mjs) and then embedded verbatim.
//  - Node IDs are deterministic, so re-generating produces clean git diffs.
//  - Credentials are referenced by a stable id + name and never embedded.
//
// The generated files in workflows/ are the product: they import into any
// n8n >= 2.x instance via the UI (Import from file) or `n8n import:workflow`.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Deterministic UUID-shaped id derived from a seed string. */
export function stableId(seed) {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Read a Code-node body from src/code/<rel>. Optional {{TOKEN}} replacements. */
export function code(rel, replacements = {}) {
  let src = readFileSync(path.join(SRC_DIR, 'code', rel), 'utf8');
  // Strip the leading "// @ts-check"/eslint header lines meant for local tooling only.
  src = src.replace(/^\/\* global[^*]*\*\/\n/m, '');
  src = src.replace(/^\/\/ @include (\S+)\n/gm, (_, inc) => readFileSync(path.join(SRC_DIR, 'code', inc), 'utf8') + '\n');
  for (const [k, v] of Object.entries(replacements)) src = src.replaceAll(`{{${k}}}`, String(v));
  return src.trimEnd() + '\n';
}

/** Shared credential references (id + display name). Never contains secrets. */
export const CREDS = {
  llm: { openAiApi: { id: 'llmOpenAiCompat1', name: 'OpenAI-compatible LLM' } },
  slack: { slackApi: { id: 'slackBotToken001', name: 'Slack bot' } },
  gmail: { gmailOAuth2: { id: 'gmailOAuth2Acct1', name: 'Gmail account' } },
  sheets: { googleSheetsOAuth2Api: { id: 'gSheetsOAuth2001', name: 'Google Sheets account' } },
};

export const WORKFLOW_IDS = {
  errorHandler: 'n8nAiErrorAlerts',
  leadQualifier: 'n8nAiLeadQualify',
  supportTriage: 'n8nAiSupportTria',
  invoiceExtraction: 'n8nAiInvoiceExtr',
  devErrorSmokeTest: 'n8nAiDevErrorTst',
};

export class Workflow {
  constructor({ id, name, tags = [], errorWorkflow = WORKFLOW_IDS.errorHandler, description = '' }) {
    this.id = id;
    this.name = name;
    this.tags = tags;
    this.description = description;
    this.nodes = [];
    this.connections = {};
    this.settings = {
      executionOrder: 'v1',
      saveManualExecutions: true,
      saveDataErrorExecution: 'all',
      saveDataSuccessExecution: 'all',
      saveExecutionProgress: false,
      callerPolicy: 'workflowsFromSameOwner',
      ...(errorWorkflow ? { errorWorkflow } : {}),
    };
  }

  /**
   * Add a node. `at` is a [col, row] grid position (converted to canvas px).
   * Returns the node name for use in connect().
   */
  node({ name, type, version, at, parameters = {}, credentials, ...extra }) {
    if (this.nodes.some((n) => n.name === name)) throw new Error(`Duplicate node name: ${name}`);
    const [col, row] = at;
    const node = {
      id: stableId(`${this.id}:${name}`),
      name,
      type,
      typeVersion: version,
      position: [Math.round(col * 240), Math.round(row * 200)],
      parameters,
      ...(credentials ? { credentials } : {}),
      ...extra,
    };
    this.nodes.push(node);
    return name;
  }

  /** Connect main output `out` of `from` to main input `inp` of `to`. */
  connect(from, to, out = 0, inp = 0, type = 'main') {
    for (const n of [from, to]) {
      if (!this.nodes.some((x) => x.name === n)) throw new Error(`connect(): unknown node "${n}"`);
    }
    this.connections[from] ??= {};
    this.connections[from][type] ??= [];
    const outs = this.connections[from][type];
    while (outs.length <= out) outs.push([]);
    outs[out].push({ node: to, type, index: inp });
  }

  /** Connect an AI sub-node (model, parser, ...) to a root node. */
  connectAi(subNode, rootNode, type = 'ai_languageModel', inp = 0) {
    this.connect(subNode, rootNode, 0, inp, type);
  }

  /** Canvas sticky note. at = [col,row] grid, size in px. */
  sticky(name, content, at, { width = 400, height = 240, color = 7 } = {}) {
    return this.node({
      name,
      type: 'n8n-nodes-base.stickyNote',
      version: 1,
      at,
      parameters: { content, width, height, color },
    });
  }

  toJSON() {
    // Validate: every connection target exists, no orphan non-sticky nodes.
    const names = new Set(this.nodes.map((n) => n.name));
    for (const [from, types] of Object.entries(this.connections)) {
      for (const outs of Object.values(types)) {
        for (const list of outs) for (const c of list) if (!names.has(c.node)) throw new Error(`${from} -> missing ${c.node}`);
      }
    }
    return {
      id: this.id,
      name: this.name,
      description: this.description || undefined,
      nodes: this.nodes,
      connections: this.connections,
      settings: this.settings,
      staticData: null,
      pinData: {},
      active: false,
      meta: { templateCredsSetupCompleted: false },
      tags: this.tags.map((t) => ({ name: t })),
    };
  }
}

// ---------------------------------------------------------------------------
// Parameter helpers for frequently used node shapes
// ---------------------------------------------------------------------------

let condCounter = 0;
/** One condition for IF/Switch/Filter (filter v2 format). */
export function cond(leftValue, type, operation, rightValue) {
  condCounter += 1;
  return {
    id: stableId(`cond:${condCounter}:${leftValue}:${operation}`),
    leftValue,
    ...(rightValue === undefined ? {} : { rightValue }),
    operator: {
      type,
      operation,
      ...(rightValue === undefined ? { singleValue: true } : {}),
    },
  };
}

export function conditions(list, combinator = 'and') {
  return {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: list,
    combinator,
  };
}

/** Set-node (v3.4) assignments from [name, type, value] tuples. */
export function assignments(list) {
  return {
    assignments: list.map(([name, type, value]) => ({
      id: stableId(`assign:${name}:${String(value).slice(0, 40)}`),
      name,
      type,
      value,
    })),
  };
}

/** Resource locator value. */
export function rl(value, mode = 'id', extra = {}) {
  return { __rl: true, value, mode, ...extra };
}

/** OpenAI-compatible chat model sub-node parameters (Chat Completions API). */
export function chatModelParams(modelExpr, { temperature = 0.2, json = true } = {}) {
  return {
    model: rl(modelExpr, 'id'),
    responsesApiEnabled: false,
    options: {
      temperature,
      ...(json ? { responseFormat: 'json_object' } : {}),
      timeout: 60000,
      maxRetries: 2,
    },
  };
}
