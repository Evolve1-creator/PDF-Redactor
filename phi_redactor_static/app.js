/* global JSZip, saveAs, PDFLib, pdfjsLib, Tesseract */

// ---- PDF.js worker ----
// Default to CDN worker. If self-hosting, set to './vendor/pdf.worker.min.js'
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.js'

const CM_TO_POINTS = 28.35

// Parameters from your templates (noChargeRedactor.js and surgeryCenterRedactor.js)
const NO_CHARGE_TEMPLATE = {
  page1: { redactions: [{ x: 0, yFromTop: 0, width: 612, height: 300 }] },
  repeatFromPage: 1,
  repeatRedactions: [
    { position: 'top', heightCm: 1 },
    { position: 'bottom', heightCm: 1 }
  ]
}

function getMode(){
  const v = document.querySelector('input[name="mode"]:checked')?.value
  return v || 'no_charge'
}

function setStatus(msg){
  document.getElementById('status').textContent = msg
}

function addFileItem(name, status, detail=''){
  const list = document.getElementById('fileList')
  const el = document.createElement('div')
  el.className = 'fileitem'
  el.innerHTML = `<div><div><b>${escapeHtml(name)}</b></div><div class="hint">${escapeHtml(detail)}</div></div>`
  const badge = document.createElement('div')
  badge.className = 'badge ' + (status==='ok'?'ok':'err')
  badge.textContent = status==='ok' ? 'Ready' : 'Issue'
  el.appendChild(badge)
  list.appendChild(el)
}

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
}

// --- Input normalizer: accept real PDFs, and HTML wrappers that embed base64 PDFs ---
function bytesStartWith(bytes, sig){
  if (bytes.length < sig.length) return false
  for (let i=0;i<sig.length;i++) if (bytes[i]!==sig[i]) return false
  return true
}

function isPdf(bytes){
  return bytesStartWith(bytes, [0x25,0x50,0x44,0x46,0x2d]) // %PDF-
}

function normalizePdfBytes(bytes){
  // Search for %PDF- within first 16MB
  const needle = [0x25,0x50,0x44,0x46,0x2d]
  const scanLen = Math.min(bytes.length, 16*1024*1024)
  for (let i=0;i<=scanLen-needle.length;i++){
    let ok=true
    for (let j=0;j<needle.length;j++) if (bytes[i+j]!==needle[j]) {ok=false;break}
    if (ok){
      const out = i===0?bytes:bytes.slice(i)
      return out
    }
  }
  throw new Error('Missing %PDF header')
}

function tryExtractEmbeddedPdf(wrapperBytes){
  try{
    const text = new TextDecoder('utf-8').decode(wrapperBytes)
    const m = text.match(/data:application\/pdf;base64,([A-Za-z0-9+\/_=\-]+)/)
    if (m?.[1]) return normalizePdfBytes(base64ToBytes(m[1]))
    const idx = text.indexOf('JVBERi0')
    if (idx!==-1){
      let end = idx
      while(end<text.length && /[A-Za-z0-9+\/_=\-]/.test(text[end])) end++
      const b64 = text.slice(idx,end)
      if (b64.length>1000) return normalizePdfBytes(base64ToBytes(b64))
    }
  }catch{}
  return null
}

function base64ToBytes(b64){
  const clean = b64.replace(/[\r\n\t\s]/g,'')
  const bin = atob(clean)
  const out = new Uint8Array(bin.length)
  for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i)
  return out
}

// --- Redaction rectangles in "points" (pdf.js viewport at scale=1 uses points as px) ---
function computeRects(mode, pageIndex, pageWidthPt, pageHeightPt){
  if (mode === 'surgery_center'){
    const h = 4 * CM_TO_POINTS
    return [{ x: 0, y: 0, w: pageWidthPt, h }]
  }

  // no_charge
  const rects = []

  // page 1 big block
  if (pageIndex === 0){
    for (const r of NO_CHARGE_TEMPLATE.page1.redactions){
      rects.push({
        x: r.x,
        y: r.yFromTop,
        w: Math.min(r.width, pageWidthPt),
        h: r.height
      })
    }
  }

  // header/footer 1cm bands starting from page 1
  if (pageIndex + 1 >= NO_CHARGE_TEMPLATE.repeatFromPage){
    for (const rr of NO_CHARGE_TEMPLATE.repeatRedactions){
      const hp = rr.heightCm * CM_TO_POINTS
      if (rr.position === 'top') rects.push({ x: 0, y: 0, w: pageWidthPt, h: hp })
      if (rr.position === 'bottom') rects.push({ x: 0, y: pageHeightPt - hp, w: pageWidthPt, h: hp })
    }
  }

  return rects
}

