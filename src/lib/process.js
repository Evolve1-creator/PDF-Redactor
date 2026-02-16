import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { pdfjsLib } from './pdfjs'
import { getRedactionRects, isPointRedacted, RedactionMode } from './templates'
import { createWorker } from 'tesseract.js'

// Local worker/core paths (bundled by Vite) to avoid CDNs.
import tesseractWorkerPath from 'tesseract.js/dist/worker.min.js?url'
import tesseractCorePath from 'tesseract.js-core/tesseract-core.wasm.js?url'
import tesseractWasmPath from 'tesseract.js-core/tesseract-core.wasm?url'

const PDF_HEADER = new TextEncoder().encode('%PDF-')

export function normalizePdfBytes(bytes){
  if (!bytes || bytes.length < 5) throw new Error('File is empty or too small.')
  // scan first 2MB for %PDF-
  const scanLen = Math.min(bytes.length, 2 * 1024 * 1024)
  let at = -1
  outer: for (let i=0;i<=scanLen-PDF_HEADER.length;i++){
    for (let j=0;j<PDF_HEADER.length;j++){
      if (bytes[i+j] !== PDF_HEADER[j]) continue outer
    }
    at = i; break
  }
  if (at === -1) throw new Error('No %PDF header found. This file is not a real PDF.')
  return at === 0 ? bytes : bytes.slice(at)
}

function rectsToCanvas(rects, pageW, pageH, scale){
  // PDF rects use bottom-left origin. Canvas uses top-left.
  return rects.map(r => {
    const x = r.x * scale
    const yTop = (pageH - (r.y + r.h)) * scale
    return { x, y: yTop, w: r.w * scale, h: r.h * scale }
  })
}

async function getTesseractWorker(lang='eng'){
  const worker = await createWorker({
    workerPath: tesseractWorkerPath,
    corePath: tesseractCorePath,
    wasmPath: tesseractWasmPath,
    logger: () => {}
  })
  await worker.loadLanguage(lang)
  await worker.initialize(lang)
  return worker
}

async function renderPageToCanvas(page, scale){
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha: false })
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  return { canvas, ctx, viewport }
}

function drawRedactionRectsOnCanvas(ctx, rects){
  ctx.save()
  ctx.fillStyle = 'black'
  for (const r of rects){
    ctx.fillRect(r.x, r.y, r.w, r.h)
  }
  ctx.restore()
}

async function canvasToPngBytes(canvas){
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  const ab = await blob.arrayBuffer()
  return new Uint8Array(ab)
}

export async function buildSearchablePdfFromText(pdfBytes, mode){
  // Primary path for Microsoft Print-to-PDF (text-based PDFs):
  // 1) extract text items via PDF.js
  // 2) exclude any items inside redaction rectangles
  // 3) rebuild a new PDF (text objects) via pdf-lib
  const bytes = normalizePdfBytes(pdfBytes)
  const src = await pdfjsLib.getDocument({ data: bytes }).promise

  const out = await PDFDocument.create()
  out.setTitle('Redacted')
  out.setCreator('PHI PDF Redactor')
  out.setProducer('PHI PDF Redactor')
  out.setSubject('PHI Redacted')

  const font = await out.embedFont(StandardFonts.Helvetica)

  let allText = ''
  const warnings = []

  for (let pageIndex=0; pageIndex<src.numPages; pageIndex++){
    const page = await src.getPage(pageIndex + 1)
    const viewport = page.getViewport({ scale: 1 })
    const pageW = viewport.width
    const pageH = viewport.height

    const rects = getRedactionRects(mode, pageIndex, pageW, pageH)

    const outPage = out.addPage([pageW, pageH])
    // draw black boxes to make the redaction regions visually obvious
    for (const r of rects){
      outPage.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(0,0,0) })
    }

    const textContent = await page.getTextContent({ includeMarkedContent: false })
    if (!textContent?.items?.length){
      warnings.push(`Page ${pageIndex+1}: no text content detected. Consider using the Raster+OCR export for this document.`)
      allText += `\n\n--- Page ${pageIndex+1} (no extractable text) ---\n`
      continue
    }

    allText += `\n\n--- Page ${pageIndex+1} ---\n`

    for (const item of textContent.items){
      const str = (item.str ?? '').toString()
      if (!str) continue

      // Convert item transform to viewport coords.
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform)
      const x = tx[4]
      const yTop = tx[5]
      const y = pageH - yTop

      // Skip anything inside redaction rects
      if (isPointRedacted(x, y, rects)) continue

      // font size estimate
      const sizeRaw = Math.abs(item.height || tx[0] || 10)
      const size = Math.max(4, Math.min(24, sizeRaw))

      // Draw text. If unsupported chars cause errors, fall back.
      try{
        outPage.drawText(str, { x, y, size, font, color: rgb(0,0,0) })
      }catch{
        const safe = str.replace(/[\u0000-\u001f]/g,'')
        try{ outPage.drawText(safe, { x, y, size, font, color: rgb(0,0,0) }) } catch{}
      }

      // Build GPT-friendly text output
      allText += str
      if (!str.endsWith(' ')) allText += ' '
    }
  }

  const outBytes = await out.save({ useObjectStreams: true })
  return { pdfBytes: outBytes, gptText: allText.trim(), warnings }
}

