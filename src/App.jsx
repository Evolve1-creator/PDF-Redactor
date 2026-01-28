
import React, { useState } from 'react'
import JSZip from 'jszip'
import { redactPdf } from './redact'

function download(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export default function App() {
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)

  async function run() {
    if (!files.length) return
    setBusy(true)
    try {
      if (files.length === 1) {
        const f = files[0]
        const out = await redactPdf(new Uint8Array(await f.arrayBuffer()))
        download(new Blob([out], {type:'application/pdf'}), f.name.replace(/\.pdf$/i,'.REDACTED.pdf'))
        return
      }
      const zip = new JSZip()
      for (const f of files) {
        const out = await redactPdf(new Uint8Array(await f.arrayBuffer()))
        zip.file(f.name.replace(/\.pdf$/i,'.REDACTED.pdf'), out)
      }
      download(await zip.generateAsync({type:'blob'}), 'Redacted_PDFs.zip')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{maxWidth:700, margin:'40px auto', fontFamily:'system-ui'}}>
      <h2>PDF Redactor</h2>
      <p>Select one or more PDFs. The built‑in template is applied automatically.</p>
      <input type="file" accept="application/pdf" multiple onChange={e=>setFiles([...e.target.files])} />
      <br/><br/>
      <button onClick={run} disabled={busy || !files.length}>
        {busy ? 'Working…' : (files.length === 1 ? 'Redact & Download PDF' : 'Redact & Download ZIP')}
      </button>
    </div>
  )
}
