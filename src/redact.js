
import { PDFDocument, rgb } from 'pdf-lib'

const CM_TO_POINTS = 28.35

export async function applyTemplateRedactions(bytes, template) {
  const pdf = await PDFDocument.load(bytes)
  const pages = pdf.getPages()

  pages.forEach((page, idx) => {
    const h = page.getHeight()
    const w = page.getWidth()

    if (idx === 0 && template.page1?.redactions) {
      template.page1.redactions.forEach(r => {
        page.drawRectangle({
          x: r.x,
          y: h - r.y - r.height,
          width: r.width,
          height: r.height,
          color: rgb(0,0,0)
        })
      })
    }

    if (idx + 1 >= template.repeatFromPage) {
      template.repeatRedactions.forEach(r => {
        const hp = r.heightCm * CM_TO_POINTS
        const y = r.position === 'top' ? h - hp : 0
        page.drawRectangle({
          x: 0,
          y,
          width: w,
          height: hp,
          color: rgb(0,0,0)
        })
      })
    }
  })

  return await pdf.save()
}