function rectIntersects(a,b){
  return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y)
}

// Extract text items, filter out items that overlap PHI rects
async function extractNonRedactedText(pdfjsPage, viewport, rects){
  const tc = await pdfjsPage.getTextContent()
  const items = tc.items || []
  const out = []

  for (const it of items){
    // Map to viewport coordinates
    const tx = pdfjsLib.Util.transform(viewport.transform, it.transform)
    const x = tx[4]
    const fontH = Math.hypot(tx[2], tx[3])
    const yTop = tx[5] - fontH
    const w = (it.width || 0) * viewport.scale
    const h = fontH

    const bbox = { x, y: yTop, w, h }

    let hit = false
    for (const r of rects){
      if (rectIntersects(bbox, r)) { hit = true; break }
    }
    if (!hit){
      const str = (it.str || '').replace(/\s+/g,' ')
      if (str.trim()) out.push({ y: yTop, x, str })
    }
  }

  // Sort for readability: top-to-bottom, left-to-right
  out.sort((a,b) => (a.y - b.y) || (a.x - b.x))

  // Group into lines based on y proximity
  const lines = []
  const threshold = 4
  for (const t of out){
    const last = lines[lines.length-1]
    if (!last || Math.abs(last.y - t.y) > threshold){
      lines.push({ y: t.y, parts: [t.str] })
    } else {
      last.parts.push(t.str)
    }
  }

  return lines.map(l => l.parts.join(' ')).join('\n').trim()
}

function drawRedactionBoxes(pdfLibPage, mode, pageW, pageH){
  const rects = computeRects(mode, 0, pageW, pageH) // uses full width; pageIndex-specific will be drawn per page in export
  // Not used here
}

function wrapText(text, maxChars){
  const words = text.split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const w of words){
    if (!line){ line = w; continue }
    if ((line.length + 1 + w.length) <= maxChars){
      line += ' ' + w
    } else {
      lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  return lines
}

async function ocrPageToText(pdfjsPage, scale, rects){
  if (!Tesseract?.recognize) throw new Error('OCR library not available.')
  const viewport = pdfjsPage.getViewport({ scale })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { alpha:false })
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await pdfjsPage.render({ canvasContext: ctx, viewport }).promise

  // Burn redactions into pixels before OCR
  ctx.fillStyle = 'black'
  for (const r of rects){
    const x = Math.max(0, Math.min(canvas.width, r.x * scale))
    const y = Math.max(0, Math.min(canvas.height, r.y * scale))
    const w = Math.max(0, Math.min(canvas.width - x, r.w * scale))
    const h = Math.max(0, Math.min(canvas.height - y, r.h * scale))
    if (w>0 && h>0) ctx.fillRect(x,y,w,h)
  }

  const { data } = await Tesseract.recognize(canvas, 'eng', { logger: ()=>{} })
  return (data?.text || '').trim()
}

