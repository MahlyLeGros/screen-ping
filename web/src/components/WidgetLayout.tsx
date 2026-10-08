import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import AccessibleDialog from "./AccessibleDialog";
import { defaultWidgetLayout, moveWidget, parseWidgetLayout, widgetStorageKey, type WidgetId, type WidgetLayout, type WidgetSide } from "../lib/widgetLayout";

const LABELS: Record<WidgetId, string> = { saved: "Saved pings", recent: "Recent sends", media: "Media", timing: "Caption & timing" };
interface Entry { host: HTMLDivElement; anchor: HTMLSpanElement }
interface Context {
  enabled: boolean;
  register: (id: WidgetId, entry: Entry) => () => void;
  pane: (side: WidgetSide, element: HTMLDivElement | null) => void;
  pointer: (id: WidgetId, event: ReactPointerEvent<HTMLButtonElement>) => void;
  keyboard: (id: WidgetId, event: ReactKeyboardEvent<HTMLButtonElement>) => void;
  reset: () => void;
}
const Widgets = createContext<Context | null>(null);

export function WidgetLayoutProvider({ userId, enabled, children }: { userId: string; enabled: boolean; children: ReactNode }) {
  const entries = useRef(new Map<WidgetId, Entry>());
  const panes = useRef<Partial<Record<WidgetSide, HTMLDivElement>>>({});
  const [layout, setLayout] = useState<WidgetLayout>(() => {
    try { return parseWidgetLayout(localStorage.getItem(widgetStorageKey(userId))); } catch { return defaultWidgetLayout(); }
  });
  const [draft, setDraft] = useState<WidgetLayout | null>(null);
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const draftRef = useRef(draft); draftRef.current = draft;
  const keyboardId = useRef<WidgetId | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const enabledRef = useRef(enabled); enabledRef.current = enabled;

  const arrange = useCallback((placement: WidgetLayout) => {
    for (const side of ["left", "right"] as const) {
      const pane = panes.current[side];
      if (!pane) continue;
      for (const id of placement[side]) {
        const entry = entries.current.get(id);
        if (entry) pane.appendChild(entry.host);
      }
      pane.dataset.empty = String(placement[side].length === 0);
    }
  }, []);
  const restore = useCallback(() => {
    for (const { host, anchor } of entries.current.values()) anchor.parentNode?.insertBefore(host, anchor);
  }, []);
  const register = useCallback((id: WidgetId, entry: Entry) => {
    entries.current.set(id, entry);
    if (enabledRef.current) arrange(layoutRef.current); else entry.anchor.before(entry.host);
    return () => { entries.current.delete(id); entry.host.remove(); };
  }, [arrange]);
  const pane = useCallback((side: WidgetSide, element: HTMLDivElement | null) => {
    if (element) panes.current[side] = element; else delete panes.current[side];
  }, []);
  useLayoutEffect(() => {
    const focusedGrip = document.activeElement instanceof HTMLButtonElement && document.activeElement.classList.contains("widget-grip") ? document.activeElement : null;
    if (enabled) arrange(draft ?? layout); else restore();
    for (const [id, { host }] of entries.current) host.classList.toggle("widget-host--placeholder", enabled && dragging === id && !keyboardId.current);
    if (enabled) focusedGrip?.focus({ preventScroll: true });
  }, [enabled, layout, draft, dragging, arrange, restore]);
  useEffect(() => {
    cleanupRef.current?.(); keyboardId.current = null; setDraft(null); setDragging(null);
    try { setLayout(parseWidgetLayout(localStorage.getItem(widgetStorageKey(userId)))); } catch { setLayout(defaultWidgetLayout()); }
  }, [userId]);
  useEffect(() => { if (!enabled) { cleanupRef.current?.(); keyboardId.current = null; setDraft(null); setDragging(null); } }, [enabled]);
  useEffect(() => () => cleanupRef.current?.(), []);
  useEffect(() => {
    const cancelKeyboard = () => {
      if (!keyboardId.current) return;
      keyboardId.current = null; setDraft(null); setDragging(null); setAnnouncement("Widget move cancelled.");
    };
    window.addEventListener("blur", cancelKeyboard);
    return () => window.removeEventListener("blur", cancelKeyboard);
  }, []);
  const commit = (next: WidgetLayout) => {
    setLayout(next);
    try { localStorage.setItem(widgetStorageKey(userId), JSON.stringify(next)); } catch { setAnnouncement("Layout changed, but this browser could not save it."); }
  };
  const announce = (id: WidgetId, next: WidgetLayout) => {
    const side = next.left.includes(id) ? "left" : "right";
    setAnnouncement(`${LABELS[id]}, ${side} panel, position ${next[side].indexOf(id) + 1}.`);
  };
  const pointer = (id: WidgetId, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!enabled || !event.isPrimary || event.button !== 0 || keyboardId.current) return;
    event.preventDefault(); event.stopPropagation(); cleanupRef.current?.();
    const host = entries.current.get(id)?.host;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const ghost = host.cloneNode(true) as HTMLDivElement;
    ghost.className = "widget-floating"; ghost.setAttribute("aria-hidden", "true"); ghost.setAttribute("inert", "");
    ghost.querySelectorAll("[id]").forEach(element => element.removeAttribute("id"));
    Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
    document.body.appendChild(ghost);
    host.style.height = `${rect.height}px`;
    const original = layoutRef.current;
    let next = original, targetSide: WidgetSide | null = null;
    let x = event.clientX, y = event.clientY, frame = 0;
    const pointerId = event.pointerId, originX = x, originY = y;
    const oldCursor = document.body.style.cursor; document.body.style.cursor = "grabbing";
    document.documentElement.setPointerCapture(pointerId);
    setDragging(id); setDraft(original);
    const locate = () => {
      targetSide = null;
      for (const side of ["left", "right"] as const) {
        const container = panes.current[side]; if (!container) continue;
        const bounds = container.getBoundingClientRect();
        if (x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) continue;
        targetSide = side;
        const ids = next[side].filter(item => item !== id);
        let index = ids.length;
        for (let i = 0; i < ids.length; i++) {
          const item = entries.current.get(ids[i])?.host.getBoundingClientRect();
          if (item && y < item.top + item.height / 2) { index = i; break; }
        }
        const proposed = moveWidget(next, id, side, index);
        if (JSON.stringify(proposed) !== JSON.stringify(next)) { next = proposed; setDraft(next); }
        break;
      }
    };
    const tick = () => {
      if (targetSide) {
        const container = panes.current[targetSide]!;
        const bounds = container.getBoundingClientRect();
        const delta = y < bounds.top + 40 ? -8 : y > bounds.bottom - 40 ? 8 : 0;
        if (delta) { container.scrollTop += delta; locate(); }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      ev.preventDefault(); x = ev.clientX; y = ev.clientY;
      ghost.style.transform = `translate3d(${x - originX}px, ${y - originY}px, 0)`;
      locate();
    };
    const end = (save: boolean) => {
      cleanup(); setDraft(null); setDragging(null);
      if (save && targetSide) { commit(next); announce(id, next); } else setAnnouncement("Widget move cancelled.");
    };
    const up = (ev: PointerEvent) => { if (ev.pointerId === pointerId) { x = ev.clientX; y = ev.clientY; locate(); end(ev.type === "pointerup"); } };
    const cancel = () => end(false);
    const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); cancel(); } };
    const cleanup = () => {
      cancelAnimationFrame(frame); ghost.remove(); host.style.height = ""; document.body.style.cursor = oldCursor;
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
      document.removeEventListener("keydown", key); window.removeEventListener("blur", cancel);
      document.documentElement.removeEventListener("lostpointercapture", cancel);
      if (document.documentElement.hasPointerCapture(pointerId)) document.documentElement.releasePointerCapture(pointerId);
      cleanupRef.current = null;
    };
    cleanupRef.current = cleanup;
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
    document.addEventListener("keydown", key); window.addEventListener("blur", cancel); document.documentElement.addEventListener("lostpointercapture", cancel);
  };
  const keyboard = (id: WidgetId, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!enabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!keyboardId.current) { keyboardId.current = id; setDraft(layoutRef.current); setDragging(id); setAnnouncement(`${LABELS[id]} picked up. Use arrow keys; Enter to drop, Escape to cancel.`); }
      else if (keyboardId.current === id) { commit(draftRef.current ?? layoutRef.current); keyboardId.current = null; setDraft(null); setDragging(null); setAnnouncement(`${LABELS[id]} placed.`); }
    } else if (keyboardId.current === id) {
      if (event.key === "Escape") { event.preventDefault(); keyboardId.current = null; setDraft(null); setDragging(null); setAnnouncement("Widget move cancelled."); return; }
      if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const current = draftRef.current ?? layoutRef.current;
      const side: WidgetSide = current.left.includes(id) ? "left" : "right";
      const index = current[side].indexOf(id);
      const destination = event.key === "ArrowLeft" ? "left" : event.key === "ArrowRight" ? "right" : side;
      const position = destination !== side ? Math.min(index, current[destination].length) : Math.max(0, index + (event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0));
      const next = moveWidget(current, id, destination, position); setDraft(next); announce(id, next);
      requestAnimationFrame(() => entries.current.get(id)?.host.querySelector<HTMLButtonElement>(".widget-grip")?.focus());
    }
  };
  return <Widgets.Provider value={{ enabled, register, pane, pointer, keyboard, reset: () => setResetOpen(true) }}>
    {children}
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    <AccessibleDialog open={resetOpen} labelledBy="widget-reset-title" onClose={() => setResetOpen(false)}>
      <h2 id="widget-reset-title" className="font-bold">Reset widget layout?</h2>
      <p className="text-sm text-slate-300">Restore the original left and right panels. Your media and settings will be kept.</p>
      <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setResetOpen(false)}>Cancel</button><button type="button" className="btn-primary" onClick={() => { commit(defaultWidgetLayout()); setResetOpen(false); }}>Reset layout</button></div>
    </AccessibleDialog>
  </Widgets.Provider>;
}

