import React, { useEffect, useMemo, useRef, useState } from "react";
import pdfjsLib from "./pdfWorker";
import { TEMPLATES } from "./templates";
import { loadTemplateOverride, saveTemplateOverride, clearTemplateOverride } from "./templateOverrides";
import { pxFromInches } from "./inchUtils";

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function mergeTemplate(templateKey) {
  const base = TEMPLATES[templateKey];
  const ov = loadTemplateOverride(templateKey);
  if (!ov) return base;
  if (base.mode === "top_band_inches") return { ...base, topBandInches: { ...base.topBandInches, ...ov.topBandInches } };
  if (base.mode === "bands_inches") return { ...base, bandsInches: { ...base.bandsInches, ...ov.bandsInches } };
  return base;
}

async function renderPageToCanvas(pdf, pageNum, maxWidth = 900) {
  const page = await pdf.getPage(pageNum);
  const viewport0 = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / viewport0.width, 3.0);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, scale };
}

function drawOverlayBands(canvas, scale, topInches, bottomInches) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width;
  const H = canvas.height;

  const topPx = pxFromInches(Number(topInches || 0), scale);
  const botPx = pxFromInches(Number(bottomInches || 0), scale);

  ctx.save();
  ctx.fillStyle = "rgba(255, 70, 70, 0.35)";
  if (topPx > 0) ctx.fillRect(0, 0, W, topPx);
  if (botPx > 0) ctx.fillRect(0, Math.max(0, H - botPx), W, botPx);
  ctx.restore();
}

