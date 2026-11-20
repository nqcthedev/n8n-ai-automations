/* global $input */
// Exact same PDF was processed before: skip the LLM, send to review.
// Mode: Run once for each item.
const j = $input.item.json;
return {
  json: {
    status: 'needs_review',
    issues: [{ code: 'duplicate_file', message: `This exact file was already processed on ${String(j.duplicate_of && j.duplicate_of.at).slice(0, 10)} (${j.duplicate_of && j.duplicate_of.file})` }],
    warnings: [],
    invoice: null,
  },
};
