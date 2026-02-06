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
  const [mode, setMode] = useState(RedactionMode.SURGERY_CENTER)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Upload one or more PDFs to preview and export a text-searchable redacted PDF.')
  const [sourceBytes, setSourceBytes] = useState(null)
  const [previewBytes, setPreviewBytes] = useState(null)
  const canvasRef = useRef(null)

  const canExport = files.length > 0 && !busy

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

  // Build preview bytes *with redaction applied* whenever file or mode changes.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!sourceBytes) return
      try{
        const out = await redactPdfBytes(sourceBytes, mode, { onlyFirstPage: true })
        if (!cancelled) setPreviewBytes(new Uint8Array(out))
      }catch(err){
        if (!cancelled) {
          setPreviewBytes(sourceBytes) // fallback to original
          setStatus(`Preview build error (showing original): ${err?.message || String(err)}`)
        }
      }
    })()
    return () => { cancelled = true }
  }, [sourceBytes, mode])

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
      const out = await redactPdfBytes(inputBytes, mode, { onlyFirstPage: true })
      const blob = new Blob([out], { type: 'application/pdf' })
      saveAs(blob, `${niceName(f.name)}__redacted.pdf`)
      setStatus(`Exported: ${niceName(f.name)}__redacted.pdf (text-searchable)`)
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
        const out = await redactPdfBytes(inputBytes, mode, { onlyFirstPage: true })
        zip.file(`${niceName(f.name)}__redacted.pdf`, out)
      }
      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, `redacted_pdfs_${new Date().toISOString().slice(0,10)}.zip`)
      setStatus(`Batch export complete: ${files.length} PDFs in a ZIP (outputs are text-searchable).`)
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
            <p className="sub">Preview + export show the same redaction. Output stays <b>text-searchable</b>.</p>
          </div>
        </div>
        <div className="row">
          <a className="btn" href="https://github.com/" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </div>

      <div className="grid">
        <div className="card">
          <h2>1) Upload PDFs</h2>
          <input className="input" type="file" accept="application/pdf" multiple onChange={onPick} />
          <div className="small" style={{marginTop:10}}>
            Preview now shows the redaction overlay (same logic as export).
          </div>

          <div className="hr" />

          <h2>2) Redaction Mode</h2>
          <div className="row">
            <button
              className={"btn " + (mode === RedactionMode.SURGERY_CENTER ? "primary" : "")}
              onClick={() => setMode(RedactionMode.SURGERY_CENTER)}
              disabled={busy}
              title="Redact top 4 cm on page 1"
            >
              Surgery Center (Top 4 cm)
            </button>
            <button
              className={"btn " + (mode === RedactionMode.NO_CHARGE ? "primary" : "")}
              onClick={() => setMode(RedactionMode.NO_CHARGE)}
              disabled={busy}
              title="Example no-charge zones (customize in src/redaction.js)"
            >
              No-Charge (Example)
            </button>
          </div>

          <div className="hr" />

          <h2>3) Export</h2>
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
                <span className="badge">{idx === 0 ? "Preview" : "Queued"}</span>
              </div>
            ))}
          </div>

          <div className="toast">
            <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
              <span className="kbd">Text-searchable</span>
              <span className="kbd">Parser-friendly export</span>
              <span className="kbd">Rotation-aware</span>
              <span className="kbd">Page 1 only</span>
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
            Preview uses the same redaction output bytes that export writes to disk.         In some environments, text parsers fail on PDFs saved with object streams/xref streams.
        This build exports with <span className="kbd">useObjectStreams: false</span> and does not add a REDACTED label,
        so your downstream “check for modifiers” text extraction should keep working.
            If your PDFs are rotated, this version still redacts the “top” area as the viewer sees it.
          </div>
        </div>
      </div>

      <div className="small" style={{marginTop:14}}>
        If you still don’t see the block: your PDF may have an uncommon rotation/crop box setup.
        In that case, tell me what kind of PDF it is (Epic? scanner? portal?) and I’ll add crop-box-aware placement.
      </div>
    </div>
  )
}
