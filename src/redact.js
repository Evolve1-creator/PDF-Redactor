import { PDFDocument } from "pdf-lib";
import pdfjsLib from "./pdfWorker";
import { TEMPLATES } from "./templates";

async function renderPageToCanvas(page, maxWidth = 1400) {
  const viewport0 = page.getViewport({ scale: 1 });
  const scale = Math.min(maxWidth / viewport0.width, 3.0);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d", { alpha: false });
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas;
}

function drawRedactions(canvas, rectsNormalized) {
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  ctx.save();
  ctx.fillStyle = "#000";
  rectsNormalized.forEach(r => {
    const x = Math.round(r.x * W);
    const y = Math.round(r.y * H);
    const w = Math.round(r.w * W);
    const h = Math.round(r.h * H);
    ctx.fillRect(x, y, w, h);
  });
  ctx.restore();
}

async function canvasToPngBytes(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      try {
        const arr = await blob.arrayBuffer();
        resolve(new Uint8Array(arr));
      } catch (e) {
        reject(e);
      }
    }, "image/png");
  });
}

export async function redactPdfArrayBuffer(arrayBuffer, templateKey, options = {}) {
  const { includeImages = false, maxWidth = 1400 } = options;
  const template = TEMPLATES[templateKey];
  if (!template) throw new Error(`Unknown template: ${templateKey}`);

  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  const outPdf = await PDFDocument.create();
  const imageOutputs = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const canvas = await renderPageToCanvas(page, maxWidth);
    drawRedactions(canvas, template.rects);

    const pngBytes = await canvasToPngBytes(canvas);
    if (includeImages) {
      imageOutputs.push({ name: `page-${String(i).padStart(3, "0")}.png`, bytes: pngBytes });
    }

    const embedded = await outPdf.embedPng(pngBytes);
    const { width, height } = embedded.scale(1);
    const p = outPdf.addPage([width, height]);
    p.drawImage(embedded, { x: 0, y: 0, width, height });
  }

  const pdfBytes = await outPdf.save();
  return { pdfBytes: new Uint8Array(pdfBytes), images: imageOutputs, pageCount: pdf.numPages };
}
