/* global $input */
// Both AI attempts failed (invalid output or API error).
// Never lose a lead: continue with status "needs_manual_review".
// Mode: Run once for all items.

const prev = $input.first().json;
let reason = 'Unknown AI failure';
if (Array.isArray(prev.aiErrors) && prev.aiErrors.length) reason = prev.aiErrors.join('; ');
else if (prev.error) reason = 'LLM request failed: ' + (prev.error.message || String(prev.error));

return [{
  json: {
    aiValid: false,
    aiErrors: [reason.slice(0, 500)],
    ai: null,
    attempt: 2,
    fallback: true,
  },
}];
