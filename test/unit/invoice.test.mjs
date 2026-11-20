import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeNode } from '../lib/code-node.mjs';

const WF = '03-ai-invoice-extraction.json';
const validate = codeNode(WF, 'Validate invoice');
const collect = codeNode(WF, 'Collect PDF files');
const dupFile = codeNode(WF, 'Check duplicate file');

const config = { dryRun: true, amountTolerance: 0.02 };
const file = { file_name: 'a.pdf', file_sha256: 'abc', source: 'webhook' };
const base = {
  document_type: 'invoice', vendor_name: 'Lumen Cloud Hosting Ltd', vendor_tax_id: null, invoice_number: 'INV-1',
  issue_date: '2026-10-01', due_date: '2026-10-31', currency: 'USD', bill_to: 'Example Retail Co.',
  line_items: [
    { description: 'VPS', quantity: 2, unit_price: 89, amount: 178 },
    { description: 'Backups', quantity: 2, unit_price: 12.5, amount: 25 },
  ],
  subtotal: 203, tax_amount: 20.3, tax_rate_percent: 10, total: 223.3,
};
const run = (inv, staticData = {}) => validate({ items: [inv], nodes: { Config: [config], 'Check duplicate file': [file] }, staticData });
const codes = (out) => out[0].json.issues.map((i) => i.code);

test('correct invoice is valid and gets registered', async () => {
  const sd = {};
  const out = await run(base, sd);
  assert.equal(out[0].json.status, 'valid', JSON.stringify(out[0].json.issues));
  assert.equal(Object.keys(sd.invoiceNumbers).length, 1);
});

test('line items that do not add up to the subtotal are caught', async () => {
  const out = await run({ ...base, subtotal: 230, tax_amount: 23, total: 253 });
  assert.deepEqual(codes(out), ['line_items_sum_mismatch']);
  assert.match(out[0].json.issues[0].message, /add up to 203\.00 but the stated subtotal is 230\.00/);
});

test('subtotal + tax != total is caught', async () => {
  assert.deepEqual(codes(await run({ ...base, total: 230 })), ['total_mismatch']);
});

test('tax rate mismatch and qty x unit price mismatch are caught', async () => {
  assert.deepEqual(codes(await run({ ...base, tax_rate_percent: 20 })), ['tax_rate_mismatch']);
  const li = [{ description: 'VPS', quantity: 2, unit_price: 89, amount: 180 }, base.line_items[1]];
  assert.ok(codes(await run({ ...base, line_items: li })).includes('line_amount_mismatch'));
});

test('date sanity: due before issue, future issue date, invalid date', async () => {
  assert.deepEqual(codes(await run({ ...base, due_date: '2026-09-01' })), ['due_before_issue']);
  assert.deepEqual(codes(await run({ ...base, issue_date: '2099-01-01', due_date: '2099-02-01' })), ['issue_date_in_future']);
  assert.ok(codes(await run({ ...base, issue_date: '2026-02-30' })).includes('invalid_issue_date'));
});

test('currency must be an ISO code; required fields are enforced', async () => {
  assert.deepEqual(codes(await run({ ...base, currency: 'dollars' })), ['invalid_currency']);
  const out = await run({ ...base, vendor_name: null, invoice_number: '', line_items: [], subtotal: null, total: null });
  assert.ok(codes(out).includes('missing_vendor'));
  assert.ok(codes(out).includes('missing_invoice_number'));
  assert.ok(codes(out).includes('missing_line_items'));
  assert.ok(codes(out).includes('missing_total'));
});

test('same vendor + invoice number twice is a duplicate; corrected re-send of a rejected invoice is not', async () => {
  const sd = {};
  await run({ ...base, total: 999 }, sd); // rejected -> not registered
  assert.equal((await run(base, sd))[0].json.status, 'valid');
  const again = await run({ ...base, vendor_name: 'LUMEN Cloud Hosting Ltd.' }, sd);
  assert.deepEqual(codes(again), ['duplicate_invoice_number']);
});

test('string numbers with separators are parsed (US and EU style)', async () => {
  const out = await run({ ...base, subtotal: '203.00', tax_amount: '20,30', total: '$223.30' });
  assert.equal(out[0].json.status, 'valid', JSON.stringify(out[0].json.issues));
});

test('LLM failure becomes extraction_failed', async () => {
  assert.deepEqual(codes(await run({ error: 'Request failed with status code 503' })), ['extraction_failed']);
  // Real error-output items keep the input fields (here: the PDF text) and add "error".
  assert.deepEqual(codes(await run({ text: 'INVOICE ...', numpages: 1, error: { message: 'model not found' } })), ['extraction_failed']);
  assert.deepEqual(codes(await run({ text: 'I cannot read this document.' })), ['extraction_failed']);
});

test('collect: webhook without a PDF yields an error item; Gmail picks every PDF attachment', async () => {
  const [noPdf] = await collect({ items: [{ json: { headers: {}, body: {} }, binary: { file: { mimeType: 'image/png', fileName: 'a.png' } } }] });
  assert.equal(noPdf.json.ok, false);
  const out = await collect({ items: [{
    json: { id: 'g1', subject: 'Invoices', from: { value: [{ address: 'Billing@Vendor.com' }] } },
    binary: { attachment_0: { mimeType: 'application/pdf', fileName: 'a.pdf' }, attachment_1: { mimeType: 'image/png', fileName: 'logo.png' }, attachment_2: { mimeType: 'application/octet-stream', fileName: 'b.PDF' } },
  }] });
  assert.equal(out.length, 2);
  assert.equal(out[0].json.source, 'gmail');
  assert.equal(out[0].json.sender_email, 'billing@vendor.com');
  assert.ok(out[1].binary.data);
});

test('duplicate file hash is detected', async () => {
  const sd = {};
  const nodes = { 'Collect PDF files': [{ json: {}, binary: { data: { fileName: 'a.pdf' } } }] };
  const [a] = await dupFile({ items: [{ file_sha256: 'h1', file_name: 'a.pdf' }], nodes, staticData: sd });
  const [b] = await dupFile({ items: [{ file_sha256: 'h1', file_name: 'a.pdf' }], nodes, staticData: sd });
  assert.equal(a.json.duplicate_file, false);
  assert.equal(b.json.duplicate_file, true);
  assert.ok(b.binary.data, 'binary is re-attached');
});
