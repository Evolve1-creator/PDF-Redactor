
import React, { useState } from 'react'
import { redactors } from './redactors/index.js'

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

      let nameCounts = {}

      for (const f of files) {

        const out = await redactors[selectedRedactor].handler(
          new Uint8Array(await f.arrayBuffer())
        )

        const baseName = f.name.replace(/\.pdf$/i, '')

        nameCounts[baseName] = (nameCounts[baseName] || 0) + 1

        const suffix =
          nameCounts[baseName] > 1
            ? `.REDACTED_${nameCounts[baseName]}`
            : `.REDACTED`

        const newName = `${baseName}${suffix}.pdf`

        download(
          new Blob([out], { type: 'application/pdf' }),
          newName
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
        {busy ? 'Redacting…' : 'Redact & Download Files'}
      </button>
    </div>
  )
}
