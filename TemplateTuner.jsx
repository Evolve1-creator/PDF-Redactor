import React, { useMemo, useState } from "react";
import JSZip from "jszip";
import { saveAs } from "file-saver";
import { TEMPLATES } from "./templates";
import { redactPdfArrayBuffer } from "./redact";
import TemplateTuner from "./TemplateTuner.jsx";

function humanSize(bytes) {
  const units = ["B","KB","MB","GB"];
  let b = bytes, i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function App() {
  const [templateKey, setTemplateKey] = useState("notes");
  const [includeImages, setIncludeImages] = useState(false);
  const [files, setFiles] = useState([]);
  const [busy, setBusy] = useState(false);
  const [tunerOpen, setTunerOpen] = useState(false);
  const [log, setLog] = useState([]);

  const templateOptions = useMemo(() => Object.entries(TEMPLATES), []);
  const addLog = (msg) => setLog(l => [...l, msg]);

  const onPickFiles = (e) => {
    setFiles(Array.from(e.target.files || []));
    setLog([]);
  };

  const runBatch = async () => {
    if (!files.length) return;
    setBusy(true);
    setLog([]);
    addLog(`Starting batch: ${files.length} file(s), template: ${TEMPLATES[templateKey].name}`);

    const zip = new JSZip();
    const outFolder = zip.folder("redacted");

    for (let idx = 0; idx < files.length; idx++) {
      const f = files[idx];
      try {
        addLog(`Processing ${idx + 1}/${files.length}: ${f.name} (${humanSize(f.size)}) ...`);
        const buf = await f.arrayBuffer();
        const baseName = f.name.replace(/\.pdf$/i, "");
        const { pdfBytes, images, pageCount } = await redactPdfArrayBuffer(buf, templateKey, {
          includeImages,
          maxWidth: 1500
        });

        outFolder.file(`${baseName}.REDACTED.pdf`, pdfBytes);

        if (includeImages && images.length) {
          const imgFolder = zip.folder(`images/${baseName}`);
          images.forEach(img => imgFolder.file(img.name, img.bytes));
        }

        addLog(`✓ Done: ${f.name} (${pageCount} page(s))`);
      } catch (err) {
        console.error(err);
        addLog(`✗ Failed: ${f.name} — ${err?.message || String(err)}`);
      }
    }

    addLog("Building ZIP...");
    const zipBlob = await zip.generateAsync({ type: "blob" });
    saveAs(zipBlob, `Redacted_Batch_${TEMPLATES[templateKey].name.replace(/\s+/g,"_")}.zip`);
    addLog("✓ ZIP downloaded.");
    setBusy(false);
  };

  return (
    <div className="page">
      <header className="header">
        <div>
          <h1>Simple PDF Redactor</h1>
          <p className="sub">Frontend-only • Burns redactions into page images • Batch ZIP export • No Python needed</p>
        </div>
      </header>

      <section className="card">
        <div className="row">
          <label className="label">
            Template
            <select value={templateKey} onChange={(e) => setTemplateKey(e.target.value)} disabled={busy}>
              {templateOptions.map(([key, t]) => <option key={key} value={key}>{t.name}</option>)}
            </select>
          </label>

          <label className="check">
            <input type="checkbox" checked={includeImages} onChange={(e) => setIncludeImages(e.target.checked)} disabled={busy}/>
            Include redacted PNG pages in ZIP
          </label>
        </div>

        <div className="row">
          <input type="file" multiple accept="application/pdf" onChange={onPickFiles} disabled={busy}/>
          <button className="btn ghost" onClick={() => setTunerOpen(true)} disabled={busy || !files.length}>
            Tune Template
          </button>
          <button className="btn" onClick={runBatch} disabled={busy || !files.length}>
            {busy ? "Processing..." : "Redact + Download ZIP"}
          </button>
        </div>

        <div className="hint">
          <strong>How it works:</strong> We render each PDF page to a canvas, draw black boxes (template),
          then export a new flattened PDF. The original underlying content is not preserved in the output.
        </div>
      </section>

      <section className="card">
        <h2>Batch Log</h2>
        <div className="log">
          {log.length ? log.map((l, i) => <div key={i} className="logLine">{l}</div>) : <div className="logLine muted">No activity yet.</div>}
        </div>
      </section>

      <section className="card">
        <h2>Template tuning</h2>
        <p className="small">
          Edit <code>src/templates.js</code>. Rectangles are normalized (0..1) so they scale to page size.
        </p>
      </section>

      <TemplateTuner
        open={tunerOpen}
        onClose={() => setTunerOpen(false)}
        templateKey={templateKey}
        sampleFile={files?.[0]}
      />
    </div>
  );
}
