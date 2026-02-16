import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { pdfjsLib } from './pdfjsWorker'
import { createWorker } from 'tesseract.js'

// Local URLs for Tesseract worker & core (Vite will emit these files).
// This avoids relying on a third-party CDN, which is often blocked and will make OCR "appear" to run
// but produce non-searchable output.
import tesseractWorkerPath from 'tesseract.js/dist/worker.min.js?url'
import tesseractCorePath from 'tesseract.js-core/tesseract-core.wasm.js?url'
import tesseractWasmPath from 'tesseract.js-core/tesseract-core.wasm?url'

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

/**
 * Normalize bytes that are supposed to be a PDF.
 *
 * Why this exists:
 * - Some systems save files with a .pdf extension that are actually HTML error pages.
 * - Some gateways prepend junk bytes before the %PDF header.
 * - Batch exports should skip/bail with a *clear* error instead of a generic PDF.js parse failure.
 */
// NOTE: Some portals prepend a lot of bytes before the header (or embed PDFs in wrappers).
// We default to a deeper scan than 1–2MB to reduce false "No PDF header" errors.
export function normalizePdfBytes(bytes, { maxScanBytes = 16 * 1024 * 1024 } = {}){
  if (!bytes || bytes.length < 5) throw new Error('File is empty or too small to be a PDF.')

  // Detect HTML masquerading as PDF
  const headAscii = String.fromCharCode(...bytes.slice(0, Math.min(64, bytes.length))).toLowerCase()
  if (headAscii.includes('<!doctype html') || headAscii.includes('<html') || headAscii.includes('<head')){
    throw new Error('This file looks like an HTML page, not a PDF (common when a download is blocked or requires login). Re-download the document as a true PDF.')
  }

  const needle = [0x25, 0x50, 0x44, 0x46, 0x2D] // "%PDF-"
  const scanLen = Math.min(maxScanBytes, bytes.length)
  let headerAt = -1
  for (let i = 0; i <= scanLen - needle.length; i++){
    let ok = true
    for (let j = 0; j < needle.length; j++){
      if (bytes[i + j] !== needle[j]) { ok = false; break }
    }
    if (ok) { headerAt = i; break }
  }
  if (headerAt === -1){
    throw new Error('Input is not a valid PDF (missing %PDF header).')
  }

  const out = headerAt === 0 ? bytes : bytes.slice(headerAt)

  // Basic version sanity check: "%PDF-1.x"
  const v = String.fromCharCode(...out.slice(0, Math.min(12, out.length)))
  if (!/^%PDF-\d\.\d/.test(v)){
    // If we matched a false-positive %PDF- inside the file, this helps explain the failure.
    throw new Error('Found a %PDF marker, but the file does not appear to be a valid PDF header. The file may be corrupted or not actually a PDF.')
  }
  return out
}

