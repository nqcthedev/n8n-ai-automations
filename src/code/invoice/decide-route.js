/* global $, $input */
// Final record + route for every path (valid, validation failed, duplicate
// file, no text layer). Mode: Run once for each item.
//   route = "accept"  -> Invoices sheet
//   route = "review"  -> Review queue sheet + Slack
//   route = "dry_run" -> no side effects (AUTOMATION_DRY_RUN=true)

const cfg = $('Config').first().json;
const file = $('Check duplicate file').item.json;
const r = $input.item.json; // { status, issues, warnings, invoice }
const inv = r.invoice || {};
const issues = r.issues || [];
const warnings = r.warnings || [];

const route = cfg.dryRun ? 'dry_run' : r.status === 'valid' ? 'accept' : 'review';
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const slackText = [
  `:receipt: *Invoice needs review* - ${esc(inv.vendor_name || 'unknown vendor')} ${esc(inv.invoice_number || '')}`,
  `*File:* ${esc(file.file_name)} (${file.source}${file.sender_email ? ' from ' + esc(file.sender_email) : ''})`,
  inv.total !== undefined && inv.total !== null ? `*Total:* ${inv.total} ${esc(inv.currency || '')}` : '',
  '*Problems:*',
  ...issues.map((i) => `• \`${i.code}\` ${esc(i.message)}`),
].filter(Boolean).join('\n');

return {
  json: {
    route,
    status: r.status,
    processed_at: new Date().toISOString(),
    source: file.source,
    file_name: file.file_name,
    file_sha256: file.file_sha256,
    sender_email: file.sender_email || '',
    vendor_name: inv.vendor_name || '',
    vendor_tax_id: inv.vendor_tax_id || '',
    invoice_number: inv.invoice_number || '',
    issue_date: inv.issue_date || '',
    due_date: inv.due_date || '',
    currency: inv.currency || '',
    subtotal: inv.subtotal ?? '',
    tax_amount: inv.tax_amount ?? '',
    tax_rate_percent: inv.tax_rate_percent ?? '',
    total: inv.total ?? '',
    line_items_count: (inv.line_items || []).length,
    line_items_json: JSON.stringify(inv.line_items || []),
    issues: issues.map((i) => `${i.code}: ${i.message}`).join(' | '),
    warnings: warnings.map((w) => `${w.code}: ${w.message}`).join(' | '),
    // not Sheets columns:
    issue_codes: issues.map((i) => i.code),
    invoice: r.invoice || null,
    slack_text: slackText,
  },
};
