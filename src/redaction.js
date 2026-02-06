import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

/**
 * IMPORTANT NOTE ABOUT "REAL" REDACTION:
 * This app draws opaque rectangles over the original PDF content.
 * This preserves the existing text layer (so the output is text-searchable),
 * but it does NOT remove underlying content streams. In your workflow you stated
 * there is no PHI under the redacted area at all, so overlay-style redaction is sufficient.
 */

export const RedactionMode = {
  NO_CHARGE: 'no_charge',
  SURGERY_CENTER: 'surgery_center'
}

const cmToPt = (cm) => cm * 28.346456692913385

function getRotationAngle(page){
  // pdf-lib returns a Rotation object; angle may be undefined in some PDFs
  try {
    const r = page.getRotation?.()
    const angle = (r?.angle ?? 0) % 360
    return (angle + 360) % 360
  } catch {
    return 0
  }
}

/**
 * Draw a "top band" as the user sees it in a PDF viewer, even if the page is rotated.
 * - angle 0: top is y = height - h
 * - angle 90: top is x = width - h (right side in unrotated coords)
 * - angle 180: top is y = 0
 * - angle 270: top is x = 0 (left side in unrotated coords)
 */
function drawViewerTopBand(page, bandHeightPt, color){
  const { width, height } = page.getSize()
  const angle = getRotationAngle(page)

  if (angle === 0){
    page.drawRectangle({ x: 0, y: height - bandHeightPt, width, height: bandHeightPt, color })
    return { labelX: 12, labelY: height - bandHeightPt + 6 }
  }
  if (angle === 180){
    page.drawRectangle({ x: 0, y: 0, width, height: bandHeightPt, color })
    return { labelX: 12, labelY: 6 }
  }
  if (angle === 90){
    page.drawRectangle({ x: width - bandHeightPt, y: 0, width: bandHeightPt, height, color })
    return { labelX: width - bandHeightPt + 6, labelY: 12 }
  }
  if (angle === 270){
    page.drawRectangle({ x: 0, y: 0, width: bandHeightPt, height, color })
    return { labelX: 6, labelY: 12 }
  }

  // Fallback (treat as 0)
  page.drawRectangle({ x: 0, y: height - bandHeightPt, width, height: bandHeightPt, color })
  return { labelX: 12, labelY: height - bandHeightPt + 6 }
}

/**
 * Draw a viewer-relative block anchored below the header on the "left-top" area.
 * We handle rotations by mapping that region to the underlying PDF coordinate space.
 */
function drawViewerTopLeftBlock(page, headerBandPt, blockWidthPt, blockHeightPt, color){
  const { width, height } = page.getSize()
  const angle = getRotationAngle(page)

  if (angle === 0){
    page.drawRectangle({ x: 0, y: height - headerBandPt - blockHeightPt, width: blockWidthPt, height: blockHeightPt, color })
    return
  }
  if (angle === 180){
    // viewer top-left becomes bottom-right in unrotated coords
    page.drawRectangle({ x: width - blockWidthPt, y: headerBandPt, width: blockWidthPt, height: blockHeightPt, color })
    return
  }
  if (angle === 90){
    // viewer top-left becomes top-right in unrotated coords (y near height - blockWidth)
    page.drawRectangle({ x: width - headerBandPt - blockHeightPt, y: height - blockWidthPt, width: blockHeightPt, height: blockWidthPt, color })
    return
  }
  if (angle === 270){
    // viewer top-left becomes bottom-left in unrotated coords
    page.drawRectangle({ x: headerBandPt, y: 0, width: blockHeightPt, height: blockWidthPt, color })
    return
  }

  page.drawRectangle({ x: 0, y: height - headerBandPt - blockHeightPt, width: blockWidthPt, height: blockHeightPt, color })
}

export async function redactPdfBytes(inputBytes, mode, opts = {}) {
  const pdfDoc = await PDFDocument.load(inputBytes, { updateMetadata: false })
  const pages = pdfDoc.getPages()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  const cfg = {
    // Only redact page 1 by default (0-indexed)
    onlyFirstPage: true,
    // Surgery Center: redact top 4 cm
    surgeryTopCm: 4,
    // Color for redaction block
    fill: rgb(0, 0, 0),
    // Whether to add a small label near the redaction edge
    label: true,
    labelText: 'REDACTED',
    ...opts
  }

  const pageIndexes = cfg.onlyFirstPage ? [0] : pages.map((_, i) => i)

  for (const i of pageIndexes) {
    const page = pages[i]
    if (!page) continue

    if (mode === RedactionMode.SURGERY_CENTER) {
      const h = cmToPt(cfg.surgeryTopCm)
      const labelPos = drawViewerTopBand(page, h, cfg.fill)

      if (cfg.label && labelPos) {
        page.drawText(cfg.labelText, {
          x: labelPos.labelX,
          y: labelPos.labelY,
          size: 10,
          font,
          color: rgb(1, 1, 1),
          opacity: 0.9
        })
      }
    }

    if (mode === RedactionMode.NO_CHARGE) {
      // Example: redact a header band and a top-left info block under it (viewer-relative).
      const { width } = page.getSize()
      const headerH = cmToPt(3.2)
      const labelPos = drawViewerTopBand(page, headerH, cfg.fill)

      const boxW = Math.min(width * 0.55, cmToPt(12))
      const boxH = cmToPt(3.0)
      drawViewerTopLeftBlock(page, headerH, boxW, boxH, cfg.fill)

      if (cfg.label && labelPos) {
        page.drawText(cfg.labelText, {
          x: labelPos.labelX,
          y: labelPos.labelY,
          size: 10,
          font,
          color: rgb(1, 1, 1),
          opacity: 0.9
        })
      }
    }
  }

  // Save without rasterizing; text remains searchable.
  return await pdfDoc.save({ useObjectStreams: true })
}
