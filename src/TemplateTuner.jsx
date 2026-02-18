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

  const topPx = pxFromInches(topInches || 0, scale);
  const botPx = pxFromInches(bottomInches || 0, scale);

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

  // tuning values (inches)
  const [topFirst, setTopFirst] = useState(0.0);
  const [topOther, setTopOther] = useState(0.0);
  const [bottomAll, setBottomAll] = useState(0.0);

  const p1Ref = useRef(null);
  const p2Ref = useRef(null);

  useEffect(() => {
    if (!open || !baseTemplate) return;

    // initialize state from template
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

  useEffect(() => {
    let cancelled = false;

    async function go() {
      if (!open || !sampleFile || !baseTemplate) return;

      setLoading(true);
      setHasPage2(false);

      try {
        const buf = await sampleFile.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

        // page 1
        const p1 = await renderPageToCanvas(pdf, 1);
        if (cancelled) return;
        drawOverlayBands(p1.canvas, p1.scale, topFirst, bottomAll);
        if (p1Ref.current) {
          p1Ref.current.innerHTML = "";
          p1Ref.current.appendChild(p1.canvas);
        }

        // page 2 if exists
        if (pdf.numPages >= 2) {
          const p2 = await renderPageToCanvas(pdf, 2);
          if (cancelled) return;
          drawOverlayBands(p2.canvas, p2.scale, topOther, bottomAll);
          if (p2Ref.current) {
            p2Ref.current.innerHTML = "";
            p2Ref.current.appendChild(p2.canvas);
          }
          setHasPage2(true);
        } else {
          if (p2Ref.current) p2Ref.current.innerHTML = "";
          setHasPage2(false);
        }
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    go();
    return () => { cancelled = true; }; // keep lint simple
  }, [open, sampleFile, templateKey, topFirst, topOther, bottomAll]);

  if (!open) return null;
  if (!baseTemplate) return null;

  const isBandTemplate = baseTemplate.mode === "top_band_inches" || baseTemplate.mode === "bands_inches";

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
    // re-init from base (without override) by forcing reload
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

              <div className="small muted">Overlay preview is shown in red; actual redactions are solid black in output.</div>
            </div>

            <div className="previewGrid">
              <div className="previewCard">
                <div className="previewTitle">Preview: Page 1</div>
                <div className="previewCanvas" ref={p1Ref}>{loading ? "Loading..." : ""}</div>
              </div>

              <div className="previewCard">
                <div className="previewTitle">Preview: Page 2{hasPage2 ? "" : " (not available)"}</div>
                <div className="previewCanvas" ref={p2Ref}>{loading ? "Loading..." : (!hasPage2 ? "Upload a multi-page PDF to preview page 2." : "")}</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
