import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { pdfjsLib } from './pdfjsWorker'
import Tesseract from 'tesseract.js'

/**
 * HIPAA-safe (true) redaction + searchable output, fully client-side.
 *
 * IMPORTANT:
 * - Overlay rectangles (just drawing black boxes in the PDF) are NOT true redaction for
 *   computer-generated PDFs because the underlying text can still be extracted.
 * - This implementation burns-in redactions by rasterizing pages, applying redaction to
 *   pixels, and rebuilding a NEW PDF from the redacted images.
 * - To make the result searchable/extractable, we run OCR on the already-redacted pixels
 *   and embed the OCR text as an invisible layer.
 *
 * Template tuned from a sample Epic progress note where the redacted regions were
 * highlighted in red (page 1 large header; pages 2+ thin header; all pages footer).
 */

export const RedactionMode = {
  SURGERY_CENTER: 'surgery_center', // legacy: top band
  NO_CHARGE: 'no_charge'            // Epic note header/footer template
}

// Fractions of rendered page height (viewer orientation), tuned from the user's
// sample “red highlight” PDF.
//
// Page 1 has a large patient/demographics header block.
// Pages 2+ have only a thin running header line.
// All pages include a small “Printed by / MRN / timestamp” footer line.
//
// We intentionally add a small safety margin (slightly larger than the red boxes)
// to avoid leaving slivers of PHI behind.
const TEMPLATE = {
  page1TopFrac: 0.410,       // ~0.402 in sample, + safety margin
  otherHeaderFrac: 0.022,    // ~0.017–0.019 in sample, + margin
  footerFrac: 0.036          // ~0.032–0.037 in sample
}

function clamp(n, min, max){
  return Math.max(min, Math.min(max, n))
}

function getEpicHeaderFooterRects(pageIndex, canvasW, canvasH){
  const topH = pageIndex === 0
    ? Math.round(canvasH * TEMPLATE.page1TopFrac)
    : Math.round(canvasH * TEMPLATE.otherHeaderFrac)
  const footH = Math.round(canvasH * TEMPLATE.footerFrac)

  return [
    { x: 0, y: 0, w: canvasW, h: topH },
    { x: 0, y: canvasH - footH, w: canvasW, h: footH }
  ]
}

export function computeRedactionRects(mode, pageIndex, canvasW, canvasH, pageSizePt, cfg){
  let rects = []

  if (mode === RedactionMode.NO_CHARGE){
    rects = getEpicHeaderFooterRects(pageIndex, canvasW, canvasH)
  } else if (mode === RedactionMode.SURGERY_CENTER){
    const sizePt = pageSizePt || { width: canvasW, height: canvasH }
    const pageHeightCm = (sizePt.height / 72) * 2.54
    const frac = (cfg?.surgeryTopCm ?? 4) / pageHeightCm
    const topPx = Math.round(canvasH * frac)
    rects = [{ x: 0, y: 0, w: canvasW, h: topPx }]
    if (cfg?.alsoRedactFooter ?? true){
      const footH = Math.round(canvasH * TEMPLATE.footerFrac)
      rects.push({ x: 0, y: canvasH - footH, w: canvasW, h: footH })
    }
  }

  if (cfg && cfg.applyAllPages === false && pageIndex !== 0) return []
  return rects
}

async function renderPageToCanvas(pdfjsPage, scale){
  const viewport = pdfjsPage.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await pdfjsPage.render({ canvasContext: ctx, viewport }).promise
  return { canvas, ctx }
}

function applyRedactionsToCanvas(ctx, rects){
  ctx.save()
  ctx.fillStyle = 'black'
  for (const r of rects){
    const x = clamp(r.x, 0, ctx.canvas.width)
    const y = clamp(r.y, 0, ctx.canvas.height)
    const w = clamp(r.w, 0, ctx.canvas.width - x)
    const h = clamp(r.h, 0, ctx.canvas.height - y)
    if (w > 0 && h > 0) ctx.fillRect(x, y, w, h)
  }
  ctx.restore()
}

async function canvasToPngBytes(canvas){
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  const ab = await blob.arrayBuffer()
  return new Uint8Array(ab)
}

async function getPdfLibPageSizes(inputBytes){
  const src = await PDFDocument.load(inputBytes, { updateMetadata: false })
  return src.getPages().map(p => {
    const { width, height } = p.getSize()
    return { width, height }
  })
}

