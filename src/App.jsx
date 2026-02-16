import React, { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import { saveAs } from 'file-saver'
import { pdfjsLib } from './lib/pdfjs'
import { getRedactionRects, RedactionMode } from './lib/templates'
import { normalizePdfBytes, redactFileToArtifacts } from './lib/process'

function baseName(name){
  return (name || 'document.pdf').replace(/\.[^/.]+$/,'')
}

async function renderPreview(bytes, canvas, mode){
  const pdf = await pdfjsLib.getDocument({ data: bytes }).promise
  const page = await pdf.getPage(1)
  const scale = 1.25
  const viewport = page.getViewport({ scale })
  const ctx = canvas.getContext('2d')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  await page.render({ canvasContext: ctx, viewport }).promise

  // Compute rects in page points, then convert to canvas px
  const viewport1 = page.getViewport({ scale: 1 })
  const pageW = viewport1.width
  const pageH = viewport1.height
  const rects = getRedactionRects(mode, 0, pageW, pageH)
  const sx = scale
  const sy = scale

  ctx.save()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.strokeStyle = 'rgba(255,60,80,0.95)'
  ctx.lineWidth = 2
  for (const r of rects){
    const x = r.x * sx
    const y = (pageH - (r.y + r.h)) * sy
    const w = r.w * sx
    const h = r.h * sy
    ctx.fillRect(x, y, w, h)
    ctx.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2))
  }
  ctx.restore()
}

