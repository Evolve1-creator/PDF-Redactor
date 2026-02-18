import * as pdfjsLib from "pdfjs-dist";

// Vite/Vercel-friendly worker wiring for pdfjs v4+
// (Avoids importing a non-existent default export from pdf.worker.mjs)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

export default pdfjsLib;
