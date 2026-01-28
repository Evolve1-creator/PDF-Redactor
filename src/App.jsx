
import React, { useMemo, useState } from 'react'
import JSZip from 'jszip'
import { applyTemplateRedactions } from './redact'

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [pdfFiles, setPdfFiles] = useState([])
  const [templateFileName, setTemplateFileName] = useState('')
  const [template, setTemplate] = useState(null)
  const [busy, setBusy] = useState(false)

  const canRun = useMemo(() => !!template && pdfFiles.length > 0 && !busy, [template, pdfFiles, busy])

  async function onPickPdfs(e) {
    const files = [...(e.target.files || [])]
    setPdfFiles(files)
  }

  async function onPickTemplate(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setTemplateFileName(f.name)
    try {
      const obj = JSON.parse(await f.text())
      setTemplate(obj)
    } catch {
      alert('Template JSON could not be parsed. Make sure it is valid JSON.')
      setTemplate(null)
    }
  }

  async function redactAndDownload() {
    setBusy(true)
    try {
      // single file -> single PDF download
      if (pdfFiles.length === 1) {
        const f = pdfFiles[0]
        const bytes = new Uint8Array(await f.arrayBuffer())
        const out = await applyTemplateRedactions(bytes, template)
        const blob = new Blob([out], { type: 'application/pdf' })
        const outName = f.name.replace(/\.pdf$/i, '.REDACTED.pdf')
        downloadBlob(blob, outName)
        return
      }

      // batch -> zip
      const zip = new JSZip()
      for (const f of pdfFiles) {
        const bytes = new Uint8Array(await f.arrayBuffer())
        const out = await applyTemplateRedactions(bytes, template)
        zip.file(f.name.replace(/\.pdf$/i, '.REDACTED.pdf'), out)
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' })
      downloadBlob(zipBlob, 'Redacted_PDFs.zip')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="wrap">
      <div className="card">
        <h1>PDF Template Redactor</h1>
        <div className="small">
          Upload one PDF (downloads one redacted PDF) or upload many PDFs (downloads a ZIP). Then upload your template JSON.
        </div>

        <label>1) Select PDF(s) to redact (you can pick multiple)</label>
        <input
          type="file"
          accept="application/pdf"
          multiple
          onChange={onPickPdfs}
        />
        <div className="list">
          <div className="small">Selected PDFs: <b>{pdfFiles.length || 0}</b></div>
          {pdfFiles.length > 0 && (
            <div className="mono" style={{ marginTop: 6, maxHeight: 120, overflow: 'auto' }}>
              {pdfFiles.map(f => <div key={f.name}>{f.name}</div>)}
            </div>
          )}
        </div>

        <label>2) Select the redaction template (JSON file)</label>
        <input
          type="file"
          accept="application/json,.json"
          onChange={onPickTemplate}
        />
        <div className="list">
          <div className="small">Template loaded: <b>{template ? 'Yes' : 'No'}</b></div>
          {templateFileName ? <div className="mono" style={{ marginTop: 6 }}>{templateFileName}</div> : null}
          {template ? (
            <div className="small" style={{ marginTop: 6 }}>
              repeatFromPage: <b>{template.repeatFromPage ?? '(none)'}</b> • page1 boxes: <b>{template.page1?.redactions?.length ?? 0}</b>
            </div>
          ) : null}
        </div>

        <button disabled={!canRun} onClick={redactAndDownload}>
          {busy ? 'Working…' : (pdfFiles.length <= 1 ? 'Redact & Download PDF' : 'Redact & Download ZIP')}
        </button>

        <div className="small" style={{ marginTop: 10 }}>
          Note: If you only select 1 PDF, it downloads a single <span className="mono">.REDACTED.pdf</span>. If you select 2+ PDFs, it downloads <span className="mono">Redacted_PDFs.zip</span>.
        </div>
      </div>
    </div>
  )
}
