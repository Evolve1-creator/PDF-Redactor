import * as pdfjsLib from "pdfjs-dist";
import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
export default pdfjsLib;
