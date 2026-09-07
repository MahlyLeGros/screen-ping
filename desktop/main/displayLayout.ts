export interface DisplayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayLike {
  id: number;
  bounds: DisplayBounds;
}

export interface LabeledDisplay {
  id: number;
  shortLabel: string;
  label: string;
  primary: boolean;
  bounds: DisplayBounds;
}

const COLS: Record<number, string[]> = {
  1: ["Center"],
  2: ["Left", "Right"],
  3: ["Left", "Center", "Right"],
  4: ["Far left", "Left", "Right", "Far right"],
  5: ["Far left", "Left", "Center", "Right", "Far right"],
};

const ROWS: Record<number, string[]> = {
  1: [""],
  2: ["Top", "Bottom"],
  3: ["Top", "Middle", "Bottom"],
  4: ["Top", "Upper", "Lower", "Bottom"],
};

function axisNames(count: number, kind: "col" | "row"): string[] {
  const table = kind === "col" ? COLS : ROWS;
  const known = table[count];
  if (known) return known;
  if (kind === "col") {
    return Array.from({ length: count }, (_, i) => {
      if (i === 0) return "Left";
      if (i === count - 1) return "Right";
      return `Center ${i}`;
    });
  }
  return Array.from({ length: count }, (_, i) => {
    if (i === 0) return "Top";
    if (i === count - 1) return "Bottom";
    return `Middle ${i}`;
  });
}

function clusterCenters(values: number[], maxGap: number): number[] {
  if (!values.length) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const groups: number[][] = [[sorted[0]]];
  for (let i = 1; i < sorted.length; i++) {
    const group = groups[groups.length - 1];
    if (sorted[i] - group[group.length - 1] <= maxGap) group.push(sorted[i]);
    else groups.push([sorted[i]]);
  }
  return groups.map((group) => group.reduce((sum, n) => sum + n, 0) / group.length);
}

function nearest(value: number, centers: number[]): number {
  let best = 0;
  let dist = Infinity;
  for (let i = 0; i < centers.length; i++) {
    const d = Math.abs(value - centers[i]);
    if (d < dist) {
      dist = d;
      best = i;
    }
  }
  return best;
}

function combineName(row: string, col: string, rows: number, cols: number): string {
  if (rows <= 1) return col || "Center";
  if (cols <= 1) return row || "Middle";
  return `${row} ${col.toLowerCase()}`.trim();
}

/** Name monitors from their place on the virtual desktop (left / center / right). */
export function labelDisplays(displays: DisplayLike[], primaryId?: number): LabeledDisplay[] {
  if (displays.length === 0) return [];

  const items = displays.map((display) => ({
    id: display.id,
    bounds: { ...display.bounds },
    cx: display.bounds.x + display.bounds.width / 2,
    cy: display.bounds.y + display.bounds.height / 2,
  }));

  const minW = Math.min(...items.map((item) => item.bounds.width));
  const minH = Math.min(...items.map((item) => item.bounds.height));
  const colGap = Math.max(160, minW * 0.45);
  const rowGap = Math.max(120, minH * 0.45);

  const colCenters = clusterCenters(
    items.map((item) => item.cx),
    colGap,
  );
  const rowCenters = clusterCenters(
    items.map((item) => item.cy),
    rowGap,
  );
  const colNames = axisNames(colCenters.length, "col");
  const rowNames = axisNames(rowCenters.length, "row");

  const labeled = items.map((item) => {
    const col = nearest(item.cx, colCenters);
    const row = nearest(item.cy, rowCenters);
    const shortLabel =
      displays.length === 1
        ? "This screen"
        : combineName(rowNames[row] ?? "", colNames[col] ?? "Center", rowCenters.length, colCenters.length);
    const primary = primaryId !== undefined && item.id === primaryId;
    const res = `${item.bounds.width}×${item.bounds.height}`;
    const label = primary ? `${shortLabel} — ${res} · main` : `${shortLabel} — ${res}`;
    return { id: item.id, shortLabel, label, primary, bounds: item.bounds };
  });

  labeled.sort((a, b) => a.bounds.y - b.bounds.y || a.bounds.x - b.bounds.x);
  return labeled;
}
