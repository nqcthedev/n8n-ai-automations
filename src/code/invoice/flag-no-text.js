/* global $input */
// No usable text: either the PDF could not be parsed at all, or it has no
// text layer (scanned image). Needs OCR or a human. Mode: Run once for each item.
const j = $input.item.json;
const unreadable = Boolean(j.error);
return {
  json: {
    status: 'needs_review',
    issues: [unreadable
      ? { code: 'unreadable_pdf', message: 'The file could not be parsed as a PDF: ' + String(j.error.message || j.error).slice(0, 200) }
      : { code: 'no_text_layer', message: `No extractable text found (${j.numpages || '?'} page(s)). The PDF is probably a scan; OCR is not part of this workflow.` }],
    warnings: [],
    invoice: null,
  },
};
