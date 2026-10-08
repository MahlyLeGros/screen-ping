import { describe, expect, it } from "vitest";
import { defaultWidgetLayout, moveWidget, parseWidgetLayout, resizeWidget, widgetStorageKey, WIDGET_IDS } from "./widgetLayout";
describe("widget layout", () => {
  it("persists bounded heights without losing ordering or legacy layouts", () => {
    const layout = resizeWidget(defaultWidgetLayout(), "saved", 310);
    expect(parseWidgetLayout(JSON.stringify(layout))).toEqual(layout);
    expect(moveWidget(layout, "saved", "right", 0).heights?.saved).toBe(310);
    expect(resizeWidget(layout, "saved", -10).heights?.saved).toBe(120);
    expect(resizeWidget(layout, "media", 5000).heights?.media).toBe(2000);
    expect(resizeWidget(layout, "media", NaN)).toBe(layout);
    expect(parseWidgetLayout(JSON.stringify({ ...layout, heights: { saved: "bad", recent: 250, unknown: 400 } })).heights).toEqual({ recent: 250 });
    expect(defaultWidgetLayout().heights).toBeUndefined();
  });
  it("validates storage and empty panels", () => {
    expect(parseWidgetLayout(JSON.stringify({ version: 1, left: [], right: [...WIDGET_IDS] })).right).toEqual(WIDGET_IDS);
    for (const value of [null, "invalid", '{}', '{"version":2}', '{"version":1,"left":["saved","saved"],"right":["media","timing"]}']) expect(parseWidgetLayout(value)).toEqual(defaultWidgetLayout());
    expect(widgetStorageKey("one")).not.toBe(widgetStorageKey("two"));
  });
  it("moves across panels and reorders without duplicates", () => {
    let layout = defaultWidgetLayout();
    layout = moveWidget(layout, "media", "left", 1);
    expect(layout.left).toEqual(["saved", "media", "recent"]);
    layout = moveWidget(layout, "saved", "left", 2);
    expect(layout.left).toEqual(["media", "recent", "saved"]);
    for (const id of WIDGET_IDS) layout = moveWidget(layout, id, "right", 99);
    expect(layout.left).toEqual([]); expect(new Set(layout.right).size).toBe(4);
  });
  it("supports every ordering and split between the two panels", () => {
    const permutations = (ids: typeof WIDGET_IDS[number][]): typeof WIDGET_IDS[number][][] => ids.length ? ids.flatMap((id, index) => permutations(ids.filter((_, i) => i !== index)).map(rest => [id, ...rest])) : [[]];
    for (const ids of permutations([...WIDGET_IDS])) for (let split = 0; split <= 4; split++) {
      const layout = { version: 1 as const, left: ids.slice(0, split), right: ids.slice(split) };
      expect(parseWidgetLayout(JSON.stringify(layout))).toEqual(layout);
      for (const id of WIDGET_IDS) for (const side of ["left", "right"] as const) for (let index = 0; index <= layout[side].length; index++) {
        const next = moveWidget(layout, id, side, index);
        expect([...next.left, ...next.right].sort()).toEqual([...WIDGET_IDS].sort());
        expect(next[side].includes(id)).toBe(true);
      }
    }
  });
});
