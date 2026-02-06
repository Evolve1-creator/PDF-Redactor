import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

/**
 * IMPORTANT NOTE ABOUT "REAL" REDACTION:
 * This app draws opaque rectangles over the original PDF content.
 * This preserves the existing text layer (so the output is text-searchable),
 * but it does NOT remove underlying content. In your workflow you stated there is
 * no PHI under the redacted area at all, so overlay-style redaction is sufficient.
 */

export const RedactionMode = {
  NO_CHARGE: 'no_charge',
  SURGERY_CENTER: 'surgery_center'
}

export async function redactPdfBytes(inputBytes, mode, opts = {}) {
  const pdfDoc = await PDFDocument.load(inputBytes, { updateMetadata: false })
  const pages = pdfDoc.getPages()

  // Optional: embed a standard font so we can stamp a "REDACTED" label if desired
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

  // Default configuration
  const cfg = {
    // Only redact page 1 by default (0-indexed)
    onlyFirstPage: true,
    // Surgery Center: redact top 4 cm (convert to points: 1 inch = 72 pt, 1 cm = 28.3464567 pt)
    surgeryTopCm: 4,
    // Color for redaction block
    fill: rgb(0, 0, 0),
    // Whether to add a small label at the bottom edge of the redaction block
    label: true,
    labelText: 'REDACTED',
    ...opts
  }

  const cmToPt = (cm) => cm * 28.346456692913385

  const pageIndexes = cfg.onlyFirstPage ? [0] : pages.map((_, i) => i)

  for (const i of pageIndexes) {
    const page = pages[i]
    if (!page) continue
    const { width, height } = page.getSize()

    if (mode === RedactionMode.SURGERY_CENTER) {
      const h = cmToPt(cfg.surgeryTopCm)
      const y = height - h
      page.drawRectangle({
        x: 0,
        y,
        width,
        height: h,
        color: cfg.fill
      })
      if (cfg.label) {
        page.drawText(cfg.labelText, {
          x: 12,
          y: y + 6,
          size: 10,
          font,
          color: rgb(1, 1, 1),
          opacity: 0.85
        })
      }
    }

    if (mode === RedactionMode.NO_CHARGE) {
      // Example "No-Charge" redaction zones (customize as needed):
      // - Redact a header band and a patient-identifying block on page 1.
      // These are *placeholders* that are common for medical PDFs.
      // You can adjust these coordinates in the UI if you want later.
      const headerH = cmToPt(3.2)
      page.drawRectangle({
        x: 0,
        y: height - headerH,
        width,
        height: headerH,
        color: cfg.fill
      })

      // left-top block (e.g. patient info box)
      const boxW = Math.min(width * 0.55, cmToPt(12))
      const boxH = cmToPt(3.0)
      page.drawRectangle({
        x: 0,
        y: height - headerH - boxH,
        width: boxW,
        height: boxH,
        color: cfg.fill
      })

      if (cfg.label) {
        page.drawText(cfg.labelText, {
          x: 12,
          y: height - headerH + 6,
          size: 10,
          font,
          color: rgb(1, 1, 1),
          opacity: 0.85
        })
      }
    }
  }

  // Save without rasterizing; text remains searchable.
  const outBytes = await pdfDoc.save({ useObjectStreams: true })
  return outBytes
}
