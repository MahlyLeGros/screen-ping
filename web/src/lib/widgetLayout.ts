export const WIDGET_IDS = ["saved", "recent", "media", "timing"] as const;
export type WidgetId = typeof WIDGET_IDS[number];
export type WidgetSide = "left" | "right";
export interface WidgetLayout { version: 1; left: WidgetId[]; right: WidgetId[] }
export const defaultWidgetLayout = (): WidgetLayout => ({ version: 1, left: ["saved", "recent"], right: ["media", "timing"] });
export const widgetStorageKey = (userId: string) => `sp-widget-layout-v1:${userId}`;
export function parseWidgetLayout(value: string | null): WidgetLayout {
  try {
    const layout = JSON.parse(value || "null");
    if (layout?.version !== 1 || !Array.isArray(layout.left) || !Array.isArray(layout.right)) return defaultWidgetLayout();
    const ids = [...layout.left, ...layout.right];
    if (ids.length !== WIDGET_IDS.length || new Set(ids).size !== WIDGET_IDS.length || !ids.every(id => WIDGET_IDS.includes(id))) return defaultWidgetLayout();
    return { version: 1, left: [...layout.left], right: [...layout.right] };
  } catch { return defaultWidgetLayout(); }
}
export function moveWidget(layout: WidgetLayout, id: WidgetId, side: WidgetSide, index: number): WidgetLayout {
  const next: WidgetLayout = { version: 1, left: layout.left.filter(item => item !== id), right: layout.right.filter(item => item !== id) };
  next[side].splice(Math.max(0, Math.min(index, next[side].length)), 0, id);
  return next;
}
