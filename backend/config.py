import os

# If Tesseract is not on PATH (common on Windows), set this env var:
#   setx TESSERACT_CMD "C:\\Program Files\\Tesseract-OCR\\tesseract.exe"
TESSERACT_CMD = os.getenv("TESSERACT_CMD", "").strip()

# Maximum upload size can be enforced at reverse proxy; FastAPI itself doesn't hard-stop large uploads by default.