async function addInvisibleTextLayer(pdfLibPage, font, text){
  // Some viewers/parsers ignore opacity=0. Use near-zero opacity instead.
  const CHUNK = 6000
  const opacity = 0.01
  let offset = 0
  let y = 10

  while (offset < text.length){
    const chunk = text.slice(offset, offset + CHUNK)
    pdfLibPage.drawText(chunk, {
      x: 10,
      y,
      size: 6,
      font,
      color: rgb(0,0,0),
      opacity,
      maxWidth: pdfLibPage.getWidth() - 20,
      lineHeight: 7
    })
    offset += CHUNK
    y += 8
    if (y > pdfLibPage.getHeight() - 20) y = 10
  }
}

/**
 * Redact PDF bytes.
 *
 * Options:
 * - applyAllPages: boolean (default depends on mode)
 * - includeOcr: boolean (default true; required for ChatGPT-searchable output)
 * - renderScale: number (default 2.0; higher = clearer OCR but slower/larger files)
 * - surgeryTopCm: number (default 4; only for SURGERY_CENTER)
 * - alsoRedactFooter: boolean (default true; for SURGERY_CENTER)
 */
export async function redactPdfBytes(inputBytes, mode, opts = {}) {
  // Some files labeled ".pdf" may include leading bytes before the %PDF header
  // (BOM, proxy banners, etc.). PDF.js will throw "No PDF header found".
  // The PDF spec allows the header to appear within the first 1024 bytes.
  // Normalize by trimming everything before the first "%PDF-" in that window.
  const needle = [0x25, 0x50, 0x44, 0x46, 0x2D] // "%PDF-"
  const scanLen = Math.min(1024, inputBytes?.length || 0)
  let headerAt = -1
  for (let i = 0; i <= scanLen - needle.length; i++){
    let ok = true
    for (let j = 0; j < needle.length; j++){
      if (inputBytes[i + j] !== needle[j]) { ok = false; break }
    }
    if (ok) { headerAt = i; break }
  }
  if (headerAt === -1){
    throw new Error('Input is not a valid PDF (missing %PDF header).')
  }
  if (headerAt > 0){
    inputBytes = inputBytes.slice(headerAt)
  }

  const cfg = {
    applyAllPages: mode === RedactionMode.NO_CHARGE,
    includeOcr: true,
    renderScale: 2.0,
    surgeryTopCm: 4,
    alsoRedactFooter: true,
    ...opts
  }

  // Load with PDF.js for rendering.
  const loadingTask = pdfjsLib.getDocument({ data: inputBytes })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages

  // Load original page sizes (points) so the rebuilt PDF prints normally.
  const pageSizes = await getPdfLibPageSizes(inputBytes)

  // OCR worker (single worker reused across pages)
  let worker = null
  if (cfg.includeOcr){
    worker = await Tesseract.createWorker('eng', 1, {
      langPath: '/tessdata',
      logger: () => {}
    })
  }

  const outPdf = await PDFDocument.create()
  const font = await outPdf.embedFont(StandardFonts.Helvetica)

  for (let i = 0; i < pageCount; i++){
    const pdfjsPage = await pdf.getPage(i + 1)
    const { canvas, ctx } = await renderPageToCanvas(pdfjsPage, cfg.renderScale)

    const sizePtForRects = pageSizes[i] || pageSizes[0]
    const rects = computeRedactionRects(mode, i, canvas.width, canvas.height, sizePtForRects, cfg)

    applyRedactionsToCanvas(ctx, rects)

    // Rebuild PDF page from redacted pixels
    const pngBytes = await canvasToPngBytes(canvas)
    const png = await outPdf.embedPng(pngBytes)

    const outSizePt = pageSizes[i] || { width: png.width, height: png.height }
    const page = outPdf.addPage([outSizePt.width, outSizePt.height])
    page.drawImage(png, { x: 0, y: 0, width: outSizePt.width, height: outSizePt.height })

    // OCR (after burn-in), embed invisible text
    if (cfg.includeOcr){
      const dataUrl = canvas.toDataURL('image/png')
      const result = await worker.recognize(dataUrl)
      const text = (result?.data?.text || '').trim()
      if (text) await addInvisibleTextLayer(page, font, text)
    }
  }

  if (worker){
    try { await worker.terminate() } catch {}
  }

  return await outPdf.save({ useObjectStreams: false })
}
