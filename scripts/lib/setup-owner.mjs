#!/usr/bin/env node
// Wait for a local n8n to come up and create the owner account if needed.
// usage: node setup-owner.mjs http://localhost:5678
const base = process.argv[2] || 'http://localhost:5678';
const email = process.env.LOCAL_OWNER_EMAIL || 'admin@example.com';
const password = process.env.LOCAL_OWNER_PASSWORD || 'LocalDemo-2026';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const deadline = Date.now() + 180_000;
while (Date.now() < deadline) {
  try {
    const r = await fetch(`${base}/healthz`);
    if (r.ok) break;
  } catch { /* not up yet */ }
  await sleep(1000);
}
// /healthz answers before the REST API is mounted, so retry while it 404s.
for (let attempt = 0; attempt < 60; attempt++) {
  try {
    const r = await fetch(`${base}/rest/owner/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, firstName: 'Local', lastName: 'Admin', password }),
    });
    if (r.status === 404) { await sleep(2000); continue; }
    if (r.ok) console.log(`[setup-owner] created local owner ${email}`);
    else if (r.status !== 400) console.log(`[setup-owner] owner setup returned HTTP ${r.status}`);
    break; // 400 = owner already exists
  } catch (e) {
    await sleep(2000);
  }
}
