/* global $, $getWorkflowStaticData, $input */
// Exact-duplicate detection by file hash BEFORE any LLM call (saves cost).
// The registry lives in workflow static data (persisted for production
// executions). Capped to the most recent 20,000 files.
// Mode: Run once for each item.

const store = $getWorkflowStaticData('global');
store.invoiceFiles = store.invoiceFiles || {};

const j = $input.item.json;
const hash = j.file_sha256;
const seen = store.invoiceFiles[hash];

if (!seen) {
  store.invoiceFiles[hash] = { at: new Date().toISOString(), file: j.file_name };
  const keys = Object.keys(store.invoiceFiles);
  if (keys.length > 20000) {
    keys.sort((a, b) => store.invoiceFiles[a].at.localeCompare(store.invoiceFiles[b].at))
      .slice(0, keys.length - 20000).forEach((k) => delete store.invoiceFiles[k]);
  }
}

return {
  json: {
    ...j,
    duplicate_file: Boolean(seen),
    duplicate_of: seen || null,
  },
  // The Crypto node does not pass binary data through - re-attach the PDF.
  binary: $('Collect PDF files').item.binary,
};
