// Minimal client for the local n8n instance's internal REST API (the same
// API the editor uses). Used by the test harness to read execution results of
// runs that are not visible in a webhook response (error workflow, etc.).
// Local testing only: the internal API is not a stable public contract.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, '.n8n-local', 'node_modules', 'n8n', 'package.json'));

export class N8nClient {
  constructor(base, email, password) {
    this.base = base.replace(/\/$/, '');
    this.email = email;
    this.password = password;
    this.cookie = '';
  }

  async login() {
    const r = await fetch(`${this.base}/rest/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ emailOrLdapLoginId: this.email, password: this.password }),
    });
    if (!r.ok) throw new Error(`login failed: HTTP ${r.status}`);
    this.cookie = (r.headers.getSetCookie?.() || [r.headers.get('set-cookie')]).map((c) => c.split(';')[0]).join('; ');
  }

  async get(p) {
    if (!this.cookie) await this.login();
    const r = await fetch(`${this.base}/rest${p}`, { headers: { cookie: this.cookie } });
    if (!r.ok) throw new Error(`GET ${p}: HTTP ${r.status}`);
    return (await r.json()).data;
  }

  async listExecutions(workflowId, limit = 10) {
    const filter = encodeURIComponent(JSON.stringify({ workflowId }));
    const d = await this.get(`/executions?filter=${filter}&limit=${limit}`);
    return d.results;
  }

  /** Full execution incl. decoded run data: { status, runData: {node: [taskData]} } */
  async getExecution(id) {
    const d = await this.get(`/executions/${id}`);
    const { parse } = require('flatted');
    const data = typeof d.data === 'string' ? parse(d.data) : d.data;
    return { ...d, data, runData: data?.resultData?.runData || {} };
  }

  /** JSON items output by a node (first run, main output `out`). */
  static nodeOutput(exec, nodeName, out = 0) {
    const runs = exec.runData[nodeName];
    if (!runs || !runs.length) return null;
    return (runs[0].data?.main?.[out] || []).map((i) => i.json);
  }
}
