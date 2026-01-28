
import React, { useState } from 'react'
import JSZip from 'jszip'
import { applyTemplateRedactions } from './redact'

export default function App() {
  const [files, setFiles] = useState([])
  const [template, setTemplate] = useState(null)

  async function loadTemplate(file) {
    setTemplate(JSON.parse(await file.text()))
  }

  async function redactAll() {
    if (!template || files.length === 0) return
    const zip = new JSZip()

    for (const f of files) {
      const bytes = new Uint8Array(await f.arrayBuffer())
      const out = await applyTemplateRedactions(bytes, template)
      zip.file(f.name.replace(/\.pdf$/i, '.REDACTED.pdf'), out)
    }

    const blob = await zip.generateAsync({ type: 'blob' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'Redacted_PDFs.zip'
    a.click()
  }

  return (
    <div style={{ padding: 24 }}>
      <h2>PDF Template Redactor</h2>
      <input type="file" multiple accept="application/pdf"
        onChange={e => setFiles([...e.target.files])} />
      <br/><br/>
      <input type="file" accept="application/json"
        onChange={e => loadTemplate(e.target.files[0])} />
      <br/><br/>
      <button onClick={redactAll}>Redact & Download ZIP</button>
    </div>
  )
}