export function WidgetPane({ side, className, children }: { side: WidgetSide; className: string; children: ReactNode }) {
  const context = useContext(Widgets)!;
  const ref = useCallback((element: HTMLDivElement | null) => context.pane(side, element), [context.pane, side]);
  return <div ref={ref} className={`${className} ${context.enabled ? "widget-pane" : ""}`} data-widget-pane={side}>{children}</div>;
}
export function MovableWidget({ id, children }: { id: WidgetId; children: ReactNode }) {
  const context = useContext(Widgets)!;
  const anchor = useRef<HTMLSpanElement>(null);
  const [host] = useState(() => { const element = document.createElement("div"); element.className = `widget-host widget-host--${id}`; element.dataset.widgetId = id; return element; });
  useLayoutEffect(() => context.register(id, { host, anchor: anchor.current! }), [context.register, host, id]);
  return <><span ref={anchor} className="widget-anchor" aria-hidden="true" />{createPortal(children, host, id)}</>;
}
export function WidgetGrip({ id }: { id: WidgetId }) {
  const context = useContext(Widgets)!;
  return context.enabled ? <button type="button" className="widget-grip" aria-label={`Move ${LABELS[id]} widget`} title="Drag to move; Enter for keyboard controls" onPointerDown={event => context.pointer(id, event)} onKeyDown={event => context.keyboard(id, event)}><span /><span /><span /></button> : null;
}
export function WidgetReset() {
  const context = useContext(Widgets)!;
  return context.enabled ? <button type="button" className="widget-reset" onClick={context.reset}>Reset layout</button> : null;
}
