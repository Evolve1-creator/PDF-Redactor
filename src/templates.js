// Templates for redaction
// Notes: NORMALIZED rects (0..1) relative to page size.
// Surgery Notes: page-1-only normalized header block sized to fully cover the demographic header.
// Asante Notes / Asante Blue: INCHES top band differs by page, PLUS a bottom band on every page.

export const TEMPLATES = {
  notes: {
    name: "General Notes",
    mode: "normalized_rects",
    rects: [
      { x: 0.0, y: 0.0, w: 1.0, h: 0.12 },
      { x: 0.0, y: 0.12, w: 0.55, h: 0.12 }
    ]
  },

  surgery_notes: {
    name: "Surgery Notes",
    mode: "page_rects_normalized",
    // Cover the full first-page header down past the address line.
    firstPageRects: [
      { x: 0.0, y: 0.0, w: 1.0, h: 0.24 }
    ],
    // Surgery notes should not be redacted again on following pages.
    otherPagesRects: []
  },

  asante_notes: {
    name: "Asante Notes",
    mode: "bands_inches",
    bandsInches: {
      topFirstPage: 3.75,
      topOtherPages: 0.40,
      bottomAllPages: 0.40
    }
  },

  asante_blue: {
    name: "Asante Blue",
    mode: "bands_inches",
    // Same parameters as Asante Notes:
    // Page 1 top 3.75in, pages 2+ top 0.40in, all pages bottom 0.40in
    bandsInches: {
      topFirstPage: 3.75,
      topOtherPages: 0.40,
      bottomAllPages: 0.40
    }
  }
};
