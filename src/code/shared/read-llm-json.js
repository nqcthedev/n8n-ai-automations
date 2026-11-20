// --- included from src/code/shared/read-llm-json.js ---------------------------
// The Basic LLM Chain returns one of three shapes, depending on model setup:
//   { text: "<raw model output>" }      (string output, e.g. with a fallback model)
//   { ...parsedJsonObject }             (JSON mode: n8n already parsed it)
//   { ...inputFields, error: "..." }    (error output of the chain node - it keeps
//                                        the input item's fields and adds "error")
// Returns { data, raw, error } where data is a plain object or null.
function readLlmJson(input) {
  if (input && input.error) {
    const e = input.error;
    return { data: null, raw: '', error: 'LLM request failed: ' + String((e && e.message) || e).slice(0, 300) };
  }
  let raw;
  let data = null;
  if (input && typeof input.text === 'string' && Object.keys(input).length === 1) {
    raw = input.text;
    const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    try { data = JSON.parse(cleaned); } catch {
      const m = cleaned.match(/\{[\s\S]*\}/);
      if (m) { try { data = JSON.parse(m[0]); } catch { /* not JSON */ } }
    }
  } else {
    data = input;
    raw = JSON.stringify(input);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { data: null, raw: String(raw || ''), error: 'Output is not a single JSON object' };
  }
  return { data, raw: String(raw), error: null };
}
// --- end include ----------------------------------------------------------------
