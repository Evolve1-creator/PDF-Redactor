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
