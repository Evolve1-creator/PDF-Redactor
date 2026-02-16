import * as pdfjs from 'pdfjs-dist'

// Configure PDF.js worker for Vite.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export const pdfjsLib = pdfjs
