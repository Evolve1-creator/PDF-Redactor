// Template rectangles in NORMALIZED coordinates (0..1)
// Each rect: { x, y, w, h } relative to page width/height.
// STARTER defaults — tune to your documents.
export const TEMPLATES = {
  notes: {
    name: "Notes",
    rects: [
      { x: 0.0, y: 0.0, w: 1.0, h: 0.12 },
      { x: 0.0, y: 0.12, w: 0.55, h: 0.12 }
    ]
  },
  surgery_center: {
    name: "Surgery Center",
    rects: [
      { x: 0.0, y: 0.0, w: 1.0, h: 0.14 },
      { x: 0.55, y: 0.12, w: 0.45, h: 0.18 }
    ]
  }
};
