# Simple PDF Redactor (Frontend-only) — Version F1

This is a **simple working redaction app** with:
- Batch upload of PDFs
- Two templates: Notes and Surgery Center
- Burns redactions into rendered page images and rebuilds a flattened PDF
- Batch ZIP download of redacted PDFs
- Optional: include redacted PNG pages in the ZIP

✅ No Python. No backend. No server required.

## Run locally
```bash
npm install
npm run dev
```
Open: http://localhost:5173

## Deploy
This is a static site build — Vercel works well.
```bash
npm run build
```

## Template tuning
Edit `src/templates.js` (rectangles are normalized 0..1).


## Fixes
- F1.1: Fix pdfjs worker import for Vercel/Vite builds (pdf.worker default export issue).


## Fixes
- F1.2: Add Surgery Notes rule: page 1 redact top 1.75 inches; pages 2+ redact top 0.6 inches.

- F1.3: Add Asante Notes template: page 1 top 3.75in, page 2+ top 0.65in, all pages bottom 0.65in.

- F1.4: Add Asante Blue template (same band rules as Asante Notes).

- F1.5: Change all 0.65-inch band redactions to 0.40 inches across templates.

- F1.6: Add Template Tuner (band-only) with preview + save to localStorage; applies to batch uploads.