export default function App(){
  const [files, setFiles] = useState([])
  const [mode, setMode] = useState(RedactionMode.EPIC_HEADER_FOOTER)
  const [outputMode, setOutputMode] = useState('text_pdf') // text_pdf | raster_ocr
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('Upload Microsoft “Print to PDF” files. The app will regenerate a new redacted PDF that is readable by ChatGPT.')
  const [previewBytes, setPreviewBytes] = useState(null)
  const canvasRef = useRef(null)

  const canExport = files.length > 0 && !busy

  const onPick = async (e) => {
    const picked = Array.from(e.target.files || [])
    setFiles(picked)
    setStatus(picked.length ? `Loaded ${picked.length} file(s).` : 'No files selected.')

    // Try previewing the first file
    if (picked[0]){
      try{
        const raw = new Uint8Array(await picked[0].arrayBuffer())
        const bytes = normalizePdfBytes(raw)
        setPreviewBytes(bytes)
      }catch(err){
        setPreviewBytes(null)
        setStatus(`Loaded ${picked.length} file(s). Preview unavailable: ${err?.message || String(err)}`)
      }
    } else {
      setPreviewBytes(null)
    }
    e.target.value = ''
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!previewBytes || !canvasRef.current) return
      try{
        await renderPreview(previewBytes, canvasRef.current, mode)
      }catch(err){
        if (!cancelled) setStatus(`Preview error: ${err?.message || String(err)}`)
      }
    })()
    return () => { cancelled = true }
  }, [previewBytes, mode])

  const exportOne = async () => {
    if (!files[0]) return
    setBusy(true)
    try{
      const f = files[0]
      const raw = new Uint8Array(await f.arrayBuffer())
      const { pdfBytes, gptText, warnings } = await redactFileToArtifacts(raw, mode, outputMode)

      const zip = new JSZip()
      zip.file(`${baseName(f.name)}__redacted.pdf`, pdfBytes, { binary: true })
      if (gptText) zip.file(`${baseName(f.name)}__gpt.txt`, gptText)
      if (warnings?.length) zip.file(`${baseName(f.name)}__warnings.txt`, warnings.join('\n'))

      const blob = await zip.generateAsync({ type: 'blob' })
      saveAs(blob, `${baseName(f.name)}__redacted.zip`)
      setStatus(`Exported ${baseName(f.name)}__redacted.zip (PDF + GPT text).`)
    }catch(err){
      setStatus(`Export error: ${err?.message || String(err)}`)
    }finally{
      setBusy(false)
    }
  }

  const exportBatch = async () => {
    if (!files.length) return
    setBusy(true)
    try{
      const zip = new JSZip()
      const failures = []

      for (const f of files){
        try{
          const raw = new Uint8Array(await f.arrayBuffer())
          const { pdfBytes, gptText, warnings } = await redactFileToArtifacts(raw, mode, outputMode)
          zip.file(`${baseName(f.name)}__redacted.pdf`, pdfBytes, { binary: true })
          if (gptText) zip.file(`${baseName(f.name)}__gpt.txt`, gptText)
          if (warnings?.length) zip.file(`${baseName(f.name)}__warnings.txt`, warnings.join('\n'))
        }catch(err){
          failures.push(`${f.name}: ${err?.message || String(err)}`)
        }
      }

      if (Object.keys(zip.files).length === 0){
        throw new Error(failures[0] || 'No files exported.')
      }
      if (failures.length){
        zip.file(`__errors.txt`, failures.join('\n'))
      }

      const blob = await zip.generateAsync({ type: 'blob' })
      const name = `redacted_batch_${new Date().toISOString().slice(0,10)}.zip`
      saveAs(blob, name)
      setStatus(failures.length ? `Exported ${name} (with some errors—see __errors.txt).` : `Exported ${name}.`)
    }catch(err){
      setStatus(`Batch export error: ${err?.message || String(err)}`)
    }finally{
      setBusy(false)
    }
  }

  const clearAll = () => {
    setFiles([])
    setPreviewBytes(null)
    setStatus('Cleared.')
  }

  return (
    <div className="container">
      <div className="h1">PHI PDF Redactor (client-side)</div>
      <div className="p">
        Upload PDFs created via <span className="kbd">Microsoft Print to PDF</span>. The app regenerates a <b>new</b> redacted PDF and a GPT-readable text file.
        No uploads—processing happens in your browser.
      </div>

      <div className="grid">
        <div className="card">
          <div className="label">1) Upload</div>
          <input type="file" accept="application/pdf" multiple onChange={onPick} />
          <div className="small" style={{marginTop:8}}>{files.length ? `${files.length} file(s) selected.` : 'No files selected.'}</div>

          <hr />

          <div className="label">2) Redaction template</div>
          <div className="row">
            <select value={mode} onChange={(e)=>setMode(e.target.value)}>
              <option value={RedactionMode.EPIC_HEADER_FOOTER}>Epic Note (Page 1 top block + 1cm header/footer each page)</option>
              <option value={RedactionMode.SURGERY_TOP_BAND}>Surgery Center (4cm top band each page)</option>
            </select>
          </div>
          <div className="small" style={{marginTop:8}}>
            These rectangles come from the provided template parameters (612×300 top block on page 1; 1cm header/footer; or 4cm top band).
          </div>

          <hr />

          <div className="label">3) Output mode</div>
          <div className="row">
            <select value={outputMode} onChange={(e)=>setOutputMode(e.target.value)}>
              <option value="text_pdf">Searchable “true text” PDF (fast; best for Microsoft Print-to-PDF)</option>
              <option value="raster_ocr">Exact-look PDF (raster + OCR; slower; needs OCR assets)</option>
            </select>
          </div>
          <div className="small" style={{marginTop:8}}>
            Default uses <b>text extraction</b> and rebuilds a searchable PDF without OCR. If your PDFs are image-only, use Raster+OCR.
          </div>

          <hr />

          <div className="label">4) Export</div>
          <div className="row">
            <button className="btn primary" onClick={exportOne} disabled={!canExport}>Export First File (ZIP)</button>
            <button className="btn" onClick={exportBatch} disabled={!canExport}>Batch Export ZIP</button>
            <button className="btn danger" onClick={clearAll} disabled={busy}>Clear</button>
          </div>

          <ul className="list">
            {files.map((f, i) => (
              <li key={`${f.name}-${i}`} className="item">
                <div>
                  <div style={{fontWeight:700}}>{f.name}</div>
                  <div className="small">{(f.size/1024/1024).toFixed(2)} MB</div>
                </div>
                <div className="badge ok">Queued</div>
              </li>
            ))}
          </ul>

          <hr />
          <div className="small"><b>Status:</b> {status}</div>
        </div>

        <div className="card">
          <div className="label">Preview (Page 1)</div>
          {previewBytes ? (
            <>
              <canvas ref={canvasRef} />
              <div className="small" style={{marginTop:10}}>
                Preview shows the redaction zones (red outlines) that will be applied.
              </div>
            </>
          ) : (
            <div className="small">Upload a valid PDF to preview redaction zones.</div>
          )}

          <hr />

          <div className="small">
            <b>What you get in the ZIP:</b>
            <ul>
              <li><span className="kbd">__redacted.pdf</span> – regenerated PDF with PHI removed via template rectangles</li>
              <li><span className="kbd">__gpt.txt</span> – extracted text (useful for ChatGPT ingestion)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
