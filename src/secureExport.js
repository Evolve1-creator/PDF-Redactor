import { PDFDocument, rgb } from 'pdf-lib'
import { pdfjsLib } from './pdfjsWorker'

// --- Geometry helpers
const cmToPt = (cm) => cm * 28.346456692913385

/**
 * Draw redactions onto a rendered canvas (burn-in) in VIEWER coordinates.
 * Canvas origin is top-left, matching what the user sees.
 */
export function applyViewerRedactionsToCanvas({
  ctx,
  canvasWidth,
  canvasHeight,
  mode,
  scale,
  surgeryTopCm = 4,
}) {
  ctx.save()
  ctx.fillStyle = '#000'

  if (mode === 'surgery_center') {
    const hPx = cmToPt(surgeryTopCm) * scale
    ctx.fillRect(0, 0, canvasWidth, Math.min(canvasHeight, hPx))
  }

  if (mode === 'no_charge') {
    // Example layout: top header band + top-left box beneath it.
    const headerHPx = cmToPt(3.2) * scale
    ctx.fillRect(0, 0, canvasWidth, Math.min(canvasHeight, headerHPx))

    const boxWPx = Math.min(canvasWidth * 0.55, cmToPt(12) * scale)
    const boxHPx = cmToPt(3.0) * scale
    ctx.fillRect(0, headerHPx, boxWPx, boxHPx)
  }

  ctx.restore()
}

async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('Failed to rasterize canvas')
  const buf = await blob.arrayBuffer()
  return new Uint8Array(buf)
}

// --- OCR helpers (client-side)
let _tessWorkerPromise = null

async function getTesseractWorker() {
  if (_tessWorkerPromise) return _tessWorkerPromise
  _tessWorkerPromise = (async () => {
    const { createWorker } = await import('tesseract.js')
    // Prefer local language data (hosted with your app), but fall back to default.
    // If you add /public/tessdata/eng.traineddata(.gz), set langPath to '/tessdata'.
    const worker = await createWorker({
      langPath: '/tessdata',
      logger: () => {},
    })
    await worker.loadLanguage('eng')
    await worker.initialize('eng')
    return worker
  })()
  return _tessWorkerPromise
}

function normalizeOcrText(text) {
  return (text || '')
    .replace(/\r/g, '')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
}

/**
 * HIPAA-secure + searchable export (client-side):
 * 1) Render page(s) with PDF.js
 * 2) Burn-in redactions on the canvas
 * 3) Build a NEW PDF from the redacted images (no underlying content remains)
 * 4) Run OCR locally and embed OCR text invisibly for search/extraction
 */
export async function redactPdfBytesSecureOcr(inputBytes, mode, opts = {}) {
  const cfg = {
    onlyFirstPage: true,
    renderScale: 2.25, // quality/speed tradeoff
    surgeryTopCm: 4,
    ocr: true,
    ...opts,
  }

  // Load via PDF.js for rendering
  const loadingTask = pdfjsLib.getDocument({ data: inputBytes })
  const pdf = await loadingTask.promise

  const outPdf = await PDFDocument.create()
  const tess = cfg.ocr ? await getTesseractWorker() : null

  const pageNums = cfg.onlyFirstPage ? [1] : Array.from({ length: pdf.numPages }, (_, i) => i + 1)

  for (const pageNumber of pageNums) {
    const page = await pdf.getPage(pageNumber)

    // Viewport in PDF points (scale=1) for correct PDF page size
    const vpPt = page.getViewport({ scale: 1 })
    const vpPx = page.getViewport({ scale: cfg.renderScale })

    // Render to a canvas
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(vpPx.width)
    canvas.height = Math.floor(vpPx.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')

    await page.render({ canvasContext: ctx, viewport: vpPx }).promise

    // Burn-in redactions (viewer coordinates)
    applyViewerRedactionsToCanvas({
      ctx,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      mode,
      scale: cfg.renderScale,
      surgeryTopCm: cfg.surgeryTopCm,
    })

    // OCR the REDACTED pixels only (safe)
    let ocrText = ''
    if (tess) {
      const r = await tess.recognize(canvas)
      ocrText = normalizeOcrText(r?.data?.text || '')
    }

    // Build output PDF page from the redacted image
    const imgBytes = await canvasToPngBytes(canvas)
    const img = await outPdf.embedPng(imgBytes)

    const outPage = outPdf.addPage([vpPt.width, vpPt.height])
    outPage.drawImage(img, {
      x: 0,
      y: 0,
      width: vpPt.width,
      height: vpPt.height,
    })

    // Embed OCR text invisibly so the PDF is searchable/extractable by downstream tools.
    // We do NOT try to position every word; we only need robust text extraction.
    if (ocrText && ocrText.trim()) {
      // Chunk to avoid extremely long operators
      const chunks = []
      const max = 3500
      for (let i = 0; i < ocrText.length; i += max) chunks.push(ocrText.slice(i, i + max))

      for (let i = 0; i < chunks.length; i++) {
        outPage.drawText(chunks[i], {
          x: 1,
          y: 1 + i * 2,
          size: 1.5,
          color: rgb(0, 0, 0),
          opacity: 0, // if unsupported by a viewer, the tiny font still keeps it effectively invisible
        })
      }
    }
  }

  // Make extraction more compatible with downstream parsers
  return await outPdf.save({ useObjectStreams: false })
}
