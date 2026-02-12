import React, { useEffect, useRef, useState } from 'react'
import { saveAs } from 'file-saver'
import JSZip from 'jszip'
import { pdfjsLib } from './pdfjsWorker'
import { redactPdfBytes, RedactionMode } from './redaction'

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
}

export default function App(){
  const [files, setFiles] = useState([])
  const [mode, setMode] = useState(RedactionMode.NO_CHARGE)
  const [applyAllPages, setApplyAllPages] = useState(true)
  const [includeOcr, setIncludeOcr] = useState(true)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Upload one or more PDFs. Export is HIPAA burn‑in + OCR so the result stays searchable.')
  const [sourceBytes, setSourceBytes] = useState(null)
  const [previewBytes, setPreviewBytes] = useState(null)
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
      setPreviewBytes(null)
      setStatus('No PDFs selected.')
    }
    ev.target.value = ''
  }

  // Build preview bytes (FAST: burn-in redaction but NO OCR for preview)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!sourceBytes) return
      try{
        const out = await redactPdfBytes(sourceBytes, mode, { applyAllPages, includeOcr: false })
        if (!cancelled) setPreviewBytes(new Uint8Array(out))
      }catch(err){
        if (!cancelled) {
          setPreviewBytes(sourceBytes)
          setStatus(`Preview build error (showing original): ${err?.message || String(err)}`)
        }
      }
    })()
    return () => { cancelled = true }
  }, [sourceBytes, mode, applyAllPages])

  // Render preview to canvas whenever preview bytes update
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!previewBytes || !canvasRef.current) return
      try{
        await renderFirstPageToCanvas(previewBytes, canvasRef.current, 1.25)
        if (!cancelled) setStatus(prev => prev)
      }catch(err){
        if (!cancelled) setStatus(`Preview render error: ${err?.message || String(err)}`)
      }
    })()
    return () => { cancelled = true }
  }, [previewBytes])

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
      for (const f of files){
        const inputBytes = new Uint8Array(await f.arrayBuffer())
        const out = await redactPdfBytes(inputBytes, mode, { applyAllPages, includeOcr })
        zip.file(`${niceName(f.name)}__redacted.pdf`, out)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, `redacted_pdfs_${new Date().toISOString().slice(0,10)}.zip`)
      setStatus(`Batch export complete: ${files.length} PDFs in a ZIP (${includeOcr ? 'searchable (OCR)' : 'not searchable'}).`)
    } catch (err){
      setStatus(`Batch export error: ${err?.message || String(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const clearAll = () => {
    setFiles([])
    setSourceBytes(null)
    setPreviewBytes(null)
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
            <button className="btn" onClick={exportBatchZip} disabled={!canExport || files.length < 2}>
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
