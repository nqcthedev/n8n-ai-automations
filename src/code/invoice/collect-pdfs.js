/* global $input */
// Collect PDF files from either trigger and emit ONE item per PDF with the
// file in binary property "data".
//  - Webhook upload (multipart/form-data, any field name): first PDF only.
//  - Gmail trigger (attachments downloaded as attachment_0, attachment_1 ...):
//    every PDF attachment of every email.
// Mode: Run once for all items.

const MAX_BYTES = 10 * 1024 * 1024;
const out = [];

for (const item of $input.all()) {
  const j = item.json || {};
  const isWebhook = j.headers !== undefined && j.body !== undefined;
  const source = isWebhook ? 'webhook' : 'gmail';
  const binary = item.binary || {};

  const pdfKeys = Object.keys(binary).filter((k) => {
    const b = binary[k] || {};
    return /pdf/i.test(b.mimeType || '') || /\.pdf$/i.test(b.fileName || '');
  });

  const sender = source === 'gmail'
    ? String((j.from && j.from.value && j.from.value[0] && j.from.value[0].address) || '').toLowerCase()
    : '';

  if (pdfKeys.length === 0) {
    if (isWebhook) {
      out.push({ json: { ok: false, source, error: 'No PDF file found. Send multipart/form-data with a PDF in field "file".' } });
    }
    continue; // Gmail: emails without PDFs are ignored
  }

  for (const key of isWebhook ? pdfKeys.slice(0, 1) : pdfKeys) {
    const b = binary[key];
    const size = Number(b.bytes || b.fileSizeBytes || 0);
    if (size > MAX_BYTES) {
      if (isWebhook) out.push({ json: { ok: false, source, error: `PDF is larger than ${MAX_BYTES / 1024 / 1024} MB.` } });
      continue;
    }
    out.push({
      json: {
        ok: true,
        source,
        file_name: b.fileName || `${key}.pdf`,
        sender_email: sender,
        email_subject: source === 'gmail' ? String(j.subject || '') : '',
        gmail_message_id: source === 'gmail' ? String(j.id || '') : '',
        received_at: new Date().toISOString(),
      },
      binary: { data: b },
    });
  }
}

return out;
