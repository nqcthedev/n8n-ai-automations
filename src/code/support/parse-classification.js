/* global $input */
// Guardrail for the classification step. Invalid or missing output never
// blocks the ticket: it falls back to category "other" + human attention.
// Mode: Run once for each item.

const CATEGORIES = ['billing', 'bug', 'sales', 'other', 'spam'];
const SENTIMENTS = ['positive', 'neutral', 'negative', 'angry'];
const URGENCIES = ['low', 'normal', 'high', 'critical'];

const input = $input.item.json;
const errors = [];
// @include shared/read-llm-json.js
const parsed = readLlmJson(input);
const data = parsed.data;
if (parsed.error) errors.push(parsed.error);

const pickEnum = (v, allowed, field) => {
  const s = String(v ?? '').trim().toLowerCase();
  if (allowed.includes(s)) return s;
  errors.push(`${field}: "${v}" is not one of ${allowed.join('/')}`);
  return null;
};

let c = null;
if (data) {
  c = {
    category: pickEnum(data.category, CATEGORIES, 'category'),
    sentiment: pickEnum(data.sentiment, SENTIMENTS, 'sentiment'),
    urgency: pickEnum(data.urgency, URGENCIES, 'urgency'),
    summary: typeof data.summary === 'string' ? data.summary.trim().slice(0, 400) : '',
    language: typeof data.language === 'string' ? data.language.trim().slice(0, 5).toLowerCase() : 'en',
    confidence: Math.max(0, Math.min(1, Number(data.confidence) || 0)),
  };
  if (!c.summary) errors.push('summary: missing');
}

const valid = errors.length === 0;
const classification = valid ? c : {
  category: 'other',
  sentiment: (c && c.sentiment) || 'neutral',
  urgency: (c && c.urgency) || 'normal',
  summary: (c && c.summary) || '(automatic classification failed - please read the email)',
  language: (c && c.language) || 'en',
  confidence: 0,
};

return {
  json: {
    classification,
    classification_valid: valid,
    classification_errors: errors,
  },
};
