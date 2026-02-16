import React, { useEffect, useRef, useState } from 'react'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import { pdfjsLib } from './pdfjsWorker'
import { redactPdfBytesWithText, convertAnyToArtifacts, RedactionMode, computeRedactionRects, normalizePdfBytes } from './redaction'

function niceName(name){
  return (name || 'document.pdf').replace(/\.pdf$/i,'')
}

async function renderFirstPageToCanvas(bytes, canvas, scale = 1.25){
  const loadingTask = pdfjsLib.getDocument({ data: bytes })
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  await page.render({ canvasContext: ctx, viewport }).promise
  // PDF.js page.view is in PDF points: [xMin, yMin, xMax, yMax]
  const [x0, y0, x1, y1] = page.view
  const pageSizePt = { width: x1 - x0, height: y1 - y0 }
  return { pageSizePt, canvasW: canvas.width, canvasH: canvas.height }
}

function drawPreviewRects(ctx, rects){
  ctx.save()
  // Semi-transparent fill so users can confirm we’re hitting the right zones.
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.strokeStyle = 'rgba(255,60,80,0.90)'
  ctx.lineWidth = 2
  for (const r of rects){
    ctx.fillRect(r.x, r.y, r.w, r.h)
    ctx.strokeRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2))
  }
  ctx.restore()
}

async function preflightAny(file){
  // Quick sniff of bytes so we can accept "not real PDFs" and still export a GPT-readable artifact.
  const SLICE = 2 * 1024 * 1024
  const head = new Uint8Array(await file.slice(0, SLICE).arrayBuffer())
  // We'll mark as ok if it's a real PDF OR it looks like an image OR it looks like HTML/text wrapper.
  // Full conversion happens during export.
  try{
    normalizePdfBytes(head)
    return { ok: true, note: 'pdf', err: '' }
  }catch(e){
    const msg = e?.message || String(e)
    const ascii = String.fromCharCode(...head.slice(0, Math.min(48, head.length))).toLowerCase()
    const isHtml = ascii.includes('<html') || ascii.includes('<!doctype') || ascii.includes('<head')
    const isPng = head.length >= 8 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
    const isJpg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
    if (isPng || isJpg) return { ok: true, note: isPng ? 'png' : 'jpeg', err: '' }
    if (isHtml) return { ok: true, note: 'html-wrapper', err: '' }
    // Still allow as "text-ish" so we can export a best-effort scrubbed TXT.
    return { ok: true, note: 'text', err: msg }
  }
}

