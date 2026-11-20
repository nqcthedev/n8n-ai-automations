#!/usr/bin/env node
// Generates the sample invoice PDFs used by the test harness and the demo.
// All companies, people and numbers are fictional.
//
// Usage: node samples/invoices/generate.mjs
// Requires Playwright (Chromium) to be installed and resolvable.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const outDir = path.dirname(fileURLToPath(import.meta.url));

const money = (n, cur) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);

const invoices = [
  {
    file: 'invoice-01-valid.pdf',
    vendor: { name: 'Lumen Cloud Hosting Ltd', address: '18 Harbour Road, Singapore 049483', taxId: 'GST Reg. 201912345K' },
    billTo: { name: 'Example Retail Co.', address: '42 Market Street, Austin, TX 78701, USA' },
    number: 'INV-2026-0142',
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    currency: 'USD',
    items: [
      { desc: 'Managed VPS (4 vCPU / 8 GB) - October', qty: 2, unit: 89.0 },
      { desc: 'Daily off-site backups', qty: 2, unit: 12.5 },
      { desc: 'Support hours (incident #5521)', qty: 3, unit: 60.0 },
    ],
    taxRate: 0.1,
    taxLabel: 'GST 10%',
    // Totals are computed from items below (correct invoice).
  },
  {
    file: 'invoice-02-wrong-total.pdf',
    vendor: { name: 'Bluefin Design Studio', address: 'Kaiserstrasse 12, 60311 Frankfurt, Germany', taxId: 'USt-IdNr. DE123456789' },
    billTo: { name: 'Example Retail Co.', address: '42 Market Street, Austin, TX 78701, USA' },
    number: 'BDS-7781',
    issueDate: '2026-10-12',
    dueDate: '2026-11-11',
    currency: 'EUR',
    items: [
      { desc: 'Logo redesign (3 concepts, 2 revision rounds)', qty: 1, unit: 1200.0 },
      { desc: 'Brand guidelines PDF', qty: 1, unit: 850.0 },
      { desc: 'Social media template kit', qty: 4, unit: 100.0 },
    ],
    taxRate: 0.2,
    taxLabel: 'VAT 20%',
    // Deliberate mistake: the line items add up to 2,450.00 but the invoice
    // states a subtotal of 2,540.00 (transposed digits). Tax and total are
    // computed from the wrong subtotal, so only the line-item check fails.
    overrideSubtotal: 2540.0,
  },
  {
    file: 'invoice-03-duplicate-resend.pdf',
    banner: 'PAYMENT REMINDER - SECOND NOTICE',
    vendor: { name: 'Lumen Cloud Hosting Ltd', address: '18 Harbour Road, Singapore 049483', taxId: 'GST Reg. 201912345K' },
    billTo: { name: 'Example Retail Co.', address: '42 Market Street, Austin, TX 78701, USA' },
    number: 'INV-2026-0142',
    issueDate: '2026-10-01',
    dueDate: '2026-10-31',
    currency: 'USD',
    items: [
      { desc: 'Managed VPS (4 vCPU / 8 GB) - October', qty: 2, unit: 89.0 },
      { desc: 'Daily off-site backups', qty: 2, unit: 12.5 },
      { desc: 'Support hours (incident #5521)', qty: 3, unit: 60.0 },
    ],
    taxRate: 0.1,
    taxLabel: 'GST 10%',
    note: 'Our records show this invoice is still unpaid. Please disregard if already settled.',
  },
];

function render(inv) {
  const lines = inv.items.map((it) => ({ ...it, amount: Math.round(it.qty * it.unit * 100) / 100 }));
  const subtotal = inv.overrideSubtotal ?? lines.reduce((s, l) => s + l.amount, 0);
  const tax = Math.round(subtotal * inv.taxRate * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;
  const m = (n) => money(n, inv.currency);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: Helvetica, Arial, sans-serif; color: #1f2937; margin: 48px; font-size: 13px; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; }
    h1 { font-size: 30px; letter-spacing: 2px; margin: 0; color: #111827; }
    .vendor { font-size: 15px; font-weight: bold; }
    .muted { color: #6b7280; }
    .banner { background: #fef3c7; border: 1px solid #f59e0b; padding: 8px 12px; margin-bottom: 20px; font-weight: bold; }
    table.meta td { padding: 2px 12px 2px 0; }
    table.items { width: 100%; border-collapse: collapse; margin-top: 28px; }
    table.items th { text-align: left; border-bottom: 2px solid #111827; padding: 8px 6px; }
    table.items td { border-bottom: 1px solid #e5e7eb; padding: 8px 6px; }
    .num { text-align: right; }
    table.totals { margin-left: auto; margin-top: 16px; }
    table.totals td { padding: 4px 6px; }
    .grand td { font-weight: bold; font-size: 15px; border-top: 2px solid #111827; }
    .footer { margin-top: 48px; font-size: 11px; }
  </style></head><body>
  ${inv.banner ? `<div class="banner">${inv.banner}</div>` : ''}
  <div class="top">
    <div>
      <div class="vendor">${inv.vendor.name}</div>
      <div class="muted">${inv.vendor.address}</div>
      <div class="muted">${inv.vendor.taxId}</div>
    </div>
    <div style="text-align:right"><h1>INVOICE</h1>
      <table class="meta" style="margin-left:auto">
        <tr><td class="muted">Invoice no.</td><td><b>${inv.number}</b></td></tr>
        <tr><td class="muted">Issue date</td><td>${inv.issueDate}</td></tr>
        <tr><td class="muted">Due date</td><td>${inv.dueDate}</td></tr>
        <tr><td class="muted">Currency</td><td>${inv.currency}</td></tr>
      </table>
    </div>
  </div>
  <div style="margin-top:28px"><div class="muted">Bill to</div><b>${inv.billTo.name}</b><div>${inv.billTo.address}</div></div>
  <table class="items">
    <thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
    <tbody>${lines
      .map((l) => `<tr><td>${l.desc}</td><td class="num">${l.qty}</td><td class="num">${m(l.unit)}</td><td class="num">${m(l.amount)}</td></tr>`)
      .join('')}</tbody>
  </table>
  <table class="totals">
    <tr><td class="muted">Subtotal</td><td class="num">${m(subtotal)}</td></tr>
    <tr><td class="muted">${inv.taxLabel}</td><td class="num">${m(tax)}</td></tr>
    <tr class="grand"><td>Total due</td><td class="num">${m(total)}</td></tr>
  </table>
  ${inv.note ? `<p style="margin-top:24px">${inv.note}</p>` : ''}
  <div class="footer muted">Payment by bank transfer within 30 days. Please quote the invoice number as reference.<br/>This is a fictional sample document generated for testing.</div>
  </body></html>`;
}

const browser = await chromium.launch();
const page = await browser.newPage();
for (const inv of invoices) {
  await page.setContent(render(inv), { waitUntil: 'load' });
  const out = path.join(outDir, inv.file);
  await page.pdf({ path: out, format: 'A4', printBackground: true });
  console.log('wrote', path.relative(process.cwd(), out));
}
await browser.close();
