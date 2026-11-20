/* global $, $input */
// Guardrail for the drafted reply: structure, length, cited knowledge-base ids
// must exist, and money amounts in the reply must appear in the snippets the
// model was given (simple hallucination check). Problems do not drop the
// ticket - they route it to "manual reply needed".
// Mode: Run once for each item.

const input = $input.item.json;
const ctx = $('Retrieve FAQ snippets').item.json;
const errors = [];
const warnings = [];
// @include shared/read-llm-json.js
const parsed = readLlmJson(input);
const data = parsed.data;
if (parsed.error) errors.push(parsed.error);

let draft = null;
if (data) {
  draft = {
    subject: typeof data.subject === 'string' && data.subject.trim() ? data.subject.trim().slice(0, 200) : '',
    body: typeof data.body === 'string' ? data.body.trim() : '',
    faq_ids_used: Array.isArray(data.faq_ids_used) ? data.faq_ids_used.map(String) : [],
    needs_human_attention: Boolean(data.needs_human_attention),
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
  };
  if (draft.body.length < 30) errors.push('body: too short');
  if (draft.body.length > 3000) errors.push('body: too long');
  const unknown = draft.faq_ids_used.filter((id) => !ctx.kb_ids.includes(id));
  if (unknown.length) errors.push('faq_ids_used contains ids that were not provided: ' + unknown.join(', '));

  // Every money amount in the reply must be present in the provided snippets.
  const amounts = draft.body.match(/[$€£]\s?\d[\d,.]*|\d[\d,.]*\s?(?:USD|EUR|GBP|%)/g) || [];
  const ungrounded = amounts.filter((a) => !ctx.kb_snippets.includes(a.replace(/\s/g, '').replace(/[.,]$/, '')));
  if (ungrounded.length) warnings.push('amounts not found in knowledge base: ' + ungrounded.join(', '));
}

const usable = errors.length === 0;
const needsAttention = !usable || warnings.length > 0 || (draft && draft.needs_human_attention);

return {
  json: {
    draft: usable ? draft : null,
    draft_usable: usable,
    draft_errors: errors,
    draft_warnings: warnings,
    needs_human_attention: Boolean(needsAttention),
  },
};
