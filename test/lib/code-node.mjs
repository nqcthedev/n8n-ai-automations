// Run an n8n Code node's JavaScript outside n8n, with a small mock of the
// n8n helpers it uses ($input, $('Node'), $getWorkflowStaticData).
// The code is taken from the GENERATED workflow JSON, so unit tests exercise
// exactly what gets imported into n8n.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

export function loadWorkflow(file) {
  return JSON.parse(readFileSync(path.join(ROOT, 'workflows', file), 'utf8'));
}

/**
 * @param {string} workflowFile  e.g. '01-ai-lead-qualifier.json'
 * @param {string} nodeName      Code node name
 */
export function codeNode(workflowFile, nodeName) {
  const wf = loadWorkflow(workflowFile);
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`Node "${nodeName}" not found in ${workflowFile}`);
  const { jsCode, mode = 'runOnceForAllItems' } = node.parameters;
  const fn = new AsyncFunction('$input', '$', '$getWorkflowStaticData', '$json', jsCode);

  /**
   * @param {object} opts
   * @param {Array<object>} opts.items       input items ({json, binary?}) or plain json objects
   * @param {object} [opts.nodes]            other nodes' outputs: { 'Node name': [items] }
   * @param {object} [opts.staticData]       mutable object returned by $getWorkflowStaticData
   * @returns {Promise<Array<{json, binary?}>>}
   */
  return async function run({ items = [], nodes = {}, staticData = {} } = {}) {
    const wrap = (x) => (x && typeof x === 'object' && 'json' in x ? x : { json: x });
    const input = items.map(wrap);
    const other = Object.fromEntries(Object.entries(nodes).map(([k, v]) => [k, v.map(wrap)]));
    const $getWorkflowStaticData = () => staticData;
    const makeDollar = (index) => (name) => {
      const out = other[name];
      const unexecuted = () => { throw new Error(`Referenced node "${name}" is unexecuted`); };
      return {
        get isExecuted() { return out !== undefined; },
        first: () => (out ? out[0] : unexecuted()),
        all: () => (out ? out : unexecuted()),
        get item() { return out ? out[Math.min(index, out.length - 1)] : unexecuted(); },
      };
    };

    if (mode === 'runOnceForEachItem') {
      const results = [];
      for (let i = 0; i < input.length; i++) {
        const $input = { item: input[i], all: () => input, first: () => input[0] };
        const r = await fn($input, makeDollar(i), $getWorkflowStaticData, input[i].json);
        if (r) results.push(wrap(r));
      }
      return results;
    }
    const $input = { all: () => input, first: () => input[0], item: input[0] };
    const r = await fn($input, makeDollar(0), $getWorkflowStaticData, input[0] && input[0].json);
    return (r || []).map(wrap);
  };
}
