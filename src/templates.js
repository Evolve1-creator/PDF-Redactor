// Templates for redaction
// Notes: NORMALIZED rects (0..1) relative to page size.
// Surgery Notes: INCHES from the top (across full width), different height for page 1 vs other pages.
// Asante Notes / Asante Blue: INCHES top band differs by page, PLUS a bottom band on every page.

export const TEMPLATES = {
  notes: {
    name: "Notes",
    mode: "normalized_rects",
    rects: [
      { x: 0.0, y: 0.0, w: 1.0, h: 0.12 },
      { x: 0.0, y: 0.12, w: 0.55, h: 0.12 }
    ]
  },

  surgery_notes: {
    name: "Surgery Notes",
    mode: "top_band_inches",
    topBandInches: { firstPage: 1.75, otherPages: 0.6 }
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
