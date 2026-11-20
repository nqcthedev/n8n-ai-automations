/* global $, $input, $getWorkflowStaticData */
// Parse the LLM extraction and run deterministic business validation.
// The LLM only reads the document; every check below is plain code, so a
// wrong total can never be "explained away" by the model.
// Mode: Run once for each item.
//
// Errors (-> review queue): missing required fields, line amount != qty x unit,
// line items != subtotal, subtotal + tax != total, tax rate mismatch,
// impossible dates, invalid currency, duplicate invoice number (same vendor).
// Warnings (still accepted): old invoice, unusually long payment terms,
// non-invoice document type.

const cfg = $('Config').first().json;
const file = $('Check duplicate file').item.json;
const input = $input.item.json;
const TOL = Math.max(0, Number(cfg.amountTolerance) || 0.02);

const issues = [];
const warnings = [];
const issue = (code, message) => issues.push({ code, message });
const warn = (code, message) => warnings.push({ code, message });

// ---- parse -----------------------------------------------------------------
// @include shared/read-llm-json.js
const parsed = readLlmJson(input);
const data = parsed.data;
if (parsed.error) issue('extraction_failed', parsed.error);

const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[^\d.,-]/g, '');
  // "1.234,56" (EU) vs "1,234.56" (US)
  const normalized = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => (n === null || n === undefined ? 'n/a' : Number(n).toFixed(2));
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const isoDate = (v) => {
  const s = str(v);
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
};

let invoice = null;
if (data) {
  const items = Array.isArray(data.line_items) ? data.line_items : [];
  invoice = {
    document_type: str(data.document_type) || 'invoice',
    vendor_name: str(data.vendor_name),
    vendor_tax_id: str(data.vendor_tax_id),
    invoice_number: str(data.invoice_number),
    issue_date: isoDate(data.issue_date),
    due_date: isoDate(data.due_date),
    currency: (str(data.currency) || '').toUpperCase() || null,
    bill_to: str(data.bill_to),
    line_items: items.map((li) => ({
      description: str(li && li.description) || '',
      quantity: num(li && li.quantity),
      unit_price: num(li && li.unit_price),
      amount: num(li && li.amount),
    })),
    subtotal: num(data.subtotal),
    tax_amount: num(data.tax_amount),
    tax_rate_percent: num(data.tax_rate_percent),
    total: num(data.total),
  };

  // ---- required fields -----------------------------------------------------
  if (!invoice.vendor_name) issue('missing_vendor', 'Vendor name is missing');
  if (!invoice.invoice_number) issue('missing_invoice_number', 'Invoice number is missing');
  if (!invoice.issue_date) issue('invalid_issue_date', `Issue date is missing or not a valid date (${JSON.stringify(data.issue_date)})`);
  if (!invoice.currency || !/^[A-Z]{3}$/.test(invoice.currency)) issue('invalid_currency', `Currency must be a 3-letter ISO code (got ${JSON.stringify(data.currency)})`);
  if (invoice.total === null) issue('missing_total', 'Total amount is missing');
  if (invoice.line_items.length === 0) issue('missing_line_items', 'No line items found');
  if (invoice.document_type !== 'invoice') warn('not_an_invoice', `Document looks like a ${invoice.document_type}`);

  // ---- line items ----------------------------------------------------------
  invoice.line_items.forEach((li, i) => {
    if (li.amount === null) { issue('line_amount_missing', `Line ${i + 1} has no amount`); return; }
    if (li.quantity !== null && li.unit_price !== null) {
      const expected = r2(li.quantity * li.unit_price);
      if (Math.abs(expected - li.amount) > TOL) {
        issue('line_amount_mismatch', `Line ${i + 1} ("${li.description.slice(0, 40)}"): ${li.quantity} x ${fmt(li.unit_price)} = ${fmt(expected)}, but the line amount is ${fmt(li.amount)}`);
      }
    }
  });
  const lineSum = r2(invoice.line_items.reduce((s, li) => s + (li.amount || 0), 0));
  invoice.line_items_sum = lineSum;

  // ---- subtotal / tax / total ---------------------------------------------
  const tolN = Math.max(TOL, invoice.line_items.length * 0.01); // per-line rounding
  if (invoice.subtotal !== null && invoice.line_items.length) {
    if (Math.abs(lineSum - invoice.subtotal) > tolN) {
      issue('line_items_sum_mismatch', `Line items add up to ${fmt(lineSum)} but the stated subtotal is ${fmt(invoice.subtotal)} (difference ${fmt(r2(invoice.subtotal - lineSum))})`);
    }
  }
  const base = invoice.subtotal !== null ? invoice.subtotal : lineSum;
  const tax = invoice.tax_amount || 0;
  if (invoice.total !== null && Math.abs(r2(base + tax) - invoice.total) > TOL) {
    issue('total_mismatch', `Subtotal ${fmt(base)} + tax ${fmt(tax)} = ${fmt(r2(base + tax))}, but the stated total is ${fmt(invoice.total)}`);
  }
  if (invoice.tax_rate_percent !== null && invoice.tax_amount !== null) {
    const expectedTax = r2(base * invoice.tax_rate_percent / 100);
    if (Math.abs(expectedTax - invoice.tax_amount) > tolN) {
      issue('tax_rate_mismatch', `${invoice.tax_rate_percent}% of ${fmt(base)} is ${fmt(expectedTax)}, but the stated tax is ${fmt(invoice.tax_amount)}`);
    }
  }
  if (invoice.total !== null && invoice.total <= 0 && invoice.document_type === 'invoice') {
    issue('non_positive_total', 'Total must be greater than zero for an invoice');
  }

  // ---- dates -----------------------------------------------------------------
  const today = new Date();
  const dayMs = 86400000;
  if (invoice.issue_date) {
    const issued = new Date(invoice.issue_date + 'T00:00:00Z');
    if (issued.getTime() - today.getTime() > dayMs) issue('issue_date_in_future', `Issue date ${invoice.issue_date} is in the future`);
    if (today.getTime() - issued.getTime() > 365 * dayMs) warn('old_invoice', `Issue date ${invoice.issue_date} is more than a year ago`);
    if (invoice.due_date) {
      const due = new Date(invoice.due_date + 'T00:00:00Z');
      if (due < issued) issue('due_before_issue', `Due date ${invoice.due_date} is before issue date ${invoice.issue_date}`);
      else if ((due - issued) / dayMs > 120) warn('long_payment_terms', `Payment terms of ${Math.round((due - issued) / dayMs)} days`);
    }
  }

  // ---- duplicate invoice number (same vendor) --------------------------------
  if (invoice.vendor_name && invoice.invoice_number) {
    const key = (invoice.vendor_name.toLowerCase().replace(/[^a-z0-9]/g, '') + '|' +
      invoice.invoice_number.toLowerCase().replace(/[^a-z0-9]/g, ''));
    const store = $getWorkflowStaticData('global');
    store.invoiceNumbers = store.invoiceNumbers || {};
    const prev = store.invoiceNumbers[key];
    if (prev) {
      issue('duplicate_invoice_number', `Invoice ${invoice.invoice_number} from ${invoice.vendor_name} was already processed on ${prev.at.slice(0, 10)} (file ${prev.file})`);
    } else if (issues.length === 0) {
      // Only accepted invoices are registered, so a corrected re-send is not blocked.
      store.invoiceNumbers[key] = { at: new Date().toISOString(), file: file.file_name };
    }
  }
}

return {
  json: {
    status: issues.length === 0 ? 'valid' : 'needs_review',
    issues,
    warnings,
    invoice,
  },
};
