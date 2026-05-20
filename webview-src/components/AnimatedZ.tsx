import * as React from "react";

/**
 * The pixel-Z mark from zot.sh, ported to the extension.
 *
 * Each tile shimmers around its base opacity (sine wave, per-tile phase
 * offset) while a diagonal sweep travels top-left → bottom-right every
 * few seconds, briefly boosting tiles to full brightness as it passes.
 * Updates are written directly via setAttribute on the rects to avoid
 * React reconciling 37 nodes per animation frame.
 */

type Tile = { x: number; y: number; o: number };

const TILES: Tile[] = [
  { x: 0, y: 0, o: 1 },
  { x: 0, y: 275, o: 1 },
  { x: 0, y: 55, o: 1 },
  { x: 0, y: 330, o: 1 },
  { x: 55, y: 0, o: 0.2 },
  { x: 55, y: 275, o: 1 },
  { x: 55, y: 55, o: 1 },
  { x: 55, y: 330, o: 1 },
  { x: 55, y: 220, o: 1 },
  { x: 110, y: 0, o: 1 },
  { x: 110, y: 275, o: 1 },
  { x: 110, y: 55, o: 1 },
  { x: 110, y: 330, o: 0.2 },
  { x: 110, y: 220, o: 0.2 },
  { x: 110, y: 165, o: 1 },
  { x: 165, y: 0, o: 1 },
  { x: 165, y: 275, o: 0.5 },
  { x: 165, y: 55, o: 0.5 },
  { x: 165, y: 330, o: 1 },
  { x: 165, y: 220, o: 1 },
  { x: 165, y: 165, o: 1 },
  { x: 165, y: 110, o: 1 },
  { x: 220, y: 0, o: 1 },
  { x: 220, y: 275, o: 1 },
  { x: 220, y: 55, o: 1 },
  { x: 220, y: 330, o: 1 },
  { x: 220, y: 165, o: 0.5 },
  { x: 220, y: 110, o: 1 },
  { x: 275, y: 0, o: 1 },
  { x: 275, y: 275, o: 1 },
  { x: 275, y: 55, o: 0.2 },
  { x: 275, y: 330, o: 0.3 },
  { x: 275, y: 110, o: 1 },
  { x: 330, y: 0, o: 1 },
  { x: 330, y: 275, o: 1 },
  { x: 330, y: 55, o: 1 },
  { x: 330, y: 330, o: 1 },
];

const SHIMMER_AMP = 0.18;
const SHIMMER_PERIOD_MS = 2600;
const SWEEP_PERIOD_MS = 3400;
const SWEEP_WIDTH = 1.4;
const SWEEP_GAIN = 0.55;

type Prepared = Tile & {
  col: number;
  row: number;
  diag: number;
  phase: number;
};

const PREPARED: Prepared[] = TILES.map((t) => {
  const col = t.x / 55;
  const row = t.y / 55;
  const phase = (((col * 7 + row * 11 + col * row * 3) % 7) / 7) * Math.PI * 2;
  return { ...t, col, row, diag: col + row, phase };
});

const DIAG_MAX = 12;

export function AnimatedZ({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const rectsRef = React.useRef<(SVGRectElement | null)[]>([]);
  const reduced = useReducedMotion();

  React.useEffect(() => {
    if (reduced) return;
    let raf = 0;
    const start = performance.now();

    const tick = (now: number) => {
      const t = now - start;
      const sweepHead =
        ((t % SWEEP_PERIOD_MS) / SWEEP_PERIOD_MS) *
          (DIAG_MAX + SWEEP_WIDTH * 4) -
        SWEEP_WIDTH * 2;

      for (let i = 0; i < PREPARED.length; i++) {
        const tile = PREPARED[i];
        const node = rectsRef.current[i];
        if (!node) continue;
        const shimmer =
          SHIMMER_AMP *
          Math.sin((t / SHIMMER_PERIOD_MS) * Math.PI * 2 + tile.phase);
        const d = tile.diag - sweepHead;
        const sweep =
          SWEEP_GAIN * Math.exp(-(d * d) / (2 * SWEEP_WIDTH * SWEEP_WIDTH));
        const next = clamp01(tile.o + shimmer + sweep);
        node.setAttribute("fill-opacity", next.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 375 375"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ imageRendering: "pixelated" }}
      aria-label="zot"
      role="img"
      className={className}
    >
      {PREPARED.map((tile, i) => (
        <rect
          key={i}
          ref={(el) => {
            rectsRef.current[i] = el;
          }}
          x={tile.x}
          y={tile.y}
          width={45}
          height={45}
          fill="#6ADAFF"
          fillOpacity={tile.o}
        />
      ))}
    </svg>
  );
}

function clamp01(n: number) {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function useReducedMotion() {
  const [reduce, setReduce] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduce(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return reduce;
}