async function assertOcrAssetsPresent(){
  // For fully client-side operation, the language data must be served from this app.
  // We check for common filenames so failures are obvious (instead of silently producing
  // non-searchable PDFs).
  const candidates = [
    '/tessdata/eng.traineddata',
    '/tessdata/eng.traineddata.gz'
  ]
  for (const url of candidates){
    try{
      // Some hosts (and some CDNs) do not support HEAD properly.
      // Use a tiny GET with a Range header to prove the file is reachable.
      const res = await fetch(url, {
        method: 'GET',
        headers: { 'Range': 'bytes=0-15' },
        cache: 'no-store'
      })
      if (res.ok) return url
    }catch{}
  }
  throw new Error(
    'OCR is enabled, but the English OCR model file was not found at /public/tessdata/. ' +
    'Add eng.traineddata (or eng.traineddata.gz) to public/tessdata and redeploy. ' +
    'Without it, the export cannot be made searchable client-side.'
  )
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
  // Normalize PDF bytes early so we can give a clear error if the file is not a real PDF.
  // This also trims leading junk bytes (BOM/proxy banners) that can break PDF.js.
  inputBytes = normalizePdfBytes(inputBytes)

  const cfg = {
    applyAllPages: mode === RedactionMode.NO_CHARGE,
    includeOcr: true,
    renderScale: 2.0,
    surgeryTopCm: 4,
    alsoRedactFooter: true,
    ...opts
  }

  // Load with PDF.js for rendering.
  // If PDF.js still complains about missing headers, retry with a deeper scan.
  let pdf
  try{
    const loadingTask = pdfjsLib.getDocument({ data: inputBytes })
    pdf = await loadingTask.promise
  } catch (e){
    const msg = String(e?.message || e)
    if (msg.toLowerCase().includes('no pdf header found')){
      // Some files violate the "header within 1024 bytes" convention.
      // Try again scanning deeper before giving up.
      const normalized = normalizePdfBytes(inputBytes, { maxScanBytes: Math.min(16 * 1024 * 1024, inputBytes.length) })
      try{
        const loadingTask = pdfjsLib.getDocument({ data: normalized })
        pdf = await loadingTask.promise
        inputBytes = normalized
      } catch (e2){
        const peek = inputBytes.slice(0, 24)
        const hex = Array.from(peek).map(b => b.toString(16).padStart(2,'0')).join(' ')
        const ascii = String.fromCharCode(...peek).replace(/[\x00-\x1F\x7F]/g,'.')
        throw new Error(`PDF.js could not parse this file as a PDF (No PDF header found). This usually means the file is not a real PDF (often HTML/login page) or it is corrupted. First bytes (ascii): "${ascii}" | (hex): ${hex}`)
      }
    } else {
      throw e
    }
  }
  const pageCount = pdf.numPages

  // Load original page sizes (points) so the rebuilt PDF prints normally.
  const pageSizes = await getPdfLibPageSizes(inputBytes)

  // OCR worker (single worker reused across pages)
  // tesseract.js v5 requires explicit loadLanguage/initialize.
  let worker = null
  let ocrModelUrl = null
  if (cfg.includeOcr){
    // Make missing OCR assets an explicit, actionable error.
    ocrModelUrl = await assertOcrAssetsPresent()

    worker = await createWorker({
      // Pin worker/core to local bundled assets.
      workerPath: tesseractWorkerPath,
      corePath: tesseractCorePath,
      wasmPath: tesseractWasmPath,
      langPath: '/tessdata',
      logger: () => {},
    })
    await worker.loadLanguage('eng')
    await worker.initialize('eng')
  }

  const outPdf = await PDFDocument.create()
  const font = await outPdf.embedFont(StandardFonts.Helvetica)

  // Used to verify the output is actually searchable when OCR is enabled.
  let ocrTotalChars = 0
  let ocrNonEmptyPages = 0

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
      let text = ''
      try{
        const dataUrl = canvas.toDataURL('image/png')
        const result = await worker.recognize(dataUrl)
        text = (result?.data?.text || '').trim()
      }catch(e){
        const msg = String(e?.message || e)
        throw new Error(
          `OCR failed on page ${i + 1}. ${msg} ` +
          `(OCR model expected at ${ocrModelUrl || '/tessdata/eng.traineddata'}).`
        )
      }
      if (text){
        ocrTotalChars += text.length
        ocrNonEmptyPages += 1
        await addInvisibleTextLayer(page, font, text)
      }
    }
  }

  if (worker){
    try { await worker.terminate() } catch {}
  }

  // If OCR is enabled but produced no text at all, the file will not be searchable.
  // Fail loudly with a specific message so the user can fix it (usually missing tessdata,
  // blocked fetch, or OCR set to a language not present).
  if (cfg.includeOcr && ocrTotalChars === 0){
    throw new Error(
      'OCR completed but produced 0 extractable characters, so the output is NOT searchable. ' +
      'Common causes: missing /public/tessdata/eng.traineddata (or .gz), blocked network fetch for tessdata, ' +
      'or OCR failing silently due to browser restrictions. Add tessdata locally and try again. '
    )
  }

  return await outPdf.save({ useObjectStreams: false })
}

