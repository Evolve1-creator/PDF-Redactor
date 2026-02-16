# PHI PDF Redactor (Client-side)

This app redacts PHI from PDFs created with **Microsoft Print to PDF**, using fixed redaction rectangles from your template files, and regenerates a **new** PDF that is readable by ChatGPT.

## Redaction rectangles (from your template)

### Epic Note (Header/Footer)
- **Page 1**: Top block `612 x 300` (points) from the top-left
- **Every page (including page 1)**: `1 cm` header band + `1 cm` footer band

### Surgery Center (Top Band)
- **Every page**: `4 cm` top band

## Output modes

### 1) Searchable “true text” PDF (default)
Best for Microsoft Print-to-PDF documents because they already contain text.
- Extracts text with PDF.js
- Drops any text that falls inside the redaction rectangles
- Rebuilds a new PDF (text objects) using pdf-lib
- Produces a `__gpt.txt` alongside the PDF

This mode does **not** require OCR assets.

### 2) Exact-look PDF (raster + OCR)
Use when the PDF is image-only (scanned) or text extraction fails.
- Renders each page to pixels
- Burns-in black rectangles (true redaction)
- Rebuilds a new PDF from the redacted images
- Runs OCR and embeds a low-opacity text layer for search/extraction

#### OCR assets (fully client-side)
To keep OCR fully client-side, put the language file here:

```
/public/tessdata/eng.traineddata
```

If OCR assets are missing or blocked, the app will still export the redacted image-PDF but will warn that it is not searchable.

## Run

```bash
npm i
npm run dev
```

## Build

```bash
npm run build
npm run preview
```