export default function App(){
  const [fileItems, setFileItems] = useState([]) // { file, ok, err }
  const [mode, setMode] = useState(RedactionMode.NO_CHARGE)
  const [applyAllPages, setApplyAllPages] = useState(true)
  const [includeOcr, setIncludeOcr] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Upload one or more PDFs. Export is HIPAA burn‑in + OCR so the result stays searchable.')
  const [sourceBytes, setSourceBytes] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const canvasRef = useRef(null)

  const validItems = fileItems.filter(x => x.ok)
  const hasValid = validItems.length > 0
  const canExport = hasValid && !busy

  // Keep sane defaults when switching modes
  useEffect(() => {
    if (mode === RedactionMode.NO_CHARGE){
      setApplyAllPages(true)     // header+footer on every page
      setIncludeOcr(true)        // needed for ChatGPT-readable output
    }
    if (mode === RedactionMode.SURGERY_CENTER){
      setApplyAllPages(false)    // classic “page 1 only” behavior
      setIncludeOcr(true)
    }
  }, [mode])

  const onPick = async (ev) => {
    const picked = Array.from(ev.target.files || [])
    if (!picked.length){
      setFileItems([])
      setSourceBytes(null)
      setStatus('No files selected.')
      ev.target.value = ''
      return
    }

    // Preflight each file so we can:
    // 1) avoid relying on filename extensions
    // 2) give clear feedback (HTML masquerading as PDF, missing %PDF-, etc.)
    const items = []
    for (const f of picked){
      const pf = await preflightAny(f)
      items.push({ file: f, ok: pf.ok, note: pf.note, err: pf.err })
    }
    setFileItems(items)

    // Preview only works for true PDFs (we render page 1 via PDF.js). If the first upload isn't a PDF,
    // we still allow export, but we skip preview.
    const firstPdf = items.find(x => x.note === 'pdf')
    if (firstPdf){
      try{
        const raw = new Uint8Array(await firstPdf.file.arrayBuffer())
        const bytes = normalizePdfBytes(raw, { maxScanBytes: Math.min(raw.length, 16 * 1024 * 1024) })
        setSourceBytes(bytes)
        const noteCounts = items.reduce((acc,it)=>{acc[it.note]= (acc[it.note]||0)+1; return acc}, {})
        setStatus(`Loaded ${items.length} file(s). Previewing: ${firstPdf.file.name}. Types: ${Object.entries(noteCounts).map(([k,v])=>`${k}:${v}`).join(', ')}`)
      } catch (err){
        setSourceBytes(null)
        setStatus(`Preview skipped (could not render ${firstPdf.file.name}). You can still export: ${err?.message || String(err)}`)
      }
    } else {
      setSourceBytes(null)
      const noteCounts = items.reduce((acc,it)=>{acc[it.note]= (acc[it.note]||0)+1; return acc}, {})
      setStatus(`Loaded ${items.length} file(s). No preview available (no true PDFs detected). You can still export. Types: ${Object.entries(noteCounts).map(([k,v])=>`${k}:${v}`).join(', ')}`)
    }
    ev.target.value = ''
  }

  // FAST preview: render the original page 1, then draw the *same* redaction zones
  // on top (no OCR, no PDF rebuild). This avoids long waits and makes the preview reliable.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!sourceBytes || !canvasRef.current) return
      setPreviewBusy(true)
      try{
        const { pageSizePt, canvasW, canvasH } = await renderFirstPageToCanvas(sourceBytes, canvasRef.current, 1.25)
        const ctx = canvasRef.current.getContext('2d')
        const rects = computeRedactionRects(mode, 0, canvasW, canvasH, pageSizePt, {
          applyAllPages,
          surgeryTopCm: 4,
          alsoRedactFooter: true,
        })
        drawPreviewRects(ctx, rects)
      }catch(err){
        if (!cancelled) setStatus(`Preview error: ${err?.message || String(err)}`)
      }finally{
        if (!cancelled) setPreviewBusy(false)
      }
    })()
    return () => { cancelled = true }
  }, [sourceBytes, mode, applyAllPages])

  const exportSingle = async () => {
    const first = validItems[0]
    if (!first) return
    setBusy(true)
    try{
      const f = first.file
      const inputBytes = new Uint8Array(await f.arrayBuffer())
      const art = await convertAnyToArtifacts(inputBytes, mode, { applyAllPages, includeOcr })

      // If we have both PDF and text, download a small ZIP so nothing is lost.
      if (art.pdfBytes && art.gptText){
        const zip = new JSZip()
        zip.file(`${niceName(f.name)}__redacted.pdf`, art.pdfBytes, { binary: true })
        zip.file(`${niceName(f.name)}__gpt.txt`, art.gptText)
        if (art.warnings?.length) zip.file(`${niceName(f.name)}__warnings.txt`, art.warnings.join('\n'))
        const blob = await zip.generateAsync({ type: 'blob' })
        saveAs(blob, `${niceName(f.name)}__redacted_and_text.zip`)
        setStatus(`Exported ZIP: ${niceName(f.name)}__redacted_and_text.zip (includes searchable PDF + GPT text)`)
      } else if (art.pdfBytes){
        const blob = new Blob([art.pdfBytes], { type: 'application/pdf' })
        saveAs(blob, `${niceName(f.name)}__redacted.pdf`)
        setStatus(`Exported: ${niceName(f.name)}__redacted.pdf (${includeOcr ? 'searchable (OCR)' : 'not searchable'})`)
      } else if (art.gptText){
        const blob = new Blob([art.gptText], { type: 'text/plain;charset=utf-8' })
        saveAs(blob, `${niceName(f.name)}__gpt.txt`)
        setStatus(`Exported: ${niceName(f.name)}__gpt.txt (best-effort text output)`)
      } else {
        throw new Error('Nothing exportable was produced for this file.')
      }
    } catch (err){
      setStatus(`Export error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const exportBatchZip = async () => {
    if (!hasValid) return
    setBusy(true)
    try{
      const zip = new JSZip()
      const failures = []

      for (const it of validItems){
        const f = it.file
        try{
          const inputBytes = new Uint8Array(await f.arrayBuffer())
          const art = await convertAnyToArtifacts(inputBytes, mode, { applyAllPages, includeOcr })
          if (art.pdfBytes) zip.file(`${niceName(f.name)}__redacted.pdf`, art.pdfBytes, { binary: true })
          if (art.gptText) zip.file(`${niceName(f.name)}__gpt.txt`, art.gptText)
          if (art.warnings?.length) zip.file(`${niceName(f.name)}__warnings.txt`, art.warnings.join('\n'))
          if (!art.pdfBytes && !art.gptText){
            failures.push({ name: f.name, msg: 'No exportable artifact produced.' })
          }
        } catch (err){
          failures.push({ name: f.name, msg: err?.message || String(err) })
        }
      }

      if (Object.keys(zip.files).length === 0){
        const first = failures[0]
        throw new Error(first ? `No files exported. Example error for ${first.name}: ${first.msg}` : 'No files exported.')
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, `redacted_pdfs_${new Date().toISOString().slice(0,10)}.zip`)

      if (failures.length){
        const shown = failures.slice(0, 3).map(f => `${f.name}: ${f.msg}`).join(' | ')
        setStatus(`Batch export complete: created ${Object.keys(zip.files).length} artifact(s) in the ZIP. ${failures.length} file(s) had issues: ${shown}${failures.length > 3 ? ' …' : ''}`)
      } else {
        setStatus(`Batch export complete: ${Object.keys(zip.files).length} artifact(s) in the ZIP.`)
      }
    } catch (err){
      setStatus(`Batch export error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const clearAll = () => {
    setFileItems([])
    setSourceBytes(null)
    setStatus('Cleared. Upload PDFs to begin.')
  }

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo" />
          <div>
            <p className="h1">PDF Redactor</p>
            <p className="sub">Exports are <b>HIPAA burn‑in</b> + optional <b>OCR</b> so the output stays searchable.</p>
          </div>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>1) Upload files</h2>
          <input
            className="input"
            type="file"
            // Accept true PDFs, image-only PDFs, and common image formats.
            // Also allow text/HTML wrappers so we can export a GPT-readable TXT fallback.
            accept="application/pdf,.pdf,image/*,text/plain,text/html,.htm,.html"
            multiple
            onChange={onPick}
          />
          <div className="small" style={{marginTop:10}}>
            Preview shows the same burn‑in redaction zones (preview skips OCR to stay fast).
          </div>

          <div className="hr" />

          <h2>2) Redaction Mode</h2>
          <div className="row">
            <button
              className={'btn ' + (mode === RedactionMode.NO_CHARGE ? 'primary' : '')}
              onClick={() => setMode(RedactionMode.NO_CHARGE)}
              disabled={busy}
              title="Matches the red boxes in your sample Epic note: Page 1 large header + all pages header/footer"
            >
              Epic Note (Header/Footer)
            </button>
            <button
              className={'btn ' + (mode === RedactionMode.SURGERY_CENTER ? 'primary' : '')}
              onClick={() => setMode(RedactionMode.SURGERY_CENTER)}
              disabled={busy}
              title="Top 4 cm band (defaults to page 1 only)."
            >
              Surgery Center (Top Band)
            </button>
          </div>

          <div className="hr" />

          <h2>3) Options</h2>
          <div className="row" style={{alignItems:'center', gap:12, flexWrap:'wrap'}}>
            <label className="small" style={{display:'flex', alignItems:'center', gap:8}}>
              <input
                type="checkbox"
                checked={applyAllPages}
                onChange={(e) => setApplyAllPages(e.target.checked)}
                disabled={busy}
              />
              Apply to all pages
            </label>
            <label className="small" style={{display:'flex', alignItems:'center', gap:8}}>
              <input
                type="checkbox"
                checked={includeOcr}
                onChange={(e) => setIncludeOcr(e.target.checked)}
                disabled={busy}
              />
              Make searchable (OCR)
            </label>
          </div>
          <div className="small" style={{marginTop:8}}>
            For ChatGPT/searchability, keep <span className="kbd">Make searchable (OCR)</span> ON.
          </div>

          <div className="hr" />

          <h2>4) Export</h2>
          <div className="row">
            <button className="btn primary" onClick={exportSingle} disabled={!canExport}>
              Export First Valid PDF
            </button>
            <button className="btn" onClick={exportBatchZip} disabled={!canExport}>
              Batch Export ZIP
            </button>
            <button className="btn danger" onClick={clearAll} disabled={busy}>
              Clear
            </button>
          </div>

          <div className="fileList">
            {fileItems.map((it, idx) => {
              const badge = idx === 0 && it.ok ? 'Preview' : (it.ok ? 'Queued' : 'Invalid')
              return (
                <div className="fileItem" key={idx}>
                  <div style={{display:'flex', flexDirection:'column', gap:2}}>
                    <div style={{fontWeight:700, fontSize:13}}>{it.file.name}</div>
                    <div className="small">{(it.file.size/1024/1024).toFixed(2)} MB{it.ok ? '' : ` • ${it.err}`}</div>
                  </div>
                  <span className={'badge ' + (it.ok ? '' : 'danger')}>{badge}</span>
                </div>
              )
            })}
          </div>

          <div className="toast">
            <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
              <span className="kbd">HIPAA burn‑in</span>
              <span className="kbd">Client-side</span>
              <span className="kbd">OCR for search</span>
              <span className="kbd">{applyAllPages ? 'All pages' : 'Page 1 only'}</span>
            </div>
            <div style={{marginTop:8}}>{status}</div>
          </div>
        </div>

        <div className="card">
          <h2>Preview (Page 1)</h2>
          {previewBusy && (
            <div className="small" style={{marginBottom:10}}>
              Rendering preview…
            </div>
          )}
          <div className="canvasWrap">
            <canvas ref={canvasRef} />
          </div>
          <div className="small" style={{marginTop:10}}>
            This build rebuilds PDFs from redacted pixels (true redaction), then optionally adds OCR text so the output is searchable.
            OCR language data should be hosted from <span className="kbd">/public/tessdata</span> for fully client-side operation.
          </div>
        </div>
      </div>
    </div>
  )
}