// Same as redactPdfBytes but also returns OCR/extracted text.
// This is used so we can always place a GPT-readable text file into the ZIP even if
// a PDF viewer doesn't index the invisible text layer as expected.
export async function redactPdfBytesWithText(inputBytes, mode, opts = {}) {
  inputBytes = normalizePdfBytes(inputBytes)

  const cfg = {
    applyAllPages: mode === RedactionMode.NO_CHARGE,
    includeOcr: true,
    renderScale: 2.0,
    surgeryTopCm: 4,
    alsoRedactFooter: true,
    ...opts
  }

  const loadingTask = pdfjsLib.getDocument({ data: inputBytes })
  const pdf = await loadingTask.promise
  const pageCount = pdf.numPages
  const pageSizes = await getPdfLibPageSizes(inputBytes)

  let worker = null
  let ocrModelUrl = null
  if (cfg.includeOcr){
    ocrModelUrl = await assertOcrAssetsPresent()
    worker = await createWorker({
      workerPath: tesseractWorkerPath,
      corePath: tesseractCorePath,
      wasmPath: tesseractWasmPath,
      langPath: '/tessdata',
      logger: () => {},
    })
    await worker.loadLanguage('eng')
    await worker.initialize('eng')
  }

  const outPdf = await PDFDocument.create()
  const font = await outPdf.embedFont(StandardFonts.Helvetica)

  let ocrTotalChars = 0
  const texts = []

  for (let i = 0; i < pageCount; i++){
    const pdfjsPage = await pdf.getPage(i + 1)
    const { canvas, ctx } = await renderPageToCanvas(pdfjsPage, cfg.renderScale)

    const sizePtForRects = pageSizes[i] || pageSizes[0]
    const rects = computeRedactionRects(mode, i, canvas.width, canvas.height, sizePtForRects, cfg)
    applyRedactionsToCanvas(ctx, rects)

    const pngBytes = await canvasToPngBytes(canvas)
    const png = await outPdf.embedPng(pngBytes)
    const outSizePt = pageSizes[i] || { width: png.width, height: png.height }
    const page = outPdf.addPage([outSizePt.width, outSizePt.height])
    page.drawImage(png, { x: 0, y: 0, width: outSizePt.width, height: outSizePt.height })

    if (cfg.includeOcr){
      let text = ''
      try{
        const dataUrl = canvas.toDataURL('image/png')
        const result = await worker.recognize(dataUrl)
        text = (result?.data?.text || '').trim()
      }catch(e){
        const msg = String(e?.message || e)
        throw new Error(`OCR failed on page ${i + 1}. ${msg} (OCR model expected at ${ocrModelUrl || '/tessdata/eng.traineddata'}).`)
      }
      if (text){
        ocrTotalChars += text.length
        texts.push(`--- Page ${i + 1} ---\n${text}`)
        await addInvisibleTextLayer(page, font, text)
      } else {
        texts.push(`--- Page ${i + 1} ---\n`)
      }
    }
  }

  try{ await worker?.terminate() }catch{}

  if (cfg.includeOcr && ocrTotalChars === 0){
    throw new Error(
      'OCR completed but produced 0 extractable characters, so the output is NOT searchable. ' +
      'Common causes: missing /public/tessdata/eng.traineddata (or .gz), blocked fetch for tessdata, or OCR failing silently.'
    )
  }

  const pdfBytes = await outPdf.save({ useObjectStreams: false })
  const gptText = texts.join('\n\n').trim()
  return { pdfBytes, gptText }
}

// -----------------------------
// "ANY FILE" INPUT SUPPORT
// -----------------------------

function bytesStartWith(bytes, sig){
  if (!bytes || bytes.length < sig.length) return false
  for (let i = 0; i < sig.length; i++) if (bytes[i] !== sig[i]) return false
  return true
}

function sniffKind(bytes){
  if (!bytes || bytes.length < 4) return 'unknown'
  // PDF
  if (bytesStartWith(bytes, [0x25,0x50,0x44,0x46,0x2d])) return 'pdf'
  // PNG
  if (bytesStartWith(bytes, [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a])) return 'png'
  // JPEG
  if (bytesStartWith(bytes, [0xff,0xd8,0xff])) return 'jpeg'
  // HTML-ish
  const headAscii = String.fromCharCode(...bytes.slice(0, Math.min(64, bytes.length))).toLowerCase()
  if (headAscii.includes('<!doctype html') || headAscii.includes('<html') || headAscii.includes('<head')) return 'html'
  return 'unknown'
}

