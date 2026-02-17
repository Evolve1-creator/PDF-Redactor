This app loads PDF.js, pdf-lib, JSZip, FileSaver, and (optionally) Tesseract.js from public CDNs by default.

HIPAA note: Your PDF contents never leave the browser. Loading libraries from a CDN does not transmit PHI, but if you require a fully self-hosted build, download these files and place them in /vendor, then update the <script> tags in index.html:

- pdfjs-dist (pdf.min.js, pdf.worker.min.js)
- pdf-lib (pdf-lib.min.js)
- jszip (jszip.min.js)
- FileSaver (FileSaver.min.js)
- tesseract.js (tesseract.min.js) and its worker assets

Then point the script tags to ./vendor/<file> and set pdfjsLib.GlobalWorkerOptions.workerSrc accordingly.