async function processOneFile(file, mode, enableOcr){
  const ab = await file.arrayBuffer()
  let bytes = new Uint8Array(ab)

  // Accept PDFs, or HTML wrappers containing a base64 PDF
  let pdfBytes = null
  try{ pdfBytes = normalizePdfBytes(bytes) }catch{
    const embedded = tryExtractEmbeddedPdf(bytes)
    if (embedded) pdfBytes = embedded
  }
  if (!pdfBytes) throw new Error('This file is not a readable PDF (and no embedded PDF was found).')

  const loadingTask = pdfjsLib.getDocument({ data: pdfBytes })
  const pdf = await loadingTask.promise

  // Build new PDF as searchable text
  const outPdf = await PDFLib.PDFDocument.create()
  const font = await outPdf.embedFont(PDFLib.StandardFonts.Helvetica)

  let gptText = ''

  for (let p=1; p<=pdf.numPages; p++){
    const page = await pdf.getPage(p)
    const viewport = page.getViewport({ scale: 1.0 })
    const pageW = viewport.width
    const pageH = viewport.height

    const rects = computeRects(mode, p-1, pageW, pageH)

    // Extract text outside redaction zones
    let pageText = await extractNonRedactedText(page, viewport, rects)

    // OCR fallback if near-zero text
    if (enableOcr && (pageText.length < 25)){
      pageText = await ocrPageToText(page, 2.0, rects)
    }

    gptText += `--- Page ${p} ---\n${pageText}\n\n`

    // Create output page (same size)
    const outPage = outPdf.addPage([pageW, pageH])

    // Draw redaction boxes visually
    outPage.drawRectangle({ x:0, y: pageH - 0, width:0, height:0 })
    for (const r of rects){
      // convert from top-left y to pdf-lib bottom-left y
      const yBottom = pageH - (r.y + r.h)
      outPage.drawRectangle({ x: r.x, y: yBottom, width: r.w, height: r.h, color: PDFLib.rgb(0,0,0) })
    }

    // Write text in a readable column
    const margin = 36
    const maxWidth = pageW - margin*2
    const fontSize = 10
    const lineHeight = 12
    const maxChars = Math.floor(maxWidth / (fontSize * 0.55))
    const lines = wrapText(pageText.replace(/\n+/g,' '), maxChars)

    let y = pageH - margin
    for (const line of lines){
      y -= lineHeight
      if (y < margin) break
      outPage.drawText(line, { x: margin, y, size: fontSize, font, color: PDFLib.rgb(0,0,0) })
    }
  }

  const outBytes = await outPdf.save({ useObjectStreams:false })
  return { outBytes, gptText: gptText.trim() }
}

// ---- UI wiring ----
const fileInput = document.getElementById('fileInput')
const exportZipBtn = document.getElementById('exportZipBtn')
const clearBtn = document.getElementById('clearBtn')

let currentFiles = []

fileInput.addEventListener('change', () => {
  document.getElementById('fileList').innerHTML = ''
  currentFiles = Array.from(fileInput.files || [])
  if (!currentFiles.length){ setStatus(''); return }
  setStatus(`${currentFiles.length} file(s) queued.`)
  for (const f of currentFiles){
    addFileItem(f.name, 'ok', `${(f.size/1024/1024).toFixed(2)} MB`)
  }
})

clearBtn.addEventListener('click', () => {
  fileInput.value = ''
  currentFiles = []
  document.getElementById('fileList').innerHTML = ''
  setStatus('Cleared.')
})

exportZipBtn.addEventListener('click', async () => {
  if (!currentFiles.length){ setStatus('Choose files first.'); return }
  exportZipBtn.disabled = true
  setStatus('Processing…')

  const mode = getMode()
  const enableOcr = document.getElementById('ocrToggle').checked

  const zip = new JSZip()
  const report = []

  let okCount = 0
  for (const f of currentFiles){
    try{
      setStatus(`Processing ${f.name}…`)
      const { outBytes, gptText } = await processOneFile(f, mode, enableOcr)
      const base = f.name.replace(/\.[^.]+$/,'')
      zip.file(`${base}__redacted_searchable.pdf`, outBytes)
      zip.file(`${base}__gpt.txt`, gptText || '')
      report.push(`OK: ${f.name}`)
      okCount++
    }catch(e){
      const msg = String(e?.message || e)
      report.push(`FAIL: ${f.name} — ${msg}`)
    }
  }

  zip.file(`__batch_report.txt`, report.join('\n'))

  if (okCount === 0){
    setStatus('No files exported. See __batch_report.txt details in the ZIP (nothing to download because all failed).')
    exportZipBtn.disabled = false
    return
  }

  setStatus('Creating ZIP…')
  const blob = await zip.generateAsync({ type: 'blob' })
  saveAs(blob, `redacted_batch_${new Date().toISOString().slice(0,10)}.zip`)
  setStatus(`Done. Exported ${okCount}/${currentFiles.length}. ZIP downloaded.`)
  exportZipBtn.disabled = false
})