function base64ToBytes(b64){
  // Remove whitespace/newlines
  const clean = b64.replace(/[\r\n\t\s]/g,'')
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function tryExtractEmbeddedPdfBytes(wrapperBytes){
  // Many portals download an HTML wrapper that embeds the PDF as base64.
  // We look for either data:application/pdf;base64,... or a raw JVBERi0... blob.
  try{
    const text = new TextDecoder('utf-8', { fatal: false }).decode(wrapperBytes)
    const m1 = text.match(/data:application\/pdf;base64,([A-Za-z0-9+\/=_-]+)/)
    if (m1?.[1]) return normalizePdfBytes(base64ToBytes(m1[1]))
    const idx = text.indexOf('JVBERi0')
    if (idx !== -1){
      // Expand until a non-base64 char (very heuristic but works for common wrappers)
      let end = idx
      while (end < text.length && /[A-Za-z0-9+\/=_-]/.test(text[end])) end++
      const b64 = text.slice(idx, end)
      if (b64.length > 1000) return normalizePdfBytes(base64ToBytes(b64))
    }
  }catch{}
  return null
}

function scrubTextBestEffort(raw){
  // BEST-EFFORT scrub for non-renderable inputs. This is NOT as reliable as burn-in.
  // Remove common header lines and identifiers.
  const lines = raw.split(/\r?\n/)
  const out = []
  for (const line of lines){
    const l = line.trim()
    if (!l) continue
    if (/\b(name|patient name|dob|date of birth|mrn|acct|account|address|phone|ssn)\b\s*[:#]/i.test(l)) continue
    if (/\bprinted by\b/i.test(l)) continue
    if (/\b(\d{2}\/\d{2}\/\d{4})\b/.test(l) && /\b(dob|date of birth)\b/i.test(l)) continue
    out.push(line)
  }
  return out.join('\n')
}

async function redactCanvasToPdfAndText(canvas, mode, pageIndex, pageSizePt, cfg, worker, outPdf, font){
  const ctx = canvas.getContext('2d', { alpha: false })
  const rects = computeRedactionRects(mode, pageIndex, canvas.width, canvas.height, pageSizePt, cfg)
  applyRedactionsToCanvas(ctx, rects)
  const pngBytes = await canvasToPngBytes(canvas)
  const png = await outPdf.embedPng(pngBytes)
  const outSizePt = pageSizePt || { width: png.width, height: png.height }
  const page = outPdf.addPage([outSizePt.width, outSizePt.height])
  page.drawImage(png, { x: 0, y: 0, width: outSizePt.width, height: outSizePt.height })

  let text = ''
  if (cfg.includeOcr && worker){
    const dataUrl = canvas.toDataURL('image/png')
    const result = await worker.recognize(dataUrl)
    text = (result?.data?.text || '').trim()
    if (text) await addInvisibleTextLayer(page, font, text)
  }
  return text
}

export async function convertAnyToArtifacts(inputBytes, mode, opts = {}){
  // Returns:
  // - pdfBytes: searchable PDF when possible
  // - gptText: OCR/extracted text (best-effort)
  // - warnings: array of strings
  const warnings = []
  const cfg = {
    applyAllPages: mode === RedactionMode.NO_CHARGE,
    includeOcr: true,
    renderScale: 2.5,
    surgeryTopCm: 4,
    alsoRedactFooter: true,
    ...opts
  }

  // 1) Try as real PDF
  let asPdfBytes = null
  try{ asPdfBytes = normalizePdfBytes(inputBytes) }catch{}
  if (!asPdfBytes){
    // 2) Try embedded/base64 PDF wrapper
    const embedded = tryExtractEmbeddedPdfBytes(inputBytes)
    if (embedded) asPdfBytes = embedded
  }

  if (asPdfBytes){
    // Standard pipeline: burn-in + OCR text layer
    const { pdfBytes, gptText } = await redactPdfBytesWithText(asPdfBytes, mode, cfg)
    return { pdfBytes, gptText: gptText || '', warnings }
  }

  // 3) Try as image
  const kind = sniffKind(inputBytes)
  if (kind === 'png' || kind === 'jpeg'){
    if (!cfg.includeOcr) warnings.push('Image input processed without OCR: output will not be searchable.')

    // OCR worker
    let worker = null
    if (cfg.includeOcr){
      await assertOcrAssetsPresent()
      worker = await createWorker({
        workerPath: tesseractWorkerPath,
        corePath: tesseractCorePath,
        wasmPath: tesseractWasmPath,
        langPath: '/tessdata',
        logger: () => {},
      })
      await worker.loadLanguage('eng')
      await worker.initialize('eng')
    }

    const outPdf = await PDFDocument.create()
    const font = await outPdf.embedFont(StandardFonts.Helvetica)

    const blob = new Blob([inputBytes], { type: kind === 'png' ? 'image/png' : 'image/jpeg' })
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(bitmap.width * (cfg.renderScale || 2.0))
    canvas.height = Math.ceil(bitmap.height * (cfg.renderScale || 2.0))
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    // Use 1px = 1pt for simplicity; this is fine for GPT readability.
    const pageSizePt = { width: canvas.width, height: canvas.height }
    const ocrText = await redactCanvasToPdfAndText(canvas, mode, 0, pageSizePt, cfg, worker, outPdf, font)
    try{ await worker?.terminate() }catch{}

    const pdfBytes = await outPdf.save({ useObjectStreams: false })
    return { pdfBytes, gptText: ocrText || '', warnings }
  }

  // 4) Fallback: treat as text-ish and export GPT-readable text
  try{
    const raw = new TextDecoder('utf-8', { fatal: false }).decode(inputBytes)
    const scrubbed = scrubTextBestEffort(raw)
    warnings.push('Input was not a renderable PDF/image. Exporting best-effort scrubbed text for GPT readability; verify PHI removal manually.')
    return { pdfBytes: null, gptText: scrubbed, warnings }
  }catch{
    warnings.push('Unknown file type: could not extract text or render. Skipped.')
    return { pdfBytes: null, gptText: '', warnings }
  }
}
