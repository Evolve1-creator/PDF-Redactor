
import { PDFDocument, rgb } from 'pdf-lib'
const CM_TO_POINTS = 28.35

export async function applyTemplateRedactions(bytes, template) {
  const pdf = await PDFDocument.load(bytes)
  const pages = pdf.getPages()

  pages.forEach((page, idx) => {
    const h = page.getHeight()
    const w = page.getWidth()

    // Page 1 specific boxes
    if (idx === 0 && template.page1?.redactions) {
      template.page1.redactions.forEach(r => {
        page.drawRectangle({
          x: Number(r.x || 0),
          y: h - Number(r.y || 0) - Number(r.height || 0),
          width: Number(r.width || 0),
          height: Number(r.height || 0),
          color: rgb(0,0,0)
        })
      })
    }

    // Repeating bands for pages >= repeatFromPage
    const repeatFrom = Number(template.repeatFromPage || 0)
    if (repeatFrom && (idx + 1) >= repeatFrom) {
      (template.repeatRedactions || []).forEach(r => {
        const hp = Number(r.heightCm || 0) * CM_TO_POINTS
        if (!hp) return
        const y = (r.position === 'top') ? (h - hp) : 0
        page.drawRectangle({ x: 0, y, width: w, height: hp, color: rgb(0,0,0) })
      })
    }
  })

  return await pdf.save()
}
