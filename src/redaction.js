import { PDFDocument, rgb } from 'pdf-lib'

/**
 * Goal: Keep output PDF text-extractable for downstream parsing.
 *
 * Key change:
 * - We save with `useObjectStreams: false` (max compatibility). Some parsers can fail to
 *   extract text from PDFs that use object streams / xref streams, and will only "see"
 *   newly-added simple text (like a REDACTED label). Disabling object streams typically
 *   restores compatibility.
 *
 * We also default `label: false` to avoid polluting extracted text with a big "REDACTED"
 * token that can dominate simplistic parsers.
 *
 * NOTE: This is overlay-style redaction (does not remove underlying content streams).
 */

export const RedactionMode = {
  NO_CHARGE: 'no_charge',
  SURGERY_CENTER: 'surgery_center'
}

const cmToPt = (cm) => cm * 28.346456692913385

function getRotationAngle(page){
  try {
    const r = page.getRotation?.()
    const angle = (r?.angle ?? 0) % 360
    return (angle + 360) % 360
  } catch {
    return 0
  }
}

function drawViewerTopBand(page, bandHeightPt, color){
  const { width, height } = page.getSize()
  const angle = getRotationAngle(page)

  if (angle === 0){
    page.drawRectangle({ x: 0, y: height - bandHeightPt, width, height: bandHeightPt, color })
    return
  }
  if (angle === 180){
    page.drawRectangle({ x: 0, y: 0, width, height: bandHeightPt, color })
    return
  }
  if (angle === 90){
    page.drawRectangle({ x: width - bandHeightPt, y: 0, width: bandHeightPt, height, color })
    return
  }
  if (angle === 270){
    page.drawRectangle({ x: 0, y: 0, width: bandHeightPt, height, color })
    return
  }

  page.drawRectangle({ x: 0, y: height - bandHeightPt, width, height: bandHeightPt, color })
}

function drawViewerTopLeftBlock(page, headerBandPt, blockWidthPt, blockHeightPt, color){
  const { width, height } = page.getSize()
  const angle = getRotationAngle(page)

  if (angle === 0){
    page.drawRectangle({ x: 0, y: height - headerBandPt - blockHeightPt, width: blockWidthPt, height: blockHeightPt, color })
    return
  }
  if (angle === 180){
    page.drawRectangle({ x: width - blockWidthPt, y: headerBandPt, width: blockWidthPt, height: blockHeightPt, color })
    return
  }
  if (angle === 90){
    page.drawRectangle({ x: width - headerBandPt - blockHeightPt, y: height - blockWidthPt, width: blockHeightPt, height: blockWidthPt, color })
    return
  }
  if (angle === 270){
    page.drawRectangle({ x: headerBandPt, y: 0, width: blockHeightPt, height: blockWidthPt, color })
    return
  }

  page.drawRectangle({ x: 0, y: height - headerBandPt - blockHeightPt, width: blockWidthPt, height: blockHeightPt, color })
}

export async function redactPdfBytes(inputBytes, mode, opts = {}) {
  const pdfDoc = await PDFDocument.load(inputBytes, { updateMetadata: false })
  const pages = pdfDoc.getPages()

  const cfg = {
    onlyFirstPage: true,
    surgeryTopCm: 4,
    fill: rgb(0, 0, 0),
    // default OFF so we don't interfere with text extraction
    label: false,
    ...opts
  }

  const pageIndexes = cfg.onlyFirstPage ? [0] : pages.map((_, i) => i)

  for (const i of pageIndexes) {
    const page = pages[i]
    if (!page) continue

    if (mode === RedactionMode.SURGERY_CENTER) {
      const h = cmToPt(cfg.surgeryTopCm)
      drawViewerTopBand(page, h, cfg.fill)
    }

    if (mode === RedactionMode.NO_CHARGE) {
      const { width } = page.getSize()
      const headerH = cmToPt(3.2)
      drawViewerTopBand(page, headerH, cfg.fill)

      const boxW = Math.min(width * 0.55, cmToPt(12))
      const boxH = cmToPt(3.0)
      drawViewerTopLeftBlock(page, headerH, boxW, boxH, cfg.fill)
    }
  }

  // CRITICAL: disable object streams for broad parser compatibility.
  return await pdfDoc.save({
    useObjectStreams: false,
  })
}
