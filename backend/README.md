# Backend (FastAPI) — Version A3 (Functioning baseline for image-based PDFs)

## What's improved in A3
- Fixes PDF rebuild reliability (ReportLab ImageReader)
- Adds CORS so the frontend can talk to backend locally
- Adds optional export of redacted page images into the ZIP
- Generates a per-file JSON report showing how many redaction boxes were applied per page
- Adds configurable Tesseract path via env var `TESSERACT_CMD`

## Required installs
### Tesseract OCR (required for OCR targeting)
- Windows: install Tesseract, then (if needed) set:
  `setx TESSERACT_CMD "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"`
- macOS: `brew install tesseract`
- Linux: `sudo apt-get install tesseract-ocr`

### Searchable PDF output (optional)
Install `ocrmypdf` and Ghostscript:
- `pip install ocrmypdf`
- Windows: install Ghostscript
- macOS: `brew install ghostscript`
- Linux: `sudo apt-get install ghostscript`

If `ocrmypdf` isn't installed, A3 still produces a SAFE flattened PDF (not searchable).

## Run
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```
