# PDF Redactor (HIPAA-Secure + Text-Searchable Export)

This Vite + React app exports **text-searchable** PDFs by applying redaction overlays directly to the PDF (no canvas screenshot / no image-based PDF).

## Why your prior exports were "unreadable"
If you render pages to a `<canvas>` and then create a new PDF from the canvas image (e.g., `jsPDF.addImage(...)`), the output becomes image-based.
That destroys the text layer, so you can't text-search/copy.

## Two export modes
### 1) HIPAA Burn-in + OCR (Recommended)
- Renders the page to a canvas (client-side)
- Burns the redaction into the pixels (underlying content cannot be recovered)
- Builds a new PDF from the redacted image
- Runs OCR locally and embeds an invisible text layer so the output is still searchable/extractable

### 2) Overlay Only (Searchable, NOT HIPAA)
- Uses **pdf-lib** to draw opaque rectangles on the original PDF
- Keeps the original PDF text layer (searchable)
- **Does not remove underlying content**; do not use for PHI unless you are certain nothing sensitive exists under the masked region

## OCR language data (optional but recommended)
To avoid downloading OCR language files at runtime, place `eng.traineddata` (or `eng.traineddata.gz`) in:
`public/tessdata/`

The app will look for `/tessdata/eng.traineddata`.

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
