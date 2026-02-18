import React, { useState } from "react";

const API = "http://localhost:8000";

export default function App() {
  const [template, setTemplate] = useState("notes");
  const [searchable, setSearchable] = useState(true);
  const [exportImages, setExportImages] = useState(false);
  const [files, setFiles] = useState([]);
  const [batchId, setBatchId] = useState(null);
  const [status, setStatus] = useState("");

  const onUpload = async () => {
    setStatus("Uploading + processing (OCR can take time on big PDFs)...");
    setBatchId(null);

    const fd = new FormData();
    fd.append("template", template);
    fd.append("searchable", String(searchable));
    fd.append("export_images", String(exportImages));
    for (const f of files) fd.append("files", f);

    const res = await fetch(`${API}/api/batch`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      setStatus(`Error: ${data.detail || "Upload failed"}`);
      return;
    }

    setBatchId(data.batch_id);
    setStatus(`Done. Processed ${data.count} PDF(s). Download the ZIP below.`);
  };

  const downloadZip = () => {
    window.open(`${API}/api/batch/${batchId}/download`, "_blank");
  };

  return (
    <div style={{ fontFamily: "Arial", padding: 24, maxWidth: 980, margin: "0 auto" }}>
      <h2>PHI Redaction App (Version A3)</h2>

      <div style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <label>
          Template:&nbsp;
          <select value={template} onChange={(e) => setTemplate(e.target.value)}>
            <option value="notes">Notes</option>
            <option value="surgery_center">Surgery Center</option>
          </select>
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={searchable}
            onChange={(e) => setSearchable(e.target.checked)}
          />
          Make output searchable (OCR)
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="checkbox"
            checked={exportImages}
            onChange={(e) => setExportImages(e.target.checked)}
          />
          Include redacted page images in ZIP
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <input
          type="file"
          multiple
          accept="application/pdf"
          onChange={(e) => setFiles(Array.from(e.target.files || []))}
        />
      </div>

      <button style={{ marginTop: 16 }} onClick={onUpload} disabled={!files.length}>
        Upload + Redact
      </button>

      <div style={{ marginTop: 16 }}>{status}</div>

      {batchId && (
        <button style={{ marginTop: 12 }} onClick={downloadZip}>
          Download ZIP
        </button>
      )}

      <div style={{ marginTop: 20, fontSize: 13, lineHeight: 1.4 }}>
        <strong>Tip:</strong> If your output is not redacting the right spots yet, we tune
        <code> backend/templates.py </code>. A3 also includes per-file JSON reports in the ZIP
        so you can see how many redaction boxes were applied per page.
      </div>
    </div>
  );
}
