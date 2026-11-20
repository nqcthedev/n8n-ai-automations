/* global $input */
// Guardrail: parse and strictly validate the LLM's qualification JSON.
// Mode: Run once for all items.
// Input: Basic LLM Chain output ({ text }) or its error output ({ error }).
// Output: { aiValid, aiErrors[], ai, attempt, rawText }

const ATTEMPT = {{ATTEMPT}};

const INTENTS = ['purchase', 'quote_request', 'consultation', 'partnership', 'support', 'vendor_pitch', 'job_application', 'spam', 'other'];
const BUDGET_BANDS = ['unknown', '<1k', '1k-5k', '5k-20k', '20k-50k', '50k+'];
const URGENCY = ['low', 'medium', 'high'];

// @include shared/read-llm-json.js
const input = $input.first().json;
const errors = [];
const parsed = readLlmJson(input);
const raw = parsed.raw;
const data = parsed.data;
if (parsed.error) errors.push(parsed.error);

const norm = (v) => String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
const ai = {};

if (data) {
  // company
  ai.company = typeof data.company === 'string' && data.company.trim() ? data.company.trim().slice(0, 160) : '';
  if (!ai.company) errors.push('company: must be a non-empty string (use "Unknown" if not inferable)');

  // intent
  ai.intent = norm(data.intent);
  if (!INTENTS.includes(ai.intent)) errors.push(`intent: must be one of ${INTENTS.join(', ')} (got "${data.intent}")`);

  // budget band (accept a few harmless spelling variants)
  const b = String(data.budget_band ?? '').trim().toLowerCase().replace(/\s/g, '').replace(/usd|\$/g, '');
  const bandAliases = { 'under1k': '<1k', 'lessthan1k': '<1k', '50k+': '50k+', 'over50k': '50k+', '>50k': '50k+' };
  ai.budget_band = bandAliases[b] || b;
  if (!BUDGET_BANDS.includes(ai.budget_band)) errors.push(`budget_band: must be one of ${BUDGET_BANDS.join(', ')} (got "${data.budget_band}")`);

  // urgency
  ai.urgency = norm(data.urgency);
  if (!URGENCY.includes(ai.urgency)) errors.push(`urgency: must be one of ${URGENCY.join(', ')} (got "${data.urgency}")`);

  // score
  const score = typeof data.score === 'string' && data.score.trim() !== '' ? Number(data.score) : data.score;
  if (typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 100) {
    errors.push(`score: must be a number between 0 and 100 (got ${JSON.stringify(data.score)})`);
  } else {
    ai.score = Math.round(score);
  }

  // reasoning
  ai.reasoning = typeof data.reasoning === 'string' ? data.reasoning.trim().slice(0, 800) : '';
  if (ai.reasoning.length < 10) errors.push('reasoning: must explain the score in 1-3 sentences');

  // suggested reply
  ai.suggested_reply = typeof data.suggested_reply === 'string' ? data.suggested_reply.trim() : '';
  if (ai.suggested_reply.length < 40) errors.push('suggested_reply: must be a complete short email body (min. 40 characters)');
  if (ai.suggested_reply.length > 2500) errors.push('suggested_reply: too long (max. 2500 characters)');

  // semantic consistency
  if (ai.intent === 'spam' && ai.score > 20) errors.push('score: spam leads must score 20 or lower');
}

const aiValid = errors.length === 0;

return [{
  json: {
    aiValid,
    aiErrors: errors,
    ai: aiValid ? ai : null,
    attempt: ATTEMPT,
    rawText: raw.slice(0, 2000),
  },
}];
