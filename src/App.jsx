import React, { useEffect, useRef, useState } from 'react'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import { pdfjsLib } from './pdfjsWorker'
import { redactPdfBytes, RedactionMode, computeRedactionRects } from './redaction'

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

export default function App(){
  const [files, setFiles] = useState([])
  const [mode, setMode] = useState(RedactionMode.NO_CHARGE)
  const [applyAllPages, setApplyAllPages] = useState(true)
  const [includeOcr, setIncludeOcr] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Upload one or more PDFs. Export is HIPAA burn‑in + OCR so the result stays searchable.')
  const [sourceBytes, setSourceBytes] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const canvasRef = useRef(null)

  const canExport = files.length > 0 && !busy

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
    const picked = Array.from(ev.target.files || []).filter(f => /\.pdf$/i.test(f.name))
    setFiles(picked)

    if (picked[0]){
      const bytes = new Uint8Array(await picked[0].arrayBuffer())
      setSourceBytes(bytes)
      setStatus(`Loaded ${picked.length} file(s). Previewing: ${picked[0].name}`)
    } else {
      setSourceBytes(null)
      setStatus('No PDFs selected.')
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
    if (!files[0]) return
    setBusy(true)
    try{
      const f = files[0]
      const inputBytes = new Uint8Array(await f.arrayBuffer())
      const out = await redactPdfBytes(inputBytes, mode, { applyAllPages, includeOcr })
      const blob = new Blob([out], { type: 'application/pdf' })
      saveAs(blob, `${niceName(f.name)}__redacted.pdf`)
      setStatus(`Exported: ${niceName(f.name)}__redacted.pdf (${includeOcr ? 'searchable (OCR)' : 'not searchable'})`)
    } catch (err){
      setStatus(`Export error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const exportBatchZip = async () => {
    if (files.length === 0) return
    setBusy(true)
    try{
      const zip = new JSZip()
      const failures = []
      for (const f of files){
        try{
          const inputBytes = new Uint8Array(await f.arrayBuffer())
          const out = await redactPdfBytes(inputBytes, mode, { applyAllPages, includeOcr })
          zip.file(`${niceName(f.name)}__redacted.pdf`, out)
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
        setStatus(`Batch export complete: ${Object.keys(zip.files).length}/${files.length} PDFs exported (${includeOcr ? 'searchable (OCR)' : 'not searchable'}). Skipped ${failures.length} file(s): ${shown}${failures.length > 3 ? ' …' : ''}`)
      } else {
        setStatus(`Batch export complete: ${files.length} PDFs in a ZIP (${includeOcr ? 'searchable (OCR)' : 'not searchable'}).`)
      }
    } catch (err){
      setStatus(`Batch export error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const clearAll = () => {
    setFiles([])
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
          <h2>1) Upload PDFs</h2>
          <input className="input" type="file" accept="application/pdf" multiple onChange={onPick} />
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
              Export First File
            </button>
            <button className="btn" onClick={exportBatchZip} disabled={!canExport || files.length < 1}>
              Batch Export ZIP
            </button>
            <button className="btn danger" onClick={clearAll} disabled={busy}>
              Clear
            </button>
          </div>

          <div className="fileList">
            {files.map((f, idx) => (
              <div className="fileItem" key={idx}>
                <div style={{display:'flex', flexDirection:'column', gap:2}}>
                  <div style={{fontWeight:700, fontSize:13}}>{f.name}</div>
                  <div className="small">{(f.size/1024/1024).toFixed(2)} MB</div>
                </div>
                <span className="badge">{idx === 0 ? 'Preview' : 'Queued'}</span>
              </div>
            ))}
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