export async function buildRasterOcrPdf(pdfBytes, mode, { scale = 2.5 } = {}){
  // Fidelity path: rasterize the page, burn-in redactions, rebuild PDF from pixels, then OCR.
  const bytes = normalizePdfBytes(pdfBytes)
  const src = await pdfjsLib.getDocument({ data: bytes }).promise
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica)

  let worker = null
  let ocrEnabled = true
  const warnings = []
  let allText = ''

  try{
    worker = await getTesseractWorker('eng')
  }catch(e){
    ocrEnabled = false
    warnings.push('OCR could not be initialized. The output PDF will not be searchable. (Ensure tessdata/eng.traineddata is available and worker/wasm assets are not blocked.)')
  }

  for (let pageIndex=0; pageIndex<src.numPages; pageIndex++){
    const page = await src.getPage(pageIndex + 1)
    const viewport1 = page.getViewport({ scale: 1 })
    const pageW = viewport1.width
    const pageH = viewport1.height

    const { canvas, ctx } = await renderPageToCanvas(page, scale)
    const rects = getRedactionRects(mode, pageIndex, pageW, pageH)
    const cRects = rectsToCanvas(rects, pageW, pageH, scale)
    drawRedactionRectsOnCanvas(ctx, cRects)

    const pngBytes = await canvasToPngBytes(canvas)
    const img = await out.embedPng(pngBytes)
    const outPage = out.addPage([pageW, pageH])
    outPage.drawImage(img, { x: 0, y: 0, width: pageW, height: pageH })

    if (ocrEnabled && worker){
      const result = await worker.recognize(canvas)
      const text = (result?.data?.text || '').trim()
      if (text){
        allText += `\n\n--- Page ${pageIndex+1} ---\n${text}`
        // Embed as low-opacity text for search/extract
        outPage.drawText(text, {
          x: 6,
          y: pageH - 12,
          size: 6,
          font,
          color: rgb(0,0,0),
          opacity: 0.01,
          maxWidth: pageW - 12,
          lineHeight: 7
        })
      }else{
        warnings.push(`Page ${pageIndex+1}: OCR returned no text.`)
      }
    }
  }

  if (worker) await worker.terminate()

  const outBytes = await out.save({ useObjectStreams: true })
  return { pdfBytes: outBytes, gptText: allText.trim(), warnings }
}

export async function redactFileToArtifacts(fileBytes, mode, outputMode){
  if (outputMode === 'raster_ocr'){
    return await buildRasterOcrPdf(fileBytes, mode, { scale: 2.5 })
  }
  return await buildSearchablePdfFromText(fileBytes, mode)
}

export { RedactionMode }
