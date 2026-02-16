// Redaction parameters (from the provided template files).
// Coordinates are in PDF points (1/72 inch), with origin at bottom-left.

export const RedactionMode = {
  EPIC_HEADER_FOOTER: 'epic_header_footer',
  SURGERY_TOP_BAND: 'surgery_top_band'
}

const CM_TO_POINTS = 28.35

// Parameters:
// - Page 1: large block at the top (width 612, height 300) starting at top-left.
// - Every page (including page 1): 1 cm header band + 1 cm footer band.
export function rectsEpicHeaderFooter(pageIndex, pageW, pageH){
  const rects = []
  // Large page-1 block: x=0, y from top 0, width=612, height=300
  if (pageIndex === 0){
    const width = Math.min(612, pageW)
    const height = Math.min(300, pageH)
    rects.push({
      x: 0,
      y: pageH - height,
      w: width,
      h: height
    })
  }
  const bandH = 1 * CM_TO_POINTS
  const headerH = Math.min(bandH, pageH)
  const footerH = Math.min(bandH, pageH)
  // Header band
  rects.push({ x: 0, y: pageH - headerH, w: pageW, h: headerH })
  // Footer band
  rects.push({ x: 0, y: 0, w: pageW, h: footerH })
  return rects
}

// Parameters:
// - All pages: 4 cm top band.
export function rectsSurgeryTopBand(pageW, pageH){
  const bandH = 4 * CM_TO_POINTS
  const h = Math.min(bandH, pageH)
  return [{ x: 0, y: pageH - h, w: pageW, h }]
}

export function getRedactionRects(mode, pageIndex, pageW, pageH){
  if (mode === RedactionMode.SURGERY_TOP_BAND) return rectsSurgeryTopBand(pageW, pageH)
  return rectsEpicHeaderFooter(pageIndex, pageW, pageH)
}

export function pointInRect(px, py, r){
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}

export function isPointRedacted(px, py, rects){
  for (const r of rects){
    if (pointInRect(px, py, r)) return true
  }
  return false
}
