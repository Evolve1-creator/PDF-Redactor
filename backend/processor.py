import os
import re
import zipfile
import subprocess
from typing import List, Tuple, Dict, Any

from PIL import Image, ImageDraw
import pypdfium2 as pdfium

from templates import get_template
from ocr_utils import ocr_words, find_anchor_bbox
from pdf_utils import images_to_pdf

Rect = Tuple[int, int, int, int]

def ensure_dirs(*paths: str):
    for p in paths:
        os.makedirs(p, exist_ok=True)

def pdf_to_images(pdf_path: str, scale: float = 2.0) -> List[Image.Image]:
    """Render PDF pages to PIL images."""
    pdf = pdfium.PdfDocument(pdf_path)
    images = []
    for i in range(len(pdf)):
        page = pdf.get_page(i)
        pil_image = page.render(scale=scale).to_pil()
        images.append(pil_image.convert("RGB"))
        page.close()
    pdf.close()
    return images

def clamp_rect(img: Image.Image, rect: Rect) -> Rect:
    x1, y1, x2, y2 = rect
    x1 = max(0, x1); y1 = max(0, y1)
    x2 = min(img.size[0], x2); y2 = min(img.size[1], y2)
    return (x1, y1, x2, y2)

def apply_rects(img: Image.Image, rects: List[Rect]) -> Image.Image:
    draw = ImageDraw.Draw(img)
    for r in rects:
        x1, y1, x2, y2 = clamp_rect(img, r)
        if x2 > x1 and y2 > y1:
            draw.rectangle([x1, y1, x2, y2], fill="black")
    return img

def group_words_into_lines(words, y_tol: int = 14):
    words_sorted = sorted(words, key=lambda w: (w.y, w.x))
    lines = []
    for w in words_sorted:
        placed = False
        for line in lines:
            if abs(w.y - line["y"]) <= y_tol:
                line["words"].append(w)
                line["y"] = int((line["y"] + w.y) / 2)
                placed = True
                break
        if not placed:
            lines.append({"y": w.y, "words": [w]})
    return lines

def regex_rects_from_ocr(img: Image.Image, patterns: List[str]) -> List[Rect]:
    words = ocr_words(img)
    if not words:
        return []
    lines = group_words_into_lines(words)
    rects: List[Rect] = []

    for line in lines:
        line_words = sorted(line["words"], key=lambda w: w.x)
        texts = [w.text for w in line_words]
        # build line string and word spans
        spans = []
        cursor = 0
        for t in texts:
            cs = cursor
            ce = cs + len(t)
            spans.append((cs, ce))
            cursor = ce + 1
        line_text = " ".join(texts)

        for pat in patterns:
            for m in re.finditer(pat, line_text, flags=re.IGNORECASE):
                start, end = m.span()
                hit = []
                for w, (cs, ce) in zip(line_words, spans):
                    if ce >= start and cs <= end:
                        hit.append(w)
                if not hit:
                    continue
                x1 = min(w.x for w in hit) - 12
                y1 = min(w.y for w in hit) - 8
                x2 = max(w.x + w.w for w in hit) + 12
                y2 = max(w.y + w.h for w in hit) + 8
                rects.append((x1, y1, x2, y2))
    return rects

def anchor_region_rects(img: Image.Image, anchor_rules) -> List[Rect]:
    words = ocr_words(img)
    if not words:
        return []
    rects: List[Rect] = []
    for rule in anchor_rules:
        bbox = find_anchor_bbox(words, rule.anchor)
        if not bbox:
            continue
        ax, ay, aw, ah = bbox
        x1 = ax + rule.dx
        y1 = ay + rule.dy
        x2 = x1 + rule.w
        y2 = y1 + rule.h
        rects.append((x1, y1, x2, y2))
    return rects

def try_make_searchable(in_pdf: str, out_pdf: str) -> bool:
    """Attempt to run ocrmypdf if installed; return True if succeeded."""
    cmd = ["ocrmypdf", "--force-ocr", "--skip-text", "--output-type", "pdf", in_pdf, out_pdf]
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        return True
    except FileNotFoundError:
        return False
    except subprocess.CalledProcessError:
        return False

def redact_pdf(
    pdf_path: str,
    output_pdf_path: str,
    template_key: str,
    searchable: bool = True,
    export_images: bool = False,
    images_dir: str | None = None,
) -> Dict[str, Any]:
    tpl = get_template(template_key)
    imgs = pdf_to_images(pdf_path, scale=2.0)

    report: Dict[str, Any] = {
        "template": template_key,
        "pages": [],
        "searchable_requested": searchable,
        "searchable_succeeded": False,
        "export_images": export_images,
    }

    redacted_imgs: List[Image.Image] = []
    for page_idx, img in enumerate(imgs, start=1):
        rects: List[Rect] = []
        rects.extend(tpl.fixed_rects)

        # OCR-driven rects
        anchor_rects = anchor_region_rects(img, tpl.keyword_region_rules)
        regex_rects = regex_rects_from_ocr(img, [r.pattern for r in tpl.regex_rules])
        rects.extend(anchor_rects)
        rects.extend(regex_rects)

        redacted_imgs.append(apply_rects(img, rects))

        report["pages"].append({
            "page": page_idx,
            "fixed_rects": len(tpl.fixed_rects),
            "anchor_rects": len(anchor_rects),
            "regex_rects": len(regex_rects),
            "total_rects": len(rects),
        })

        if export_images and images_dir:
            os.makedirs(images_dir, exist_ok=True)
            out_png = os.path.join(images_dir, f"page-{page_idx:03d}.png")
            redacted_imgs[-1].save(out_png)

    # Flattened PDF (safe)
    images_to_pdf(redacted_imgs, output_pdf_path)

    # Optional searchable layer
    if searchable:
        tmp_out = output_pdf_path.replace(".pdf", ".tmp.searchable.pdf")
        if try_make_searchable(output_pdf_path, tmp_out):
            os.replace(tmp_out, output_pdf_path)
            report["searchable_succeeded"] = True
        else:
            # keep flattened PDF
            if os.path.exists(tmp_out):
                try:
                    os.remove(tmp_out)
                except Exception:
                    pass

    return report

def zip_paths(paths: List[str], zip_path: str):
    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for p in paths:
            if os.path.isdir(p):
                for root, _, files in os.walk(p):
                    for fn in files:
                        fp = os.path.join(root, fn)
                        arc = os.path.relpath(fp, os.path.dirname(p))
                        z.write(fp, arcname=arc)
            else:
                z.write(p, arcname=os.path.basename(p))
