from dataclasses import dataclass
from typing import List, Tuple, Dict

# Rectangle = (x1, y1, x2, y2) in image pixels
Rect = Tuple[int, int, int, int]

@dataclass
class RegexRule:
    label: str
    pattern: str  # python regex

@dataclass
class KeywordRegionRule:
    label: str
    anchor: str   # text to locate on page (OCR)
    # region relative to the anchor's top-left:
    dx: int
    dy: int
    w: int
    h: int

@dataclass
class Template:
    name: str
    fixed_rects: List[Rect]
    regex_rules: List[RegexRule]
    keyword_region_rules: List[KeywordRegionRule]

# STARTER templates — tune these to your layouts.
# A3 focuses on correctness + robustness for image-based PDFs.
TEMPLATES: Dict[str, Template] = {
    "notes": Template(
        name="notes",
        fixed_rects=[
            # Header band (often contains identifiers)
            (0, 0, 10000, 320),
        ],
        regex_rules=[
            RegexRule("phone", r"\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
            RegexRule("dob_mmddyyyy", r"\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](\d{2}|\d{4})\b"),
            RegexRule("ssn", r"\b\d{3}-\d{2}-\d{4}\b"),
            RegexRule("email", r"\b[\w.\-+%]+@[\w.\-]+\.[A-Za-z]{2,}\b"),
            RegexRule("mrn_like", r"\b(MRN|Medical\s*Record\s*#|Record\s*#)\s*[:#]?\s*[A-Za-z0-9\-]+\b"),
        ],
        keyword_region_rules=[
            KeywordRegionRule("patient_label_block", anchor="Patient", dx=-40, dy=-40, w=2400, h=260),
            KeywordRegionRule("dob_label_block", anchor="DOB", dx=-60, dy=-40, w=2200, h=260),
            KeywordRegionRule("name_label_block", anchor="Name", dx=-60, dy=-40, w=2400, h=260),
        ],
    ),
    "surgery_center": Template(
        name="surgery_center",
        fixed_rects=[
            # Facility header band
            (0, 0, 10000, 380),
        ],
        regex_rules=[
            RegexRule("phone", r"\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"),
            RegexRule("dob_mmddyyyy", r"\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-](\d{2}|\d{4})\b"),
            RegexRule("account_like", r"\b(Account\s*#|Acct\s*#|Encounter\s*#)\s*[:#]?\s*[A-Za-z0-9\-]+\b"),
            RegexRule("mrn_like", r"\b(MRN|Medical\s*Record\s*#|Record\s*#)\s*[:#]?\s*[A-Za-z0-9\-]+\b"),
        ],
        keyword_region_rules=[
            KeywordRegionRule("patient_label_block", anchor="Patient", dx=-40, dy=-40, w=2800, h=280),
            KeywordRegionRule("surgeon_label_block", anchor="Surgeon", dx=-40, dy=-40, w=2800, h=280),
            KeywordRegionRule("dob_label_block", anchor="DOB", dx=-60, dy=-40, w=2400, h=280),
        ],
    ),
}

def get_template(template_key: str) -> Template:
    if template_key not in TEMPLATES:
        raise ValueError(f"Unknown template '{template_key}'. Valid: {list(TEMPLATES.keys())}")
    return TEMPLATES[template_key]
