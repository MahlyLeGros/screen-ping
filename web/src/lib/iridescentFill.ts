const SELECTOR = ".iridescent-fill, .btn-primary, .btn-compact, .pill-btn-active, .tab-btn-active";

/** Distinct windows into the silk so stacked full-width buttons are not clones. */
const SPOTS: Array<[number, number]> = [
  [14, 16],
  [78, 18],
  [46, 42],
  [18, 74],
  [72, 78],
  [88, 48],
  [8, 48],
  [52, 10],
  [32, 86],
  [62, 58],
];

let nextSeed = 1;

function seedFor(el: HTMLElement): number {
  const existing = el.dataset.iridSeed;
  if (existing) return Number(existing);
  const seed = (nextSeed * 167 + 13) % 1000;
  nextSeed += 1;
  el.dataset.iridSeed = String(seed);
  return seed;
}

function applySize(el: HTMLElement, seed: number, rect: DOMRect) {
  const w = Math.max(560, Math.round(rect.width * 1.55 + 64 + (seed % 4) * 28));
  const h = 132 + (seed % 5) * 16;
  el.style.setProperty("--irid-w", `${w}px`);
  el.style.setProperty("--irid-h", `${h}px`);
}

function applySpot(el: HTMLElement, seed: number) {
  const [spotX, spotY] = SPOTS[seed % SPOTS.length];
  el.style.setProperty("--irid-x", `${Math.min(96, Math.max(4, spotX + (seed % 9) - 4))}%`);
  el.style.setProperty("--irid-y", `${Math.min(96, Math.max(4, spotY + ((seed * 3) % 9) - 4))}%`);
}

function paint(mode: "init" | "resize" = "init") {
  const nodes = document.querySelectorAll<HTMLElement>(SELECTOR);
  nodes.forEach((el) => {
    const isNew = !el.dataset.iridSeed;
    const seed = seedFor(el);
    if (isNew) {
      applySize(el, seed, el.getBoundingClientRect());
      applySpot(el, seed);
      return;
    }
    if (mode === "resize") {
      applySize(el, seed, el.getBoundingClientRect());
    }
  });
}

export function startIridescentFill() {
  let raf = 0;
  let nextMode: "init" | "resize" = "init";

  const schedule = (mode: "init" | "resize" = "init") => {
    if (mode === "resize") nextMode = "resize";
    if (raf) return;
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      const run = nextMode;
      nextMode = "init";
      paint(run);
    });
  };

  const onResize = () => schedule("resize");

  paint("init");
  window.addEventListener("resize", onResize, { passive: true });

  const observer = new MutationObserver(() => schedule("init"));
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });

  return () => {
    window.removeEventListener("resize", onResize);
    observer.disconnect();
    if (raf) window.cancelAnimationFrame(raf);
  };
}
