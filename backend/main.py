import os
import uuid
import json
from typing import List
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from processor import ensure_dirs, redact_pdf, zip_paths

BASE_DIR = os.path.dirname(__file__)
STORAGE = os.path.join(BASE_DIR, "storage")
UPLOADS = os.path.join(STORAGE, "uploads")
OUTPUTS = os.path.join(STORAGE, "outputs")
REPORTS = os.path.join(STORAGE, "reports")

ensure_dirs(UPLOADS, OUTPUTS, REPORTS)

app = FastAPI(title="PHI Redaction App (A3)")

# Allow local dev frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BATCHES = {}

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/batch")
async def create_batch(
    template: str = Form(...),
    searchable: bool = Form(True),
    export_images: bool = Form(False),
    files: List[UploadFile] = File(...)
):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded.")

    batch_id = str(uuid.uuid4())
    batch_out_dir = os.path.join(OUTPUTS, batch_id)
    os.makedirs(batch_out_dir, exist_ok=True)

    zip_items = []
    batch_reports = []

    for f in files:
        if not f.filename.lower().endswith(".pdf"):
            continue

        upload_path = os.path.join(UPLOADS, f"{batch_id}-{f.filename}")
        with open(upload_path, "wb") as w:
            w.write(await f.read())

        stem = os.path.splitext(f.filename)[0]
        out_pdf = os.path.join(batch_out_dir, f"{stem}.REDACTED.pdf")
        img_dir = os.path.join(batch_out_dir, f"{stem}_images") if export_images else None

        try:
            report = redact_pdf(
                upload_path,
                out_pdf,
                template_key=template,
                searchable=searchable,
                export_images=export_images,
                images_dir=img_dir,
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to redact {f.filename}: {e}")

        zip_items.append(out_pdf)
        if export_images and img_dir:
            zip_items.append(img_dir)

        report_path = os.path.join(REPORTS, f"{batch_id}-{stem}.report.json")
        with open(report_path, "w", encoding="utf-8") as rp:
            json.dump({"file": f.filename, **report}, rp, indent=2)
        batch_reports.append(report_path)

    if not zip_items:
        raise HTTPException(status_code=400, detail="No valid PDF files found.")

    zip_path = os.path.join(batch_out_dir, f"{batch_id}.zip")
    zip_paths(zip_items + batch_reports, zip_path)

    BATCHES[batch_id] = {
        "batch_id": batch_id,
        "template": template,
        "searchable": searchable,
        "export_images": export_images,
        "zip_path": zip_path,
        "count": len([p for p in zip_items if p.endswith(".pdf")]),
        "reports": len(batch_reports),
    }

    return JSONResponse({"batch_id": batch_id, "count": BATCHES[batch_id]["count"]})

@app.get("/api/batch/{batch_id}")
def get_batch(batch_id: str):
    if batch_id not in BATCHES:
        raise HTTPException(status_code=404, detail="Batch not found.")
    return BATCHES[batch_id]

@app.get("/api/batch/{batch_id}/download")
def download_batch(batch_id: str):
    if batch_id not in BATCHES:
        raise HTTPException(status_code=404, detail="Batch not found.")
    zip_path = BATCHES[batch_id]["zip_path"]
    return FileResponse(zip_path, filename=os.path.basename(zip_path), media_type="application/zip")