export default function TemplateTuner({ open, onClose, templateKey, sampleFile }) {
  const baseTemplate = useMemo(() => (templateKey ? mergeTemplate(templateKey) : null), [templateKey, open]);
  const [loading, setLoading] = useState(false);
  const [hasPage2, setHasPage2] = useState(false);
  const [status, setStatus] = useState("");
  const [errMsg, setErrMsg] = useState("");

  // tuning values (inches)
  const [topFirst, setTopFirst] = useState(0.0);
  const [topOther, setTopOther] = useState(0.0);
  const [bottomAll, setBottomAll] = useState(0.0);

  const p1Ref = useRef(null);
  const p2Ref = useRef(null);

  const isBandTemplate = baseTemplate?.mode === "top_band_inches" || baseTemplate?.mode === "bands_inches";

  // initialize state from template
  useEffect(() => {
    if (!open || !baseTemplate) return;

    setErrMsg("");
    setStatus("");
    if (baseTemplate.mode === "top_band_inches") {
      setTopFirst(baseTemplate.topBandInches.firstPage ?? 0);
      setTopOther(baseTemplate.topBandInches.otherPages ?? 0);
      setBottomAll(0);
    } else if (baseTemplate.mode === "bands_inches") {
      setTopFirst(baseTemplate.bandsInches.topFirstPage ?? 0);
      setTopOther(baseTemplate.bandsInches.topOtherPages ?? 0);
      setBottomAll(baseTemplate.bandsInches.bottomAllPages ?? 0);
    } else {
      setTopFirst(0); setTopOther(0); setBottomAll(0);
    }
  }, [open, templateKey]);

  // render preview with debounce (so sliders don't spam renders)
  useEffect(() => {
    let cancelled = false;
    let t = null;

    async function go() {
      if (!open) return;
      if (!sampleFile) {
        setStatus("Upload at least 1 PDF to preview.");
        return;
      }
      if (!baseTemplate) return;

      setLoading(true);
      setErrMsg("");
      setStatus("Rendering preview...");
      setHasPage2(false);

      try {
        const buf = await sampleFile.arrayBuffer();

        // pdf.js is happiest with Uint8Array
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

        // page 1
        const p1 = await renderPageToCanvas(pdf, 1);
        if (cancelled) return;
        if (isBandTemplate) drawOverlayBands(p1.canvas, p1.scale, topFirst, baseTemplate.mode === "bands_inches" ? bottomAll : 0);
        if (p1Ref.current) {
          p1Ref.current.innerHTML = "";
          p1Ref.current.appendChild(p1.canvas);
        }

        // page 2
        if (pdf.numPages >= 2) {
          const p2 = await renderPageToCanvas(pdf, 2);
          if (cancelled) return;
          if (isBandTemplate) drawOverlayBands(p2.canvas, p2.scale, topOther, baseTemplate.mode === "bands_inches" ? bottomAll : 0);
          if (p2Ref.current) {
            p2Ref.current.innerHTML = "";
            p2Ref.current.appendChild(p2.canvas);
          }
          setHasPage2(true);
        } else {
          if (p2Ref.current) p2Ref.current.innerHTML = "";
          setHasPage2(false);
        }

        setStatus("Preview ready.");
      } catch (e) {
        console.error(e);
        setErrMsg(e?.message || String(e));
        setStatus("Preview failed.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    t = setTimeout(go, 250);
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
    };
  }, [open, sampleFile, templateKey, topFirst, topOther, bottomAll, baseTemplate?.mode]);

  if (!open) return null;
  if (!baseTemplate) return null;

  const onSave = () => {
    if (!isBandTemplate) return;

    if (baseTemplate.mode === "top_band_inches") {
      saveTemplateOverride(templateKey, {
        topBandInches: {
          firstPage: clamp(Number(topFirst), 0, 10),
          otherPages: clamp(Number(topOther), 0, 10)
        }
      });
    } else {
      saveTemplateOverride(templateKey, {
        bandsInches: {
          topFirstPage: clamp(Number(topFirst), 0, 10),
          topOtherPages: clamp(Number(topOther), 0, 10),
          bottomAllPages: clamp(Number(bottomAll), 0, 10)
        }
      });
    }
    onClose?.();
  };

  const onReset = () => {
    clearTemplateOverride(templateKey);
    const base = TEMPLATES[templateKey];
    if (base.mode === "top_band_inches") {
      setTopFirst(base.topBandInches.firstPage ?? 0);
      setTopOther(base.topBandInches.otherPages ?? 0);
      setBottomAll(0);
    } else if (base.mode === "bands_inches") {
      setTopFirst(base.bandsInches.topFirstPage ?? 0);
      setTopOther(base.bandsInches.topOtherPages ?? 0);
      setBottomAll(base.bandsInches.bottomAllPages ?? 0);
    }
    setErrMsg("");
    setStatus("Reset to defaults.");
  };

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <div className="modalHeader">
          <div>
            <div className="modalTitle">Tune Template: {baseTemplate.name}</div>
            <div className="modalSub">Adjust inches once → applies to every file in your batch.</div>
          </div>
          <button className="iconBtn" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {!isBandTemplate ? (
          <div className="modalBody">
            <div className="warn">This tuner currently supports inch-based band templates only.</div>
          </div>
        ) : (
          <div className="modalBody">
            <div className="controls">
              <div className="controlRow">
                <label>
                  Page 1 top redaction (inches)
                  <input type="number" step="0.05" min="0" max="10" value={topFirst} onChange={(e) => setTopFirst(e.target.value)} />
                </label>
                <input type="range" min="0" max="6" step="0.05" value={topFirst} onChange={(e) => setTopFirst(e.target.value)} />
              </div>

              <div className="controlRow">
                <label>
                  Page 2+ top redaction (inches)
                  <input type="number" step="0.05" min="0" max="10" value={topOther} onChange={(e) => setTopOther(e.target.value)} />
                </label>
                <input type="range" min="0" max="3" step="0.05" value={topOther} onChange={(e) => setTopOther(e.target.value)} />
              </div>

              {baseTemplate.mode === "bands_inches" && (
                <div className="controlRow">
                  <label>
                    All pages bottom redaction (inches)
                    <input type="number" step="0.05" min="0" max="10" value={bottomAll} onChange={(e) => setBottomAll(e.target.value)} />
                  </label>
                  <input type="range" min="0" max="3" step="0.05" value={bottomAll} onChange={(e) => setBottomAll(e.target.value)} />
                </div>
              )}

              <div className="btnRow">
                <button className="btn" onClick={onSave} disabled={loading}>Save</button>
                <button className="btn ghost" onClick={onReset} disabled={loading}>Reset to defaults</button>
              </div>

              <div className="small muted">
                Overlay preview is shown in red; actual redactions are solid black in output.
                {status ? <span className="status"> {loading ? "Loading…" : status}</span> : null}
              </div>

              {errMsg ? (
                <div className="errorBox">
                  <div className="errorTitle">Preview error</div>
                  <div className="errorText">{errMsg}</div>
                  <div className="errorHint">Tip: if this PDF is password-protected or unusual, try a different sample file.</div>
                </div>
              ) : null}
            </div>

            <div className="previewGrid">
              <div className="previewCard">
                <div className="previewTitle">Preview: Page 1</div>
                <div className="previewCanvas" ref={p1Ref}>
                  {!loading && !errMsg ? "Rendering..." : ""}
                </div>
              </div>

              <div className="previewCard">
                <div className="previewTitle">Preview: Page 2{hasPage2 ? "" : " (not available)"}</div>
                <div className="previewCanvas" ref={p2Ref}>
                  {!loading && !errMsg ? (hasPage2 ? "Rendering..." : "Upload a multi-page PDF to preview page 2.") : ""}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
