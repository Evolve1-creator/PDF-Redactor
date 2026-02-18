import io
from typing import List
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

def images_to_pdf(images: List[Image.Image], out_pdf_path: str):
    """Embed each image as a full-page PDF page (flattened)."""
    c = canvas.Canvas(out_pdf_path)
    for img in images:
        w, h = img.size
        c.setPageSize((w, h))
        # Use ImageReader to avoid drawImage(BytesIO) issues
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        ir = ImageReader(buf)
        c.drawImage(ir, 0, 0, width=w, height=h)
        c.showPage()
    c.save()
