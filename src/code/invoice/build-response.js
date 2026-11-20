/* global $ */
// HTTP response for the upload webhook. Mode: Run once for all items.
const rec = $('Decide route').first().json;
return [{
  json: {
    statusCode: 200,
    body: {
      status: rec.status,                     // "valid" | "needs_review"
      route: rec.route,                       // "accept" | "review" | "dry_run"
      file_name: rec.file_name,
      file_sha256: rec.file_sha256,
      issues: rec.issue_codes,
      issue_details: rec.issues ? rec.issues.split(' | ') : [],
      warnings: rec.warnings ? rec.warnings.split(' | ') : [],
      invoice: rec.invoice,
    },
  },
}];
