
import React, { useState } from 'react'
import { PDFDocument } from 'pdf-lib'
import { redactors } from './redactors'

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
  const [selectedRedactor, setSelectedRedactor] = useState("nocharge")

  async function run() {
    if (!files.length) return
    setBusy(true)
    try {

      // SINGLE FILE
      if (files.length === 1) {
        const f = files[0]
        const out = await redactors[selectedRedactor].handler(
          new Uint8Array(await f.arrayBuffer())
        )

        download(
          new Blob([out], { type: 'application/pdf' }),
          f.name.replace(/\.pdf$/i, '.REDACTED.pdf')
        )

      } else {

        // 🔥 BATCH MODE → MERGED PDF
        const mergedPdf = await PDFDocument.create()

        for (const f of files) {

          const redactedBytes = await redactors[selectedRedactor].handler(
            new Uint8Array(await f.arrayBuffer())
          )

          const redactedDoc = await PDFDocument.load(redactedBytes)
          const copiedPages = await mergedPdf.copyPages(
            redactedDoc,
            redactedDoc.getPageIndices()
          )

          copiedPages.forEach(p => mergedPdf.addPage(p))
        }

        const finalBytes = await mergedPdf.save()

        download(
          new Blob([finalBytes], { type: 'application/pdf' }),
          'Batch_Redacted.pdf'
        )
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '40px auto', fontFamily: 'system-ui' }}>
      <h2>Clinical PDF Redactor</h2>

      <label><b>Select Template:</b></label>
      <br />

      <select
        value={selectedRedactor}
        onChange={e => setSelectedRedactor(e.target.value)}
      >
        {Object.entries(redactors).map(([key, r]) => (
          <option key={key} value={key}>
            {r.label}
          </option>
        ))}
      </select>

      <br /><br />

      <input
        type="file"
        accept="application/pdf"
        multiple
        onChange={e => setFiles([...e.target.files])}
      />

      <br /><br />

      <button onClick={run} disabled={busy || !files.length}>
        {busy
          ? 'Working…'
          : files.length === 1
            ? 'Redact & Download PDF'
            : 'Batch Redact → Single PDF'}
      </button>
    </div>
  )
}
