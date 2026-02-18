from __future__ import annotations
from dataclasses import dataclass
from typing import List, Tuple, Optional
import re
import os

from PIL import Image
import pytesseract

from config import TESSERACT_CMD

# Configure tesseract path if provided
if TESSERACT_CMD:
    pytesseract.pytesseract.tesseract_cmd = TESSERACT_CMD

@dataclass
class OCRWord:
    text: str
    x: int
    y: int
    w: int
    h: int
    conf: float

def ocr_words(img: Image.Image) -> List[OCRWord]:
    """Run Tesseract OCR and return word-level boxes."""
    data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
    words: List[OCRWord] = []
    n = len(data.get("text", []))
    for i in range(n):
        txt = (data["text"][i] or "").strip()
        if not txt:
            continue
        try:
            conf = float(data.get("conf", ["-1"])[i])
        except Exception:
            conf = -1.0
        # Filter out very low confidence noise
        if conf != -1.0 and conf < 30:
            continue
        words.append(
            OCRWord(
                text=txt,
                x=int(data["left"][i]),
                y=int(data["top"][i]),
                w=int(data["width"][i]),
                h=int(data["height"][i]),
                conf=conf,
            )
        )
    return words

def normalize(s: str) -> str:
    s = re.sub(r"\s+", " ", s.strip().lower())
    # remove trailing punctuation for anchor matching
    s = re.sub(r"[,:;]+$", "", s)
    return s

def find_anchor_bbox(words: List[OCRWord], anchor: str) -> Optional[Tuple[int,int,int,int]]:
    """Best-effort anchor find for single or multi-word anchors."""
    anchor_norm = normalize(anchor)
    anchor_parts = anchor_norm.split(" ")
    wnorm = [normalize(w.text) for w in words]

    if len(anchor_parts) == 1:
        for w, wn in zip(words, wnorm):
            if wn == anchor_norm:
                return (w.x, w.y, w.w, w.h)
        return None

    for i in range(0, len(words) - len(anchor_parts) + 1):
        if wnorm[i:i+len(anchor_parts)] == anchor_parts:
            xs = [words[j].x for j in range(i, i+len(anchor_parts))]
            ys = [words[j].y for j in range(i, i+len(anchor_parts))]
            x2 = [words[j].x + words[j].w for j in range(i, i+len(anchor_parts))]
            y2 = [words[j].y + words[j].h for j in range(i, i+len(anchor_parts))]
            return (min(xs), min(ys), max(x2)-min(xs), max(y2)-min(ys))
    return None
