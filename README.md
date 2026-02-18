# PHI Redaction App — Version A3

A3 is a **functioning baseline** for image-based PDFs:
- Batch upload PDFs
- Notes / Surgery Center templates
- OCR-based redaction (Tesseract)
- Safe flattened PDF output
- Optional searchable PDF (ocrmypdf if installed)
- Optional export of redacted page images
- Batch ZIP download, including per-file JSON reports

## Run locally
1) Backend
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

2) Frontend
```bash
cd frontend
npm install
npm run dev
```

## Next tuning step
Upload 1 real Notes PDF + 1 real Surgery Center PDF and we’ll tighten the template rules.
