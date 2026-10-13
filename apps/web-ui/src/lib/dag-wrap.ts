// Wrapping a layered line into bands, like text (run-viz FR4.1a): a layer's column restarts at 0 on each new band, so a long line keeps its nodes at full size instead of shrinking to fit the panel.

export interface WrappedLayer {
  band: number;
  column: number;
}

export function wrapLayer(layer: number, columnsPerBand: number): WrappedLayer {
  if (!Number.isFinite(columnsPerBand)) {
    return { band: 0, column: layer };
  }

  return {
    band: Math.floor(layer / columnsPerBand),
    column: layer % columnsPerBand,
  };
}

export interface ColumnPitch {
  layerGap: number;
  nodeWidth: number;
  /** Space kept clear on each side of the drawing. */
  padding: number;
}

/** How many columns fit in a width: the first takes a node's width, every further one a full pitch. Never fewer than one. */
export function columnsFor(width: number, pitch: ColumnPitch): number {
  const usable = width - pitch.padding * 2 - pitch.nodeWidth;

  return Math.max(1, Math.floor(usable / pitch.layerGap) + 1);
}
