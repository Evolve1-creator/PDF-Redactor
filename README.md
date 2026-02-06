# PDF Redactor (Text-Searchable Export)

This Vite + React app exports **text-searchable** PDFs by applying redaction overlays directly to the PDF (no canvas screenshot / no image-based PDF).

## Why your prior exports were "unreadable"
If you render pages to a `<canvas>` and then create a new PDF from the canvas image (e.g., `jsPDF.addImage(...)`), the output becomes image-based.
That destroys the text layer, so you can't text-search/copy.

## How this app fixes it
- **Preview** uses PDF.js (canvas is fine for preview).
- **Export** uses **pdf-lib**:
  - Loads the original PDF bytes
  - Draws opaque rectangles (redaction) on the original pages
  - Saves the PDF **without rasterizing**, so the PDF remains text-searchable.

> Note: Overlay-style redaction does **not** remove underlying PDF content. You indicated no PHI exists under the redacted region, so overlay is acceptable.

## Run locally
```bash
npm install
npm run dev
```

## Build
```bash
npm run build
npm run preview
```

## Customize redaction zones
Edit `src/redaction.js`.
- Surgery Center default: **top 4 cm on page 1**
- No-Charge: example blocks (adjust to your layout)

## GitHub
Upload this folder to a repo (or unzip the provided zip and push).
