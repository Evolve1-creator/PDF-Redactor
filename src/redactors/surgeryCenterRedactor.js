
import { PDFDocument, rgb } from 'pdf-lib'

const CM_TO_POINTS = 28.35

export async function surgeryCenterRedactor(bytes) {
  const pdf = await PDFDocument.load(bytes)
  const pages = pdf.getPages()

  const heightPoints = 4 * CM_TO_POINTS

  pages.forEach(page => {
    const h = page.getHeight()
    const w = page.getWidth()

    page.drawRectangle({
      x: 0,
      y: h - heightPoints,
      width: w,
      height: heightPoints,
      color: rgb(0,0,0)
    })
  })

  return await pdf.save()
}
