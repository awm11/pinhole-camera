import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import {
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

// ---- 2D pinhole-optics constants (SVG user-space) ------------------------
const VB_W = 960;
const VB_H = 540;
const SOURCE_X = 130;
const HEAD_TOP = 150; // top edge of the seed disc
const HEAD_BOTTOM = 198; // bottom edge of the seed disc
const STEM_BOTTOM = 370;
const POT_BOTTOM = 430;
// The vertical (angle 0°/180°) petals stick out above and below the disc –
// same geometry used to draw them, reused here so the ray colour matches
// exactly what's on screen at any height.
const DISC_CY = (HEAD_TOP + HEAD_BOTTOM) / 2;
const PETAL_REACH = DISC_CY - ((HEAD_TOP + HEAD_BOTTOM) / 2 - 28 - 17); // distance from disc centre to a petal's outer tip
const PETAL_TOP = DISC_CY - PETAL_REACH; // tip of the upward petal
const PETAL_BOTTOM = DISC_CY + PETAL_REACH; // tip of the downward petal, in front of the stem
const TIP = { x: SOURCE_X, y: HEAD_TOP };   // top of the flower head
const BASE = { x: SOURCE_X, y: POT_BOTTOM }; // bottom of the pot
const WALL_X = 480;
const WALL_TOP = 40;
const WALL_BOTTOM = 500;
const APERTURE_CENTER = 290; // midpoint of TIP.y and BASE.y
const SCREEN_MIN = 580;
const SCREEN_MAX = 900;

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Four-part sunflower: yellow petals, brown disc, green stem, red pot. A
// ray's colour is an exact match to whichever part its source point sits
// on – no blending – and tracks the actual drawn geometry: petal, then
// disc, then petal again (the downward petal peeks below the disc), then
// stem, then pot.
const HEAD_HEX = "#ffd43b";
const DISC_HEX = "#8a5a1f";
const STEM_HEX = "#55a84f";
const POT_HEX = "#d9412f";
function colorForY(y) {
  if (y <= HEAD_TOP) return HEAD_HEX; // upward petal
  if (y <= HEAD_BOTTOM) return DISC_HEX; // seed disc
  if (y <= PETAL_BOTTOM) return HEAD_HEX; // downward petal, below the disc
  // Match the colour boundary to the top edge of the visible pot rim.
  if (y < STEM_BOTTOM - 7) return STEM_HEX;
  return POT_HEX;
}
const rgbStr = (hex) => hex; // colours are already exact hex values

// Project a ray from `source` through `gate` (a point on the aperture
// plane, x = WALL_X) onward to x = screenX, returning the landing y.
function projectToScreen(source, gate, screenX) {
  const t = (screenX - source.x) / (gate.x - source.x);
  return source.y + t * (gate.y - source.y);
}

const STEPS = [
  { key: "trace", label: "Trace a ray" },
  { key: "aperture", label: "Resize the hole" },
  { key: "screen", label: "Move the screen" },
];

function SunflowerArt() {
  return (
    <g>
      {/* stem – gradient with a soft highlight, drawn first so the pot sits in front of its base */}
      <path
        d={`M ${SOURCE_X} ${STEM_BOTTOM} C ${SOURCE_X + 6} ${STEM_BOTTOM - 60}, ${SOURCE_X - 6} ${HEAD_BOTTOM + 60}, ${SOURCE_X} ${HEAD_BOTTOM}`}
        fill="none"
        stroke="url(#pol-stem-gradient)"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <path
        d={`M ${SOURCE_X - 1} ${STEM_BOTTOM - 6} C ${SOURCE_X + 4} ${STEM_BOTTOM - 60}, ${SOURCE_X - 4} ${HEAD_BOTTOM + 56}, ${SOURCE_X - 1} ${HEAD_BOTTOM + 6}`}
        fill="none"
        stroke="#8BD77F"
        strokeWidth="1.6"
        strokeLinecap="round"
        opacity="0.78"
      />

      {/* pot – straight sides, drawn over the stem's base */}
      <rect x={SOURCE_X - 20} y={STEM_BOTTOM} width="40" height={POT_BOTTOM - STEM_BOTTOM - 6} fill="#d9412f" stroke="#8f1a1a" strokeWidth="3" />
      <rect x={SOURCE_X - 20} y={POT_BOTTOM - 6} width="40" height="6" fill="#8f1a1a" />
      <rect x={SOURCE_X - 23} y={STEM_BOTTOM - 7} width="46" height="10" fill="#e5514a" stroke="#8f1a1a" strokeWidth="2" />
      <path d={`M ${SOURCE_X - 12} ${STEM_BOTTOM + 8} L ${SOURCE_X - 8} ${POT_BOTTOM - 14}`} stroke="#ff8a7a" strokeWidth="4" strokeLinecap="round" opacity="0.5" />

      {/* leaves – shadow, blade, veins */}
      {[
        { base: [SOURCE_X - 2, STEM_BOTTOM - 62], tip: [SOURCE_X - 66, STEM_BOTTOM - 85], bow: -1 },
        { base: [SOURCE_X + 2, STEM_BOTTOM - 106], tip: [SOURCE_X + 62, STEM_BOTTOM - 133], bow: 1 },
      ].map((leaf, li) => {
        const [bx, by] = leaf.base;
        const [tx, ty] = leaf.tip;
        const mx = (bx + tx) / 2;
        const my = (by + ty) / 2;
        const bow = leaf.bow;
        const d = `M ${bx} ${by} Q ${mx + bow * 10} ${my - 20} ${tx} ${ty} Q ${mx + bow * 26} ${my + 14} ${bx} ${by} Z`;
        return (
          <g key={li}>
            <path d={d} fill="#1c3a17" opacity="0.35" transform="translate(2 3)" filter="url(#pol-soft-shadow)" />
            <path d={d} fill="url(#pol-leaf-gradient)" stroke="#287A35" strokeWidth="2" />
            <line x1={bx} y1={by} x2={tx} y2={ty} stroke="#2c6224" strokeWidth="1.5" opacity="0.8" />
            <line x1={(bx + mx) / 2} y1={(by + my) / 2} x2={mx + bow * 14} y2={my - bow * 6} stroke="#2c6224" strokeWidth="1" opacity="0.6" />
          </g>
        );
      })}

      {/* flower head – turned slightly off-centre for a side-on look */}
      <g transform={`rotate(-11 ${SOURCE_X} ${HEAD_BOTTOM})`}>
        {/* rear shadow */}
        <ellipse cx={SOURCE_X + 3} cy={(HEAD_TOP + HEAD_BOTTOM) / 2 + 3} rx="18" ry="27" fill="#6D350A" opacity="0.4" />

        {/* petals – a very slight side-on perspective:
            top/bottom petals project longer, side petals a little shorter */}
        <g filter="url(#pol-glow)">
          {Array.from({ length: 15 }, (_, i) => i * 24).map((angle) => {
            const rad = (angle * Math.PI) / 180;
            const verticalness = Math.abs(Math.cos(rad));

            // Subtle rather than dramatic foreshortening.
            const petalLength = 15.5 + verticalness * 5.8;
            const petalReach = 25.5 + verticalness * 5.6;
            const petalWidth = 6.2 + verticalness * 0.4;

            return (
              <ellipse
                key={angle}
                cx={SOURCE_X}
                cy={(HEAD_TOP + HEAD_BOTTOM) / 2 - petalReach}
                rx={petalWidth}
                ry={petalLength}
                transform={`rotate(${angle} ${SOURCE_X} ${(HEAD_TOP + HEAD_BOTTOM) / 2})`}
                fill="url(#pol-petal-gradient)"
                stroke="#D99A16"
                strokeWidth="1.5"
              />
            );
          })}
        </g>

        {/* Seed disc: only gently compressed, so the head reads almost
            front-on with just a hint of side perspective. */}
        <ellipse cx={SOURCE_X} cy={(HEAD_TOP + HEAD_BOTTOM) / 2} rx="18.5" ry="22.5" fill="url(#pol-center-gradient)" stroke="#7A3F0C" strokeWidth="2.5" />
        <ellipse cx={SOURCE_X - 4} cy={(HEAD_TOP + HEAD_BOTTOM) / 2 - 8} rx="10.5" ry="10" fill="#F4B65A" opacity="0.18" />
        <ellipse cx={SOURCE_X - 5} cy={(HEAD_TOP + HEAD_BOTTOM) / 2 - 6} rx="4.5" ry="4.5" fill="#F0A33A" opacity="0.4" />
        <ellipse cx={SOURCE_X} cy={(HEAD_TOP + HEAD_BOTTOM) / 2} rx="17.5" ry="21.5" fill="none" stroke="#4E2507" strokeWidth="2" opacity="0.3" />
      </g>
    </g>
  );
}

function PinholeOpticsLearn({ onOpen3D }) {
  const svgRef = useRef(null);
  const [step, setStep] = useState(0);

  // Step 1 state – a single source point, freely draggable up and down
  // the sunflower (flower / stem / pot), and three draggable rays.
  const [sourceY, setSourceY] = useState(260);
  const [coneMode, setConeMode] = useState(false);
  const FIXED_HALF = 16;
  const [gates, setGates] = useState([
    APERTURE_CENTER - 90,
    APERTURE_CENTER,
    APERTURE_CENTER + 90,
  ]);

  /*
     The three ray handles sit on the incoming ray segments rather
     than directly on top of the pinhole wall. Their X positions are
     deliberately staggered left-to-right in the requested order:
     handle 1, handle 3, handle 2.
  */
  const RAY_HANDLE_X = [
    330,
    370,
    350,
  ];

  // Step 2 state – aperture half-height is draggable; both sources shown.
  const [apertureHalf, setApertureHalf] = useState(34);

  // Step 3 state – aperture pinned small (sharp); screen distance draggable.
  const [screenX, setScreenX] = useState(760);

  const getSvgPoint = useCallback((clientX, clientY) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  const dragProps = (onMove) => ({
    onPointerDown: (e) => {
      /*
         Pointer interaction should not create a visible focus state.
         preventDefault stops the browser's normal click-to-focus behaviour;
         the next-frame blur is a fallback for browsers that still focus SVG
         slider elements after pointer capture begins.
      */
      e.preventDefault();

      const target =
        e.currentTarget;

      target.setPointerCapture(
        e.pointerId
      );

      requestAnimationFrame(
        () => {
          target.blur();
        }
      );
    },
    onPointerMove: (e) => {
      if (e.buttons === 0) return;
      const p = getSvgPoint(e.clientX, e.clientY);
      onMove(p);
    },
    onPointerUp: (e) => {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}

      e.currentTarget.blur();
    },
  });

  const source = { x: SOURCE_X, y: sourceY };
  const sourceColor = rgbStr(colorForY(sourceY));
  const coneColor = sourceColor;
  const stepAperture =
    step === 0 ? FIXED_HALF : step === 1 ? apertureHalf : 6;
  const stepScreenX = step === 2 ? screenX : 760;
  const apTop = APERTURE_CENTER - stepAperture;
  const apBottom = APERTURE_CENTER + stepAperture;

  const apertureHandle = {
    x: WALL_X + 34,
    y: apTop - 18,
  };

  // ---- geometry for step 1's cone-of-light mode: a wide 120° spread from
  // the source, of which only the sliver aligned with the hole gets through.
  const CONE_HALF_ANGLE = (60 * Math.PI) / 180; // 60° each side = 120° total
  const coneWideHalf = (WALL_X - source.x) * Math.tan(CONE_HALF_ANGLE);
  const coneWideTop = source.y - coneWideHalf;
  const coneWideBottom = source.y + coneWideHalf;
  const beamScreenTop = projectToScreen(source, { x: WALL_X, y: apTop }, stepScreenX);
  const beamScreenBottom = projectToScreen(source, { x: WALL_X, y: apBottom }, stepScreenX);

  /*
     Visible parts of the 120° cone that MISS the finite-height front
     wall above and below it.

     The cone's extreme outer rays are already outside the SVG before
     they reach x = WALL_X, so extending only those outer boundaries is
     invisible. Instead, use the visible gaps:
       y = 0 .. WALL_TOP
       y = WALL_BOTTOM .. VB_H

     The inner edge of each escaped slice continues until it reaches the
     top/bottom edge of the SVG.
  */
  const upperEscapeSlope =
    (WALL_TOP - source.y) /
    (WALL_X - source.x);

  const upperEscapeX =
    WALL_X +
    (0 - WALL_TOP) /
      upperEscapeSlope;

  const lowerEscapeSlope =
    (WALL_BOTTOM - source.y) /
    (WALL_X - source.x);

  const lowerEscapeX =
    WALL_X +
    (VB_H - WALL_BOTTOM) /
      lowerEscapeSlope;


  /*
     Step 01 light is rendered as ONE SVG path element.

     The path contains the four visible, non-overlapping regions of the same
     light field:
       1) the broad incoming cone up to the wall,
       2) the light that clears above the wall,
       3) the light that passes through the pinhole,
       4) the light that clears below the wall.

     Because these are subpaths inside a single SVG <path>, opacity and blur
     are applied only once. There is no second translucent cone underneath.
  */
  const step1LightPath = `
    M ${source.x} ${source.y}
    L ${WALL_X} ${coneWideTop}
    L ${WALL_X} ${coneWideBottom}
    Z

    M ${WALL_X} 0
    L ${WALL_X} ${WALL_TOP}
    L ${upperEscapeX} 0
    Z

    M ${WALL_X} ${apTop}
    L ${WALL_X} ${apBottom}
    L ${stepScreenX} ${beamScreenBottom}
    L ${stepScreenX} ${beamScreenTop}
    Z

    M ${WALL_X} ${WALL_BOTTOM}
    L ${WALL_X} ${VB_H}
    L ${lowerEscapeX} ${VB_H}
    Z
  `;

  // ---- geometry for step 1: three freely draggable gates -------------
  const gateRays = gates.map((gy) => {
    const gate = { x: WALL_X, y: gy };

    const throughHole =
      gy >= apTop &&
      gy <= apBottom;

    const clearsAboveWall =
      gy < WALL_TOP;

    const clearsBelowWall =
      gy > WALL_BOTTOM;

    const landY =
      throughHole
        ? projectToScreen(
            source,
            gate,
            stepScreenX
          )
        : null;

    /*
       If the ray misses the front wall entirely, continue the
       same straight ray until it exits the SVG.
    */
    const slope =
      (gate.y -
        source.y) /
      (gate.x -
        source.x);

    const exitXTop =
      clearsAboveWall &&
      Math.abs(slope) >
        1e-9
        ? gate.x +
          (0 -
            gate.y) /
            slope
        : null;

    const exitXBottom =
      clearsBelowWall &&
      Math.abs(slope) >
        1e-9
        ? gate.x +
          (VB_H -
            gate.y) /
            slope
        : null;

    return {
      gate,
      throughHole,
      clearsAboveWall,
      clearsBelowWall,
      landY,
      exitXTop,
      exitXBottom,
    };
  });

  const rayHandlePositions =
    gateRays.map((ray, i) => {
      const x =
        RAY_HANDLE_X[i];

      const alpha =
        (x - source.x) /
        (WALL_X - source.x);

      const y =
        source.y +
        alpha *
          (ray.gate.y -
            source.y);

      return {
        x,
        y,
        alpha,
      };
    });
  // ---- geometry for step 2: 10 points along the sunflower, sampled fan ------
  const PLANT_POINT_COUNT = 10;
  const plantPoints = Array.from({ length: PLANT_POINT_COUNT }, (_, i) => {
    const y = HEAD_TOP + (i / (PLANT_POINT_COUNT - 1)) * (POT_BOTTOM - HEAD_TOP);
    return { x: SOURCE_X, y, color: colorForY(y) };
  });
  const GATE_SAMPLES = 9;
  const gateSampleYs = Array.from({ length: GATE_SAMPLES }, (_, i) =>
    apTop + (i / (GATE_SAMPLES - 1)) * (apBottom - apTop)
  );
  const plantFans = plantPoints.map((pt) => {
    const landings = gateSampleYs.map((gy) =>
      projectToScreen(pt, { x: WALL_X, y: gy }, stepScreenX)
    );

    /*
       Blur for one object point = the width of that point's own
       landing smear on the screen. This excludes the height/size
       of the projected image itself.
    */
    const spread =
      Math.max(...landings) -
      Math.min(...landings);

    return {
      pt,
      landings,
      spread,
    };
  });

  /*
     "Image blur" is the mean point-spread width across the 10
     sampled points on the sunflower. With a near-zero aperture,
     each point collapses toward one screen location, so this tends
     toward 0 px. Widening the aperture increases it naturally.
  */
  const imageBlur =
    plantFans.reduce(
      (sum, fan) =>
        sum + fan.spread,
      0
    ) /
    Math.max(
      plantFans.length,
      1
    );

  // ---- geometry for step 3: central ray per source, image size ------
  const centerGate = { x: WALL_X, y: APERTURE_CENTER };
  const tipImageY = projectToScreen(TIP, centerGate, stepScreenX);
  const baseImageY = projectToScreen(BASE, centerGate, stepScreenX);
  const imageHeight = Math.abs(baseImageY - tipImageY);
  const plantHeight = Math.abs(BASE.y - TIP.y);
  const scaleRatio = imageHeight / plantHeight;

  return (
    <div className="pol-root">
      <style>{`
        .pol-root {
          --bg: #e7f4fa;
          --panel: #ffffff;
          --panel-line: #b8ccd8;
          --parchment: #263b4a;
          --muted: #526a7b;
          --tip: #cf6d37;
          --base: #d95f43;
          --slate: #536b7c;
          --slate-dim: #405868;
          --teal: #167f8d;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 1.08rem;
          background: linear-gradient(180deg, #daf3ff 0%, #eaf6fb 100%);
          color: var(--parchment);
          padding: 4.5rem 0.85rem 3rem;
          border-radius: 0;
          min-height: 100%;
        }
        .pol-wrap {
          width: min(1240px, calc(100vw - 20px));
          max-width: 1240px;
          margin: 0 auto;
        }
        .pol-title {
          font-family: 'Fraunces', serif;
          font-weight: 560;
          font-size: clamp(2.15rem, 4.4vw, 3.15rem);
          line-height: 1.05;
          margin: 0 0 0.7rem;
          color: var(--parchment);
        }
        .pol-title em {
          font-style: italic;
          font-weight: 420;
          color: var(--tip);
        }
        .pol-sub {
          font-size: 1.16rem;
          line-height: 1.55;
          color: #496172;
          max-width: none;
          width: 100%;
          margin: 0 0 2rem;
          box-sizing: border-box;
        }

        .pol-stage {
          background: rgba(255,255,255,0.85);
          border: 1px solid var(--panel-line);
          padding: 1.25rem 1.25rem 1.05rem;
          width: 100%;
          box-sizing: border-box;
        }
        .pol-svg { width: 100%; height: auto; display: block; touch-action: none; }
        .pol-svg-control:focus-visible {
          outline: 3px solid #f29b66;
          outline-offset: 2px;
        }

        /* Keep all Learn text/control rows aligned to the canvas width. */
        .pol-mode-toggle,
        .pol-instructions,
        .pol-tabs,
        .pol-lab-handoff {
          width: 100%;
          max-width: none;
          box-sizing: border-box;
        }

        .pol-tabs {
          display: flex;
          align-items: center;
          gap: 0.4rem;
          margin: 1.1rem 0 1.3rem;
          flex-wrap: wrap;
        }
        .pol-inline-stats {
          flex: 1 1 auto;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 1.15rem;
          min-width: 0;
          padding: 0 0.75rem;
          font-family: 'IBM Plex Mono', monospace;
        }
        .pol-inline-stat {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 0.16rem;
          white-space: nowrap;
        }
        .pol-inline-stat .pol-stat-label {
          margin: 0;
          font-size: 0.68rem;
          letter-spacing: 0.09em;
          line-height: 1.05;
        }
        .pol-inline-stat .pol-stat-value {
          font-size: 1.02rem;
          line-height: 1.05;
        }
        .pol-tab {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 1.02rem;
          font-weight: 500;
          color: var(--muted);
          background: rgba(255,255,255,0.68);
          border: 1px solid var(--panel-line);
          padding: 0.68rem 1.05rem;
          cursor: pointer;
          transition: color 0.15s ease, border-color 0.15s ease, background 0.15s ease;
        }
        .pol-tab .pol-num {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.84rem;
          color: var(--slate);
        }
        .pol-tab[data-active="true"] {
          color: #243746;
          background: linear-gradient(180deg, #f5b47a 0%, #f29b66 100%);
          border-color: var(--tip);
        }
        .pol-tab[data-active="true"] .pol-num { color: rgba(38,59,74,0.78); }
        .pol-tab:hover:not([data-active="true"]) {
          border-color: var(--tip);
          color: var(--parchment);
        }
        .pol-tab:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }

        .pol-nav { display: flex; gap: 0.35rem; }
        .pol-nav button {
          border: 1px solid var(--panel-line);
          background: rgba(255,255,255,0.68);
          color: var(--muted);
          width: 2.55rem;
          height: 2.55rem;
          display: grid;
          place-items: center;
          cursor: pointer;
        }
        .pol-nav button:hover:not(:disabled) { color: var(--parchment); border-color: var(--slate); }
        .pol-nav button:disabled { opacity: 0.48; cursor: default; }
        .pol-nav button:focus-visible { outline: 2px solid var(--teal); outline-offset: 2px; }

        .pol-mode-toggle {
          display: flex;
          gap: 0.4rem;
          margin: 0.18rem 0 0.55rem;
          flex: 0 0 auto;
        }
        .pol-mode-btn {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.88rem;
          letter-spacing: 0.055em;
          padding: 0.42rem 0.68rem;
          border: 1px solid rgba(89,106,122,0.20);
          background: rgba(255,255,255,0.46);
          color: #6f8291;
          cursor: pointer;
          font-weight: 500;
          transition:
            color 0.15s ease,
            border-color 0.15s ease,
            background 0.15s ease,
            box-shadow 0.15s ease;
        }
        .pol-mode-btn[data-active="true"] {
          border-color: rgba(242,155,102,0.72);
          color: #d96f2b;
          background: rgba(255,244,234,0.88);
          box-shadow: inset 0 -2px 0 rgba(242,155,102,0.42);
          font-weight: 600;
        }
        .pol-mode-btn:hover:not([data-active="true"]) {
          color: #536d80;
          border-color: rgba(242,155,102,0.42);
          background: rgba(255,255,255,0.72);
        }
        .pol-mode-btn:focus-visible {
          outline: 2px solid rgba(242,155,102,0.78);
          outline-offset: 2px;
        }

        .pol-explanation-zone {
          width: 100%;
          height: 8.9rem;
          box-sizing: border-box;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          justify-content: flex-start;
        }

        .pol-instructions {
          color: #435d6f;
          font-size: 1.10rem;
          line-height: 1.5;
          margin: 0;
          max-width: none;
          width: 100%;
          box-sizing: border-box;
        }

        .pol-explanation-copy {
          flex: 1 1 auto;
          display: flex;
          align-items: center;
          min-height: 0;
        }
        .pol-instructions strong {
          color: #263b4a;
          font-weight: 600;
        }

        .pol-stat-label {
          font-size: 0.80rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--slate);
          margin-bottom: 0.2rem;
        }
        .pol-stat-value { font-size: 1.24rem; color: var(--parchment); }
        .pol-stat-value.accent { color: var(--teal); }

        .pol-lab-handoff {
          margin-top: 2rem;
          padding: 1.35rem 1.4rem;
          border: 1px solid var(--panel-line);
          background: rgba(255,255,255,0.86);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 1.25rem;
          flex-wrap: wrap;
        }
        .pol-lab-handoff-copy {
          max-width: none;
          flex: 1 1 520px;
        }
        .pol-lab-handoff-kicker {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 0.82rem;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: var(--teal);
          margin: 0 0 0.35rem;
        }
        .pol-lab-handoff-title {
          font-family: 'Fraunces', serif;
          font-size: 1.38rem;
          font-weight: 520;
          color: var(--parchment);
          margin: 0 0 0.35rem;
        }
        .pol-lab-handoff-text {
          color: #496172;
          font-size: 1.06rem;
          line-height: 1.5;
          margin: 0;
        }
        .pol-lab-handoff-button {
          border: 1px solid var(--tip);
          background: linear-gradient(180deg, #f5b47a 0%, #f29b66 100%);
          color: #243746;
          font-family: 'IBM Plex Sans', sans-serif;
          font-size: 1.02rem;
          font-weight: 600;
          padding: 0.86rem 1.2rem;
          cursor: pointer;
          white-space: nowrap;
        }
        .pol-lab-handoff-button:hover { filter: brightness(1.05); }
        .pol-lab-handoff-button:focus-visible {
          outline: 2px solid var(--teal);
          outline-offset: 3px;
        }

        @media (max-width: 760px) {
          .pol-explanation-zone {
            height: auto;
            overflow: visible;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .pol-tab, .pol-nav button { transition: none; }
        }
      `}</style>

      <div className="pol-wrap">
        <h1 className="pol-title">
          Why a pinhole makes <em>a picture</em>
        </h1>
        <p className="pol-sub">
          Light arriving at the sunflower is reflected in every direction at once.
          Nearly all of it misses the small pinhole – only the rays that happen to
          pass through the hole can reach the screen. Use the controls below to
          explore how an image is formed on the screen.
        </p>

        <div className="pol-stage">
          <svg
            ref={svgRef}
            className="pol-svg"
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            role="img"
            aria-label="Interactive diagram of light rays travelling from a sunflower through a pinhole to a screen"
          >
            <defs>
              <filter id="pol-glow" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="3.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <linearGradient id="pol-petal-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#E7A91A" />
                <stop offset="30%" stopColor="#FFD43B" />
                <stop offset="70%" stopColor="#FFE066" />
                <stop offset="100%" stopColor="#D99613" />
              </linearGradient>
              <linearGradient id="pol-stem-gradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#287A35" />
                <stop offset="25%" stopColor="#55A84F" />
                <stop offset="50%" stopColor="#70C766" />
                <stop offset="75%" stopColor="#55A84F" />
                <stop offset="100%" stopColor="#287A35" />
              </linearGradient>
              <radialGradient id="pol-center-gradient" cx="38%" cy="30%" r="70%">
                <stop offset="0%" stopColor="#E39A3A" />
                <stop offset="20%" stopColor="#C87520" />
                <stop offset="55%" stopColor="#A85C16" />
                <stop offset="82%" stopColor="#7A3F0C" />
                <stop offset="100%" stopColor="#4E2507" />
              </radialGradient>
              <linearGradient id="pol-leaf-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#70C766" />
                <stop offset="55%" stopColor="#4CAF50" />
                <stop offset="100%" stopColor="#287A35" />
              </linearGradient>
              <filter id="pol-soft-shadow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.5" />
              </filter>
              <filter id="pol-cone-soft" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.2" />
              </filter>




            </defs>

            {/* room */}
            <rect x="0" y="0" width={VB_W} height={VB_H} fill="#15120d" />

            {/* sunflower: flower head / stem / pot – flat colours (HEAD_HEX/STEM_HEX/POT_HEX)
                are reserved for ray tinting; the artwork itself uses richer gradients */}
            <SunflowerArt />

            {/* fixed reference points: flower top & pot base
                Hidden in Step 01 so the draggable source point is the only
                visible source marker in that view. */}
            {step !== 0 && (
              <>
                <circle
                  cx={TIP.x}
                  cy={TIP.y}
                  r="3"
                  fill={rgbStr(colorForY(TIP.y))}
                  opacity="0.7"
                />
                <circle
                  cx={BASE.x}
                  cy={BASE.y}
                  r="3"
                  fill={rgbStr(colorForY(BASE.y))}
                  opacity="0.7"
                />
              </>
            )}

            {/* freely draggable source point (step 1 only) */}
            {step === 0 && (
              <g>
                <rect
                  className="pol-svg-control"
                  x={SOURCE_X - 28}
                  y={sourceY - 38}
                  width="56"
                  height="76"
                  rx="24"
                  fill="rgba(255,255,255,0.001)"
                  pointerEvents="all"
                  tabIndex={0}
                  role="slider"
                  aria-label="Sunflower source point"
                  aria-orientation="vertical"
                  aria-valuemin={0}
                  aria-valuemax={Math.round(POT_BOTTOM - PETAL_TOP - 4)}
                  aria-valuenow={Math.round(POT_BOTTOM - 2 - sourceY)}
                  aria-valuetext={`Source point at ${Math.round(sourceY)} pixels from the top`}
                  onKeyDown={(e) => {
                    let nextY = sourceY;

                    if (e.key === "ArrowUp") nextY -= 6;
                    else if (e.key === "ArrowDown") nextY += 6;
                    else if (e.key === "Home") nextY = PETAL_TOP + 2;
                    else if (e.key === "End") nextY = POT_BOTTOM - 2;
                    else return;

                    e.preventDefault();
                    setSourceY(
                      clamp(
                        nextY,
                        PETAL_TOP + 2,
                        POT_BOTTOM - 2
                      )
                    );
                  }}
                  style={{
                    cursor: "ns-resize",
                    touchAction: "none",
                  }}
                  {...dragProps((p) => {
                    setSourceY(clamp(p.y, PETAL_TOP + 2, POT_BOTTOM - 2));
                  })}
                />
                <circle
                  cx={SOURCE_X}
                  cy={sourceY}
                  r="10"
                  fill={sourceColor}
                  stroke="#15120d"
                  strokeWidth="2"
                  pointerEvents="none"
                />
              </g>
            )}

            {/* strictly 2D pinhole wall – shared by all three steps */}
            <>
              <rect
                x={WALL_X - 6}
                y={WALL_TOP}
                width="12"
                height={apTop - WALL_TOP}
                fill="#3c4652"
              />
              <rect
                x={WALL_X - 6}
                y={apBottom}
                width="12"
                height={WALL_BOTTOM - apBottom}
                fill="#3c4652"
              />
            </>

            {/* screen */}
            {step === 2 ? (
              <g>
                {/*
                   In the final 2D step, show the screen at a deliberately
                   shallow viewing angle. This is a visual cheat only:
                   all ray/image calculations still use the true screenX.
                */}
                <polygon
                  points={`
                    ${stepScreenX + 2},${WALL_TOP}
                    ${stepScreenX - 28},${WALL_TOP + 8}
                    ${stepScreenX - 28},${WALL_BOTTOM - 8}
                    ${stepScreenX + 2},${WALL_BOTTOM}
                  `}
                  fill="#ffffff"
                  stroke="#aeb8c2"
                  strokeWidth="2"
                  opacity="1"
                />
                <line
                  x1={stepScreenX + 2}
                  y1={WALL_TOP}
                  x2={stepScreenX + 2}
                  y2={WALL_BOTTOM}
                  stroke="#8f9ba6"
                  strokeWidth="2.5"
                />
              </g>
            ) : (
              <line
                x1={stepScreenX}
                y1={WALL_TOP}
                x2={stepScreenX}
                y2={WALL_BOTTOM}
                stroke="#ffffff"
                strokeWidth="3"
              />
            )}

            {/* ---------------- STEP 1: three draggable gates ---------------- */}
            {step === 0 && !coneMode &&
              gateRays.map((r, i) => {
                const color = sourceColor;
                return (
                  <g key={i}>
                    <line x1={source.x} y1={source.y} x2={r.gate.x} y2={r.gate.y}
                      stroke={color} strokeWidth="1.4" opacity="0.85" filter="url(#pol-glow)" />
                    {r.throughHole ? (
                      <>
                        <line
                          x1={r.gate.x}
                          y1={r.gate.y}
                          x2={stepScreenX}
                          y2={r.landY}
                          stroke={color}
                          strokeWidth="1.4"
                          opacity="0.85"
                          filter="url(#pol-glow)"
                        />
                        <circle
                          cx={stepScreenX}
                          cy={r.landY}
                          r="4"
                          fill={color}
                        />
                      </>
                    ) : r.clearsAboveWall ? (
                      <line
                        x1={r.gate.x}
                        y1={r.gate.y}
                        x2={r.exitXTop}
                        y2={0}
                        stroke={color}
                        strokeWidth="1.4"
                        opacity="0.85"
                        filter="url(#pol-glow)"
                      />
                    ) : r.clearsBelowWall ? (
                      <line
                        x1={r.gate.x}
                        y1={r.gate.y}
                        x2={r.exitXBottom}
                        y2={VB_H}
                        stroke={color}
                        strokeWidth="1.4"
                        opacity="0.85"
                        filter="url(#pol-glow)"
                      />
                    ) : (
                      <circle
                        cx={r.gate.x}
                        cy={r.gate.y}
                        r="3.5"
                        fill="#15120d"
                        stroke={color}
                        strokeWidth="1.5"
                      />
                    )}
                    <rect
                      className="pol-svg-control"
                      x={
                        rayHandlePositions[
                          i
                        ].x - 30
                      }
                      y={
                        rayHandlePositions[
                          i
                        ].y - 42
                      }
                      width="60"
                      height="84"
                      rx="26"
                      fill="rgba(255,255,255,0.001)"
                      pointerEvents="all"
                      tabIndex={0}
                      role="slider"
                      aria-label={`Ray ${i + 1} aim point`}
                      aria-orientation="vertical"
                      aria-valuemin={-180}
                      aria-valuemax={VB_H + 180}
                      aria-valuenow={Math.round(gates[i])}
                      aria-valuetext={`Ray ${i + 1} aims at ${Math.round(gates[i])} pixels from the top of the wall`}
                      onKeyDown={(e) => {
                        let nextGate = gates[i];

                        if (e.key === "ArrowUp") nextGate -= 10;
                        else if (e.key === "ArrowDown") nextGate += 10;
                        else if (e.key === "Home") nextGate = -180;
                        else if (e.key === "End") nextGate = VB_H + 180;
                        else return;

                        e.preventDefault();

                        const y = clamp(
                          nextGate,
                          -180,
                          VB_H + 180
                        );

                        setGates((g) =>
                          g.map((v, idx) =>
                            idx === i ? y : v
                          )
                        );
                      }}
                      style={{
                        cursor: "ns-resize",
                        touchAction: "none",
                      }}
                      {...dragProps((p) => {
                        const handle =
                          rayHandlePositions[
                            i
                          ];

                        /*
                           Convert the dragged handle Y back into the
                           corresponding wall/aperture-plane Y so the ray
                           still pivots correctly through the chosen point
                           on the wall.
                        */
                        const gateY =
                          source.y +
                          (p.y -
                            source.y) /
                            handle.alpha;

                        const y =
                          clamp(
                            gateY,
                            -180,
                            VB_H +
                              180
                          );

                        setGates(
                          (g) =>
                            g.map(
                              (
                                v,
                                idx
                              ) =>
                                idx ===
                                i
                                  ? y
                                  : v
                            )
                        );
                      })}
                    />
                    <circle
                      cx={
                        rayHandlePositions[
                          i
                        ].x
                      }
                      cy={
                        rayHandlePositions[
                          i
                        ].y
                      }
                      r="11"
                      fill="#15120d"
                      stroke="#ece3ce"
                      strokeWidth="1.7"
                      pointerEvents="none"
                    />
                  </g>
                );
              })}

            {/* ---------------- STEP 1: cone-of-light mode ---------------- */}
            {step === 0 && coneMode && (
              <>
                {/* One light shape only: no stacked translucent cones. */}
                <path
                  d={step1LightPath}
                  fill={coneColor}
                  opacity="0.34"
                  filter="url(#pol-cone-soft)"
                  fillRule="nonzero"
                />

                <rect
                  x={stepScreenX - 6}
                  y={Math.min(beamScreenTop, beamScreenBottom)}
                  width="12"
                  height={Math.max(Math.abs(beamScreenBottom - beamScreenTop), 2)}
                  fill={coneColor}
                  opacity="0.58"
                  filter="url(#pol-cone-soft)"
                />

                {/* Repaint the solid wall over the softened light so the blocked
                    portions stay clean while the aperture remains open. */}
                <rect
                  x={WALL_X - 6}
                  y={WALL_TOP}
                  width="12"
                  height={apTop - WALL_TOP}
                  fill="#3c4652"
                />
                <rect
                  x={WALL_X - 6}
                  y={apBottom}
                  width="12"
                  height={WALL_BOTTOM - apBottom}
                  fill="#3c4652"
                />
              </>
            )}

            {/* ---------------- STEP 2: 10-point fan + aperture handle ---------------- */}
            {step === 1 && (
              <>
                {plantFans.map((f, pi) =>
                  gateSampleYs.map((gy, i) => (
                    <g key={`${pi}-${i}`}>
                      <line x1={f.pt.x} y1={f.pt.y} x2={WALL_X} y2={gy} stroke={f.pt.color} strokeWidth="1" opacity="0.16" />
                      <line x1={WALL_X} y1={gy} x2={stepScreenX} y2={f.landings[i]} stroke={f.pt.color} strokeWidth="1" opacity="0.16" />
                    </g>
                  ))
                )}
                {plantPoints.map((pt, i) => (
                  <circle key={i} cx={pt.x} cy={pt.y} r="2.5" fill={pt.color} />
                ))}
                {plantFans.map((f, i) => (
                  <rect key={i} x={stepScreenX - 3.5} y={Math.min(...f.landings)} width="7" height={Math.max(f.spread, 1)} fill={f.pt.color} opacity="0.6" />
                ))}

                {/* aperture size handle, positioned just above the hole */}
                <line
                  x1={WALL_X}
                  y1={apTop}
                  x2={apertureHandle.x - 10}
                  y2={apertureHandle.y + 8}
                  stroke="#7a8f9f"
                  strokeWidth="1.4"
                  strokeDasharray="4 4"
                  opacity="0.8"
                />

                <rect
                  className="pol-svg-control"
                  x={apertureHandle.x - 28}
                  y={apertureHandle.y - 22}
                  width="56"
                  height="44"
                  rx="18"
                  fill="rgba(255,255,255,0.001)"
                  pointerEvents="all"
                  tabIndex={0}
                  role="slider"
                  aria-label="Hole diameter"
                  aria-orientation="vertical"
                  aria-valuemin={8}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(apertureHalf * 2)}
                  aria-valuetext={`${Math.round(apertureHalf * 2)} pixels`}
                  onKeyDown={(e) => {
                    let nextHalf = apertureHalf;

                    if (e.key === "ArrowUp" || e.key === "ArrowRight") nextHalf += 2;
                    else if (e.key === "ArrowDown" || e.key === "ArrowLeft") nextHalf -= 2;
                    else if (e.key === "Home") nextHalf = 4;
                    else if (e.key === "End") nextHalf = 50;
                    else return;

                    e.preventDefault();
                    setApertureHalf(
                      clamp(
                        nextHalf,
                        4,
                        50
                      )
                    );
                  }}
                  style={{
                    cursor: "ns-resize",
                    touchAction: "none",
                  }}
                  {...dragProps((p) => {
                    const nextTop =
                      clamp(
                        p.y + 18,
                        WALL_TOP + 4,
                        APERTURE_CENTER - 4
                      );

                    setApertureHalf(
                      clamp(
                        APERTURE_CENTER - nextTop,
                        4,
                        50
                      )
                    );
                  })}
                />

                <circle
                  cx={apertureHandle.x}
                  cy={apertureHandle.y}
                  r="11"
                  fill="#15120d"
                  stroke="#ece3ce"
                  strokeWidth="1.7"
                  pointerEvents="none"
                />
              </>
            )}

            {/* ---------------- STEP 3: central rays + image ---------------- */}
            {step === 2 && (
              <>
                <line x1={TIP.x} y1={TIP.y} x2={WALL_X} y2={APERTURE_CENTER} stroke={rgbStr(colorForY(TIP.y))} strokeWidth="1.6" filter="url(#pol-glow)" />
                <line x1={WALL_X} y1={APERTURE_CENTER} x2={stepScreenX - 13} y2={tipImageY} stroke={rgbStr(colorForY(TIP.y))} strokeWidth="1.6" opacity="0.85" />
                <line x1={BASE.x} y1={BASE.y} x2={WALL_X} y2={APERTURE_CENTER} stroke={rgbStr(colorForY(BASE.y))} strokeWidth="1.6" filter="url(#pol-glow)" />
                <line x1={WALL_X} y1={APERTURE_CENTER} x2={stepScreenX - 13} y2={baseImageY} stroke={rgbStr(colorForY(BASE.y))} strokeWidth="1.6" opacity="0.85" />

                {/* inverted image – a very thin, upside-down projection of the sunflower itself */}
                <rect
                  x={stepScreenX - 22}
                  y={Math.min(tipImageY, baseImageY)}
                  width="18"
                  height={Math.max(Math.abs(baseImageY - tipImageY), 4)}
                  fill="#ffffff"
                  opacity="0.22"
                />
                <g
                  transform={`translate(${stepScreenX - 13} ${tipImageY}) scale(0.16 ${(baseImageY - tipImageY) / (POT_BOTTOM - HEAD_TOP)}) translate(${-SOURCE_X} ${-HEAD_TOP})`}
                  opacity="0.9"
                >
                  <SunflowerArt />
                </g>
                <circle cx={stepScreenX - 13} cy={tipImageY} r="4" fill={rgbStr(colorForY(TIP.y))} />
                <circle cx={stepScreenX - 13} cy={baseImageY} r="4" fill={rgbStr(colorForY(BASE.y))} />

                <rect
                  className="pol-svg-control"
                  x={stepScreenX - 38}
                  y={42}
                  width="80"
                  height="56"
                  rx="24"
                  fill="rgba(255,255,255,0.001)"
                  pointerEvents="all"
                  tabIndex={0}
                  role="slider"
                  aria-label="Screen position"
                  aria-orientation="horizontal"
                  aria-valuemin={SCREEN_MIN}
                  aria-valuemax={SCREEN_MAX}
                  aria-valuenow={Math.round(screenX)}
                  aria-valuetext={`${Math.round(screenX - WALL_X)} pixels from the pinhole`}
                  onKeyDown={(e) => {
                    let nextX = screenX;

                    if (e.key === "ArrowLeft") nextX -= 10;
                    else if (e.key === "ArrowRight") nextX += 10;
                    else if (e.key === "Home") nextX = SCREEN_MIN;
                    else if (e.key === "End") nextX = SCREEN_MAX;
                    else return;

                    e.preventDefault();
                    setScreenX(
                      clamp(
                        nextX,
                        SCREEN_MIN,
                        SCREEN_MAX
                      )
                    );
                  }}
                  style={{
                    cursor: "ew-resize",
                    touchAction: "none",
                  }}
                  {...dragProps((p) => {
                    setScreenX(clamp(p.x, SCREEN_MIN, SCREEN_MAX));
                  })}
                />
                <circle
                  cx={stepScreenX + 2}
                  cy={70}
                  r="11"
                  fill="#15120d"
                  stroke="#ece3ce"
                  strokeWidth="1.8"
                  pointerEvents="none"
                />
              </>
            )}

            {/* Contextual apparatus labels:
                01 = pinhole + screen
                02 = pinhole
                03 = screen */}
            {(step === 0 || step === 1) && (
              <g pointerEvents="none">
                <line
                  x1={step === 0 && !coneMode ? WALL_X + 68 : WALL_X - 68}
                  y1={APERTURE_CENTER - 25}
                  x2={step === 0 && !coneMode ? WALL_X + 10 : WALL_X - 10}
                  y2={APERTURE_CENTER - 6}
                  stroke="#b9c7d2"
                  strokeWidth="1.4"
                  opacity="0.9"
                />
                <text
                  x={step === 0 && !coneMode ? WALL_X + 74 : WALL_X - 74}
                  y={APERTURE_CENTER - 30}
                  textAnchor={step === 0 && !coneMode ? "start" : "end"}
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="14"
                  fontWeight="500"
                  letterSpacing="0.06em"
                  fill="#dce6ee"
                >
                  PINHOLE
                </text>
              </g>
            )}

            {(step === 0 || step === 2) && (
              <g pointerEvents="none">
                <line
                  x1={step === 2 ? stepScreenX - 13 : stepScreenX}
                  y1={WALL_TOP - 3}
                  x2={step === 2 ? stepScreenX - 13 : stepScreenX}
                  y2={WALL_TOP + 12}
                  stroke="#b9c7d2"
                  strokeWidth="1.4"
                  opacity="0.9"
                />
                <text
                  x={step === 2 ? stepScreenX - 13 : stepScreenX}
                  y={WALL_TOP - 10}
                  textAnchor="middle"
                  fontFamily="IBM Plex Mono, monospace"
                  fontSize="14"
                  fontWeight="500"
                  letterSpacing="0.06em"
                  fill="#dce6ee"
                >
                  SCREEN
                </text>
              </g>
            )}

          </svg>
        </div>


        <div className="pol-explanation-zone">
        {step === 0 && (
          <>
            <div className="pol-mode-toggle">
              <button
                type="button"
                className="pol-mode-btn"
                data-active={!coneMode}
                aria-pressed={!coneMode}
                onClick={() => setConeMode(false)}
              >
                THREE RAYS
              </button>
              <button
                type="button"
                className="pol-mode-btn"
                data-active={coneMode}
                aria-pressed={coneMode}
                onClick={() => setConeMode(true)}
              >
                CONE OF LIGHT
              </button>
            </div>
            <div className="pol-explanation-copy">
              {coneMode ? (
                <p className="pol-instructions">
                  Every point on the sunflower throws light in every direction – shown
                  here as a wide 120° cone. Drag the <strong>coloured handle</strong> to
                  examine the light coming from any point on the sunflower – flower,
                  stem or pot. Most of that light hits the solid wall and stops there.
                  Light aimed above or below the wall keeps travelling, while the narrow
                  sliver lined up with the opening passes through the pinhole and spreads
                  back out toward the screen.
                </p>
              ) : (
                <p className="pol-instructions">
                  Every point on the sunflower throws light in every direction. Drag
                  the <strong>coloured handle</strong> to examine the light coming from
                  any point on the sunflower – flower, stem or pot. Then drag the{" "}
                  <strong>three rays</strong> to aim them at different points on the wall.
                  Line one up with the opening and its ray sails straight through to
                  the screen, coloured according to the point it came from. Miss the
                  opening and the ray simply stops – blocked by the wall.
                </p>
              )}
            </div>
          </>
        )}

        {step === 1 && (
          <div className="pol-explanation-copy">
            <p className="pol-instructions">
              Ten points run evenly from flower to pot, each firing its own
              fan of rays, coloured to match. Drag the <strong>handle above the hole</strong>{" "}
              to widen or narrow the opening. A wide hole lets a broad fan
              through from every point – they land as overlapping smears, not
              points. Shrink it down and watch all ten pull into sharp, separate
              dots.
            </p>
          </div>
        )}

        {step === 2 && (
          <div className="pol-explanation-copy">
            <p className="pol-instructions">
              With the hole pinned small, only one ray per point gets through –
              so the sunflower's tip and base each land as a crisp point, flipped
              top-to-bottom. Drag the <strong>screen</strong> back and forth to
              see the image grow and shrink.
            </p>
          </div>
        )}

        </div>

        <div className="pol-tabs" role="group" aria-label="Walkthrough steps">
          {STEPS.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-current={step === i ? "step" : undefined}
              className="pol-tab"
              data-active={step === i}
              onClick={() => setStep(i)}
            >
              <span className="pol-num">0{i + 1}</span>
              {s.label}
            </button>
          ))}

          {step === 1 && (
            <div className="pol-inline-stats" aria-label="Resize the hole measurements">
              <div className="pol-inline-stat">
                <span className="pol-stat-label">Hole diameter</span>
                <span className="pol-stat-value">{(apertureHalf * 2).toFixed(0)} px</span>
              </div>
              <div className="pol-inline-stat">
                <span className="pol-stat-label">Image blur</span>
                <span className="pol-stat-value accent">{imageBlur.toFixed(0)} px</span>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="pol-inline-stats" aria-label="Move the screen measurements">
              <div className="pol-inline-stat">
                <span className="pol-stat-label">Screen distance</span>
                <span className="pol-stat-value">{(stepScreenX - WALL_X).toFixed(0)} px</span>
              </div>
              <div className="pol-inline-stat">
                <span className="pol-stat-label">Image height</span>
                <span className="pol-stat-value accent">{imageHeight.toFixed(0)} px</span>
              </div>
              <div className="pol-inline-stat">
                <span className="pol-stat-label">Scale vs. sunflower</span>
                <span className="pol-stat-value">{scaleRatio.toFixed(2)}×</span>
              </div>
            </div>
          )}

          <div
            className="pol-nav"
            role="group"
            aria-label="Previous and next step"
            style={{ marginLeft: "auto" }}
          >
            <button
              type="button"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={step === 0}
              aria-label="Previous step"
            >
              <ChevronLeft size={21} />
            </button>
            <button
              type="button"
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              disabled={step === STEPS.length - 1}
              aria-label="Next step"
            >
              <ChevronRight size={21} />
            </button>
          </div>
        </div>

        <div className="pol-lab-handoff">
          <div className="pol-lab-handoff-copy">
            <p className="pol-lab-handoff-kicker">Final chapter · 3D Lab</p>
            <p className="pol-lab-handoff-title">Put the whole camera obscura together</p>
            <p className="pol-lab-handoff-text">
              You have traced individual rays, changed the aperture, and moved the
              screen. Now explore those ideas together in the complete 3D system.
            </p>
          </div>
          <button
            type="button"
            className="pol-lab-handoff-button"
            onClick={onOpen3D}
          >
            Explore in 3D →
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   LAYERS

   0 = actual optical object
   1 = rays
   2 = wall / screen / ground
========================================================= */

const OBJECT_LAYER = 0;
const RAY_LAYER = 1;
const APPARATUS_LAYER = 2;
const PROJECTION_ONLY_LAYER = 3;
const MARKER_LAYER = 4;

const IDEAL_PINHOLE_SLIDER_VALUE = 0.04;
const IDEAL_PINHOLE_VISUAL_DIAMETER = 0.05;

/* =========================================================
   CONSTANTS
========================================================= */

const PETAL_COUNT = 24;

const FLOWER_CENTER_RADIUS = 0.43;
const PETAL_ROOT_RADIUS = 0.48;

const FLOWER_POSITION = new THREE.Vector3(
  0,
  3.90,
  0.60
);

const PETAL_COLOR = "#f5b400";
const CENTRE_COLOR = "#593318";
const LEAF_COLOR = "#397d2f";
const STEM_COLOR = "#3f8635";
const POT_COLOR = "#c65f38";

/* =========================================================
   YELLOW PETAL
========================================================= */

function Petal({ angle }) {
  const radius = PETAL_ROOT_RADIUS;

  const x = Math.cos(angle);
  const y = Math.sin(angle);

  return (
    <mesh
      position={[
        x * radius,
        y * radius,
        0.30,
      ]}
      rotation={[
        y * 0.30,
        -x * 0.30,
        angle - Math.PI / 2,
      ]}
      scale={[
        0.25,
        0.72,
        0.11,
      ]}
    
      castShadow
    >
      <sphereGeometry
        args={[1, 20, 12]}
      />

      <meshStandardMaterial
        color={PETAL_COLOR}
        roughness={0.75}
      />
    </mesh>
  );
}

/* =========================================================
   GREEN REAR BRACT
========================================================= */

function RearBract({ angle }) {
  return (
    <group
      rotation={[
        0,
        0,
        angle,
      ]}
    >
      <mesh
        position={[
          0,
          -0.43,
          -0.18,
        ]}
        rotation={[
          -Math.PI * 0.32,
          0,
          0,
        ]}
        scale={[
          0.16,
          0.58,
          0.10,
        ]}
      
      castShadow
    >
        <sphereGeometry
          args={[1, 16, 10]}
        />

        <meshStandardMaterial
          color={LEAF_COLOR}
          roughness={0.9}
        />
      </mesh>
    </group>
  );
}

/* =========================================================
   LEAF
========================================================= */

function Leaf({
  position,
  rotationZ,
  length = 1.05,
}) {
  const centrePoints = useMemo(
    () => [
      new THREE.Vector3(
        0,
        0,
        0.045
      ),
      new THREE.Vector3(
        0,
        length * 0.20,
        0.10
      ),
      new THREE.Vector3(
        0,
        length * 0.52,
        0.17
      ),
      new THREE.Vector3(
        0,
        length * 0.78,
        0.23
      ),
      new THREE.Vector3(
        0,
        length,
        0.29
      ),
    ],
    [length]
  );

  const geometry = useMemo(() => {
    const geometry =
      new THREE.BufferGeometry();

    const vertices =
      new Float32Array([
        0.00, 0.00, 0.00,

        -0.10,
        length * 0.20,
        0.055,

        0.10,
        length * 0.20,
        0.055,

        -0.23,
        length * 0.52,
        0.12,

        0.23,
        length * 0.52,
        0.12,

        -0.18,
        length * 0.78,
        0.18,

        0.18,
        length * 0.78,
        0.18,

        0.00,
        length,
        0.24,
      ]);

    const indices = [
      0, 1, 2,

      1, 3, 4,
      1, 4, 2,

      3, 5, 6,
      3, 6, 4,

      5, 7, 6,
    ];

    geometry.setAttribute(
      "position",
      new THREE.BufferAttribute(
        vertices,
        3
      )
    );

    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    return geometry;
  }, [length]);

  const veinGeometry = useMemo(() => {
    const curve =
      new THREE.CatmullRomCurve3(
        centrePoints
      );

    const geometry =
      new THREE.TubeGeometry(
        curve,
        16,
        0.018,
        6,
        false
      );

    geometry.translate(
      0,
      0,
      -0.032
    );

    return geometry;
  }, [centrePoints]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      veinGeometry.dispose();
    };
  }, [
    geometry,
    veinGeometry,
  ]);

  return (
    <group
      position={position}
      rotation={[
        0,
        0,
        rotationZ,
      ]}
    >
      <mesh
        geometry={geometry}
      
      castShadow
    >
        <meshStandardMaterial
          color={LEAF_COLOR}
          roughness={0.9}
          side={THREE.DoubleSide}
        />
      </mesh>

      <mesh
        geometry={veinGeometry}
      
      castShadow
    >
        <meshStandardMaterial
          color={LEAF_COLOR}
          roughness={0.9}
        />
      </mesh>
    </group>
  );
}

/* =========================================================
   SUNFLOWER SEED
========================================================= */

function Seed({
  position,
  rotation,
}) {
  return (
    <mesh
      position={position}
      rotation={rotation}
      scale={[
        0.030,
        0.052,
        0.014,
      ]}
    
      castShadow
    >
      <sphereGeometry
        args={[1, 8, 6]}
      />

      <meshStandardMaterial
        color="#21130c"
        roughness={0.8}
      />
    </mesh>
  );
}

/* =========================================================
   SPIRAL SEED HEAD
========================================================= */

function SeedHead() {
  const seedCount = 80;

  const goldenAngle =
    Math.PI *
    (3 - Math.sqrt(5));

  const seeds = [];

  const radiusX = 0.43;
  const radiusY = 0.43;
  const radiusZ = 0.18;

  const maxRadius = 0.40;

  for (
    let i = 0;
    i < seedCount;
    i++
  ) {
    const radius =
      maxRadius *
      Math.sqrt(
        (i + 0.5) /
          seedCount
      );

    const angle =
      i * goldenAngle;

    const x =
      Math.cos(angle) *
      radius;

    const y =
      Math.sin(angle) *
      radius;

    const surfaceFactor =
      1 -
      (x * x) /
        (radiusX * radiusX) -
      (y * y) /
        (radiusY * radiusY);

    const z =
      radiusZ *
      Math.sqrt(
        Math.max(
          0,
          surfaceFactor
        )
      );

    const seedZ =
      0.38 +
      z +
      0.006;

    const normal =
      new THREE.Vector3(
        x /
          (radiusX * radiusX),
        y /
          (radiusY * radiusY),
        z /
          (radiusZ * radiusZ)
      ).normalize();

    const tangent =
      new THREE.Vector3(
        -Math.sin(angle),
        Math.cos(angle),
        0
      );

    tangent
      .addScaledVector(
        normal,
        -tangent.dot(normal)
      )
      .normalize();

    const bitangent =
      new THREE.Vector3()
        .crossVectors(
          normal,
          tangent
        )
        .normalize();

    const rotationMatrix =
      new THREE.Matrix4();

    rotationMatrix.makeBasis(
      tangent,
      bitangent,
      normal
    );

    const quaternion =
      new THREE.Quaternion()
        .setFromRotationMatrix(
          rotationMatrix
        );

    seeds.push(
      <Seed
        key={i}
        position={[
          x,
          y,
          seedZ,
        ]}
        rotation={
          new THREE.Euler().setFromQuaternion(
            quaternion
          )
        }
      />
    );
  }

  return <>{seeds}</>;
}

/* =========================================================
   SUNFLOWER
========================================================= */

function Sunflower({
  sunflowerRef,
}) {
  const petalCount =
    PETAL_COUNT;

  const bractCount = 14;

  const stemLean =
    THREE.MathUtils.degToRad(-5);

  return (
    <group
      ref={sunflowerRef}
      rotation={[
        stemLean,
        0,
        0,
      ]}
    >
      {/* MAIN STEM */}

      <mesh
        position={[
          0,
          1.65,
          0,
        ]}
      
      castShadow
    >
        <cylinderGeometry
          args={[
            0.075,
            0.105,
            4.5,
            18,
          ]}
        />

        <meshStandardMaterial
          color={STEM_COLOR}
          roughness={0.85}
        />
      </mesh>

      {/* LEFT LEAF */}

      <Leaf
        position={[
          0,
          1.34,
          0.02,
        ]}
        rotationZ={
          THREE.MathUtils.degToRad(
            -55
          )
        }
        length={1.05}
      />

      {/* RIGHT LEAF */}

      <Leaf
        position={[
          0,
          1.82,
          0.02,
        ]}
        rotationZ={
          THREE.MathUtils.degToRad(
            55
          )
        }
        length={1.00}
      />

      {/* FORWARD NECK */}

      <group
        position={[
          0,
          3.90,
          0,
        ]}
      >
        <mesh
          position={[
            0,
            0,
            0.38,
          ]}
          rotation={[
            -Math.PI / 2,
            0,
            0,
          ]}
        
      castShadow
    >
          <cylinderGeometry
            args={[
              0.085,
              0.10,
              0.85,
              18,
            ]}
          />

          <meshStandardMaterial
            color={STEM_COLOR}
            roughness={0.85}
          />
        </mesh>
      </group>

      {/* FLOWER HEAD */}

      <group
        position={[
          0,
          3.90,
          0.60,
        ]}
      >
        {/* GREEN BACK */}

        <mesh
          position={[
            0,
            0,
            -0.20,
          ]}
          scale={[
            0.66,
            0.66,
            0.32,
          ]}
        
      castShadow
    >
          <sphereGeometry
            args={[1, 32, 20]}
          />

          <meshStandardMaterial
            color="#34752c"
            roughness={0.95}
          />
        </mesh>

        {/* REAR STEM / FLOWER RECEPTACLE HEMISPHERE */}

        <mesh
          position={[
            0,
            0,
            -0.43,
          ]}
          rotation={[
            -Math.PI / 2,
            0,
            0,
          ]}
          scale={[
            0.28,
            0.28,
            0.20,
          ]}
          castShadow
        >
          <sphereGeometry
            args={[
              1,
              28,
              14,
              0,
              Math.PI * 2,
              0,
              Math.PI / 2,
            ]}
          />

          <meshStandardMaterial
            color="#34752c"
            roughness={0.95}
            side={
              THREE.DoubleSide
            }
          />
        </mesh>

        {/* REAR BRACTS */}

        <group>
          {Array.from(
            {
              length:
                bractCount,
            },
            (_, i) => {
              const angle =
                (i /
                  bractCount) *
                Math.PI *
                2;

              return (
                <RearBract
                  key={i}
                  angle={angle}
                />
              );
            }
          )}
        </group>

        {/* PETALS */}

        <group>
          {Array.from(
            {
              length:
                petalCount,
            },
            (_, i) => {
              const angle =
                (i /
                  petalCount) *
                Math.PI *
                2;

              return (
                <Petal
                  key={i}
                  angle={angle}
                />
              );
            }
          )}
        </group>

        {/* BROWN CENTRE */}

        <mesh
          position={[
            0,
            0,
            0.38,
          ]}
          scale={[
            0.43,
            0.43,
            0.18,
          ]}
        
      castShadow
    >
          <sphereGeometry
            args={[1, 32, 20]}
          />

          <meshStandardMaterial
            color={CENTRE_COLOR}
            roughness={1}
          />
        </mesh>

        <SeedHead />
      </group>
    </group>
  );
}

/* =========================================================
   POT
========================================================= */

function Pot({ potRef }) {
  const potProfile = [
    [0.50, -0.45],
    [0.70, 0.85],
    [0.62, 0.85],
    [0.48, -0.35],
    [0.00, -0.35],
    [0.00, -0.45],
  ];

  const potGeometry =
    useMemo(
      () =>
        new THREE.LatheGeometry(
          potProfile.map(
            ([radius, height]) =>
              new THREE.Vector2(
                radius,
                height
              )
          ),
          48
        ),
      []
    );

  useEffect(() => {
    return () =>
      potGeometry.dispose();
  }, [potGeometry]);

  return (
    <group
      ref={potRef}
      position={[
        0,
        -0.25,
        0,
      ]}
    >
      {/* POT BODY */}

      <mesh
        geometry={potGeometry}
      
      castShadow
    >
        <meshStandardMaterial
          color={POT_COLOR}
          roughness={0.9}
        />
      </mesh>

      {/* POT BOTTOM */}

      <mesh
        position={[
          0,
          -0.43,
          0,
        ]}
        castShadow
      >
        <cylinderGeometry
          args={[
            0.50,
            0.50,
            0.04,
            48,
          ]}
        />

        <meshStandardMaterial
          color={POT_COLOR}
          roughness={0.9}
        />
      </mesh>

      {/* RIM */}

      <mesh
        position={[
          0,
          0.68,
          0,
        ]}
      
      castShadow
    >
        <cylinderGeometry
          args={[
            0.55,
            0.55,
            0.08,
            32,
          ]}
        />

        <meshStandardMaterial
          color="#4a2b18"
          roughness={1}
        />
      </mesh>

      {/* SOIL */}

      <mesh
        position={[
          0,
          0.735,
          0,
        ]}
        scale={[
          0.53,
          0.10,
          0.53,
        ]}
      
      castShadow
    >
        <sphereGeometry
          args={[1, 32, 8]}
        />

        <meshStandardMaterial
          color="#513019"
          roughness={1}
        />
      </mesh>
    </group>
  );
}

/* =========================================================
   RAY LINES
========================================================= */

function RayCylinderSegment({
  start,
  end,
  color,
  pixelWidth,
  opacity,
  thicknessReference,
}) {
  const meshRef =
    useRef(null);

  const {
    camera,
    size,
    gl,
  } = useThree();

  const midpoint =
    useMemo(
      () =>
        start
          .clone()
          .lerp(
            end,
            0.5
          ),
      [
        start,
        end,
      ]
    );

  const length =
    useMemo(
      () =>
        start.distanceTo(
          end
        ),
      [
        start,
        end,
      ]
    );

  const quaternion =
    useMemo(() => {
      const direction =
        new THREE.Vector3()
          .subVectors(
            end,
            start
          )
          .normalize();

      return new THREE.Quaternion()
        .setFromUnitVectors(
          new THREE.Vector3(
            0,
            1,
            0
          ),
          direction
        );
    }, [
      start,
      end,
    ]);

  /*
     Keep the cylinders at an approximately constant apparent
     thickness on screen as the camera zooms.

     The geometry itself has radius 1. On every frame we convert
     the requested physical-pixel width into world units at this
     segment's camera distance, then scale only the cylinder's
     local X/Z axes. Its Y axis (the ray length) is untouched.

     Using physical pixels here also makes the thinnest cylinders
     converge naturally toward WebGL's ~1-device-pixel line width.
  */
  useFrame(() => {
    const mesh =
      meshRef.current;

    if (!mesh) {
      return;
    }

    const pixelRatio =
      Math.max(
        gl.getPixelRatio(),
        1
      );

    const drawingHeight =
      Math.max(
        size.height *
          pixelRatio,
        1
      );

    let worldPerPixel =
      0.001;

    if (
      camera.isPerspectiveCamera
    ) {
      /*
         Both halves of one ray use the SAME reference point:
         the pinhole. That keeps the apparent diameter continuous
         through the aperture instead of letting the incoming and
         outgoing segment midpoints produce different widths.
      */
      const referencePoint =
        thicknessReference ||
        midpoint;

      const distance =
        Math.max(
          camera.position.distanceTo(
            referencePoint
          ),
          0.001
        );

      const effectiveFov =
        THREE.MathUtils.degToRad(
          camera.getEffectiveFOV
            ? camera.getEffectiveFOV()
            : camera.fov
        );

      const visibleWorldHeight =
        2 *
        distance *
        Math.tan(
          effectiveFov / 2
        );

      worldPerPixel =
        visibleWorldHeight /
        drawingHeight;
    } else if (
      camera.isOrthographicCamera
    ) {
      const visibleWorldHeight =
        Math.abs(
          camera.top -
            camera.bottom
        ) /
        Math.max(
          camera.zoom,
          0.001
        );

      worldPerPixel =
        visibleWorldHeight /
        drawingHeight;
    }

    const worldRadius =
      Math.max(
        (pixelWidth *
          worldPerPixel) /
          2,
        0.00005
      );

    mesh.scale.set(
      worldRadius,
      1,
      worldRadius
    );
  });

  return (
    <mesh
      ref={meshRef}
      position={midpoint}
      quaternion={quaternion}
      scale={[
        0.004,
        1,
        0.004,
      ]}
      renderOrder={10}
      onUpdate={(object) => {
        object.layers.set(
          RAY_LAYER
        );
      }}
    >
      <cylinderGeometry
        args={[
          1,
          1,
          length,
          6,
          1,
          true,
        ]}
      />

      <meshBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        depthWrite={false}
      />
    </mesh>
  );
}

function DenseRayLines({
  rays,
}) {
  const geometry =
    useMemo(() => {
      const positions = [];
      const colors = [];

      for (
        const ray of rays
      ) {
        positions.push(
          ray.origin.x,
          ray.origin.y,
          ray.origin.z,

          ray.pinhole.x,
          ray.pinhole.y,
          ray.pinhole.z
        );

        positions.push(
          ray.pinhole.x,
          ray.pinhole.y,
          ray.pinhole.z,

          ray.screen.x,
          ray.screen.y,
          ray.screen.z
        );

        const color =
          new THREE.Color(
            ray.color
          );

        colors.push(
          color.r,
          color.g,
          color.b,

          color.r,
          color.g,
          color.b,

          color.r,
          color.g,
          color.b,

          color.r,
          color.g,
          color.b
        );
      }

      const geometry =
        new THREE.BufferGeometry();

      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          positions,
          3
        )
      );

      geometry.setAttribute(
        "color",
        new THREE.Float32BufferAttribute(
          colors,
          3
        )
      );

      return geometry;
    }, [rays]);

  useEffect(() => {
    return () =>
      geometry.dispose();
  }, [geometry]);

  return (
    <lineSegments
      geometry={geometry}
      renderOrder={10}
      onUpdate={(object) => {
        object.layers.set(
          RAY_LAYER
        );
      }}
    >
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.55}
        depthWrite={false}
      />
    </lineSegments>
  );
}

function RayLines({ rays }) {
  /*
     Native WebGL line width is unreliable across browsers/GPUs.

     Sparse diagrams use tiny cylinder segments, whose radius
     increases smoothly as ray count falls. Dense diagrams retain
     the original lightweight line renderer for performance.
  */

  const rayCount =
    Math.max(
      rays.length,
      1
    );

  if (rayCount > 80) {
    return (
      <DenseRayLines
        rays={rays}
      />
    );
  }

  /*
     Target apparent width in PHYSICAL screen pixels.

     Sparse rays stay satisfyingly chunky through ~40, then thin
     rapidly toward a one-device-pixel line by the 80-ray handoff.

       10 rays -> ~8.5 px
       20 rays -> ~7.5 px
       30 rays -> ~6.5 px
       40 rays -> ~5.5 px
       50 rays -> ~3.4 px
       60 rays -> ~2.4 px
       70 rays -> ~1.6 px
       80 rays -> ~1.0 px

     RayCylinderSegment converts this screen-space width into the
     correct world-space radius every frame, so zooming no longer
     makes the cylinders disproportionately thick or thin.
  */
  let pixelWidth;

  if (rayCount <= 40) {
    const sparseT =
      THREE.MathUtils.clamp(
        (rayCount - 10) /
          (40 - 10),
        0,
        1
      );

    pixelWidth =
      THREE.MathUtils.lerp(
        8.5,
        5.5,
        sparseT
      );
  } else {
    const denseT =
      THREE.MathUtils.clamp(
        (rayCount - 40) /
          (80 - 40),
        0,
        1
      );

    const easedDenseT =
      Math.pow(
        denseT,
        0.55
      );

    pixelWidth =
      THREE.MathUtils.lerp(
        5.5,
        1.0,
        easedDenseT
      );
  }

  /*
     Fade cylinder opacity toward DenseRayLines too, so both width
     and transparency converge before the renderer changes.
  */
  const opacityBlend =
    THREE.MathUtils.clamp(
      (rayCount - 40) /
        (80 - 40),
      0,
      1
    );

  const rayOpacity =
    THREE.MathUtils.lerp(
      0.60,
      0.55,
      opacityBlend
    );

  return (
    <group>
      {rays.map(
        (ray, i) => (
          <group key={i}>
            <RayCylinderSegment
              start={
                ray.origin
              }
              end={
                ray.pinhole
              }
              color={
                ray.color
              }
              pixelWidth={
                pixelWidth
              }
              opacity={
                rayOpacity
              }
              thicknessReference={
                ray.pinhole
              }
            />

            <RayCylinderSegment
              start={
                ray.pinhole
              }
              end={
                ray.screen
              }
              color={
                ray.color
              }
              pixelWidth={
                pixelWidth
              }
              opacity={
                rayOpacity
              }
              thicknessReference={
                ray.pinhole
              }
            />
          </group>
        )
      )}
    </group>
  );
}

/* =========================================================
   RAY ARROWS
========================================================= */

function RayArrows({ rays }) {
  const rayCount =
    Math.max(
      rays.length,
      1
    );

  /*
     Make all arrowheads a little larger than before, then
     progressively enlarge them further as the ray count drops.

     Approximate scale multiplier:
       10 rays  -> 1.80x
       60 rays  -> 1.45x
       120 rays -> 1.18x
       200 rays -> 1.10x
  */

  const normalized =
    THREE.MathUtils.clamp(
      (rayCount - 10) /
        (200 - 10),
      0,
      1
    );

  const arrowScaleMultiplier =
    THREE.MathUtils.lerp(
      1.80,
      1.10,
      Math.pow(
        normalized,
        0.70
      )
    );

  return (
    <>
      {rays
        .slice(
          0,
          100
        )
        .map(
        (ray, i) => {
          const direction =
            new THREE.Vector3()
              .subVectors(
                ray.pinhole,
                ray.origin
              )
              .normalize();

          /*
             Place the direction marker a fixed distance from the
             sunflower end of the ray instead of at a percentage of
             the object→pinhole span. This makes its location visually
             stable when object distance or camera framing changes.
          */
          const originToPinhole =
            ray.origin.distanceTo(
              ray.pinhole
            );

          const baseArrowDistance =
            Math.min(
              1.85,
              originToPinhole * 0.42
            );

          /*
             Centre rays sit a touch further back toward the sunflower
             than the others. Use the ray's semantic source category
             rather than inferring its identity from display colours.
          */
          const isCentreRay =
            ray.category ===
              "centre";

          const arrowDistanceFromObject =
            isCentreRay
              ? Math.min(
                  1.55,
                  originToPinhole *
                    0.34
                )
              : baseArrowDistance;

          const position =
            ray.origin
              .clone()
              .add(
                direction
                  .clone()
                  .multiplyScalar(
                    arrowDistanceFromObject
                  )
              );

          const quaternion =
            new THREE.Quaternion()
              .setFromUnitVectors(
                new THREE.Vector3(
                  0,
                  1,
                  0
                ),
                direction
              );

          return (
            <mesh
              key={i}
              position={
                position
              }
              quaternion={
                quaternion
              }
              scale={[
                0.055 *
                  arrowScaleMultiplier,
                0.145 *
                  arrowScaleMultiplier,
                0.055 *
                  arrowScaleMultiplier,
              ]}
              onUpdate={(
                object
              ) => {
                object.layers.set(
                  RAY_LAYER
                );
              }}
            >
              <coneGeometry
                args={[
                  0.6,
                  1,
                  6,
                ]}
              />

              <meshBasicMaterial
                color={
                  ray.color
                }
              />
            </mesh>
          );
        }
      )}
    </>
  );
}

/* =========================================================
   HALTON SEQUENCE
========================================================= */

function halton(index, base) {
  let result = 0;
  let f = 1 / base;
  let i = index;

  while (i > 0) {
    result +=
      f * (i % base);

    i = Math.floor(
      i / base
    );

    f /= base;
  }

  return result;
}

/* =========================================================
   FINITE APERTURE SAMPLING

   Samples stable points across the circular pinhole.
   The disk lies in the wall plane (world Y/Z).
========================================================= */

function sampleAperturePoint(
  pinhole,
  apertureRadius,
  index
) {
  if (apertureRadius <= 0) {
    return pinhole.clone();
  }

  const u =
    halton(index + 1, 2);

  const v =
    halton(index + 1, 3);

  const radius =
    apertureRadius *
    Math.sqrt(u);

  const angle =
    Math.PI * 2 * v;

  return new THREE.Vector3(
    pinhole.x,
    pinhole.y +
      Math.cos(angle) *
        radius,
    pinhole.z +
      Math.sin(angle) *
        radius
  );
}

/* =========================================================
   PETAL SURFACE SAMPLE
========================================================= */

function createPetalSample(
  petalIndex,
  sampleIndex
) {
  const angle =
    (petalIndex /
      PETAL_COUNT) *
    Math.PI *
    2;

  const u =
    halton(
      sampleIndex +
        petalIndex * 1000,
      2
    );

  const v =
    halton(
      sampleIndex +
        petalIndex * 1000,
      3
    );

  const innerRadius = 0.46;
  const outerRadius = 0.985;

  const radial =
    Math.pow(
      v,
      0.42
    );

  const r =
    innerRadius +
    (outerRadius -
      innerRadius) *
      radial;

  const theta =
    Math.PI * 2 * u;

  const localX =
    Math.cos(theta) * r;

  const localY =
    Math.sin(theta) * r;

  const localZ =
    Math.sqrt(
      Math.max(
        0,
        1 -
          localX * localX -
          localY * localY
      )
    );

  const point =
    new THREE.Vector3(
      localX * 0.25,
      localY * 0.72,
      localZ * 0.11
    );

  point.applyEuler(
    new THREE.Euler(
      Math.sin(angle) *
        0.30,
      -Math.cos(angle) *
        0.30,
      angle -
        Math.PI / 2
    )
  );

  point.add(
    new THREE.Vector3(
      Math.cos(angle) *
        PETAL_ROOT_RADIUS,
      Math.sin(angle) *
        PETAL_ROOT_RADIUS,
      0.30
    )
  );

  point.add(
    FLOWER_POSITION
  );

  return point;
}

/* =========================================================
   FLOWER CENTRE SAMPLE
========================================================= */

function createFlowerCentreSample(
  u,
  v
) {
  const r =
    Math.sqrt(v);

  const theta =
    Math.PI * 2 * u;

  const x =
    Math.cos(theta) *
    r *
    FLOWER_CENTER_RADIUS;

  const y =
    Math.sin(theta) *
    r *
    FLOWER_CENTER_RADIUS;

  const z =
    Math.sqrt(
      Math.max(
        0,
        1 - r * r
      )
    ) * 0.18;

  return new THREE.Vector3(
    x,
    FLOWER_POSITION.y + y,
    FLOWER_POSITION.z +
      0.38 +
      z
  );
}

/* =========================================================
   LEAF SAMPLE
========================================================= */

function createLeafSample(
  leaf,
  i
) {
  const u =
    halton(
      i + leaf.offset,
      2
    );

  const v =
    halton(
      i + leaf.offset,
      3
    );

  const halfWidth =
    0.25 *
    Math.sin(
      Math.PI * u
    );

  const localX =
    (v - 0.5) *
    2 *
    halfWidth;

  const localY =
    u * leaf.length;

  const localZ =
    0.045 +
    u * 0.20 +
    0.025 *
      Math.sin(
        Math.PI * u
      );

  const c =
    Math.cos(
      leaf.rotation
    );

  const s =
    Math.sin(
      leaf.rotation
    );

  const x =
    localX * c -
    localY * s;

  const y =
    localX * s +
    localY * c;

  return new THREE.Vector3(
    x,
    leaf.y + y,
    localZ
  );
}

/* =========================================================
   SURFACE CANDIDATES
========================================================= */

function createSurfaceCandidates() {
  const categories = {
    petal: [],
    centre: [],
    leaf: [],
    stem: [],
    pot: [],
  };

  const add = (
    category,
    point,
    color,
    priority
  ) => {
    categories[
      category
    ].push({
      point,
      color,
      category,
      priority,
    });
  };

  /* FLOWER PETALS */

  for (
    let petal = 0;
    petal < PETAL_COUNT;
    petal++
  ) {
    for (
      let i = 1;
      i <= 80;
      i++
    ) {
      const petalPoint =
        createPetalSample(
          petal,
          i
        );

      /*
         Keep yellow petal rays out of the visible
         brown seed-head area. The small margin stops
         yellow rays appearing right on its edge.
      */

      const dx =
        petalPoint.x -
        FLOWER_POSITION.x;

      const dy =
        petalPoint.y -
        FLOWER_POSITION.y;

      const distanceFromFlowerCentre =
        Math.sqrt(
          dx * dx +
          dy * dy
        );

      const brownCentreMaskRadius =
        FLOWER_CENTER_RADIUS +
        0.035;

      if (
        distanceFromFlowerCentre <
        brownCentreMaskRadius
      ) {
        continue;
      }

      add(
        "petal",
        petalPoint,
        PETAL_COLOR,
        halton(
          i +
            petal * 1000,
          5
        )
      );
    }
  }

  /* FLOWER CENTRE */

  for (
    let i = 1;
    i <= 500;
    i++
  ) {
    add(
      "centre",
      createFlowerCentreSample(
        halton(i, 2),
        halton(i, 3)
      ),
      CENTRE_COLOR,
      halton(i, 5)
    );
  }

  /* LEAVES */

  const leaves = [
    {
      y: 1.34,
      rotation:
        THREE.MathUtils.degToRad(
          -55
        ),
      length: 1.05,
      offset: 0,
    },
    {
      y: 1.82,
      rotation:
        THREE.MathUtils.degToRad(
          55
        ),
      length: 1.00,
      offset: 1000,
    },
  ];

  for (
    const leaf of leaves
  ) {
    for (
      let i = 1;
      i <= 500;
      i++
    ) {
      add(
        "leaf",
        createLeafSample(
          leaf,
          i
        ),
        LEAF_COLOR,
        halton(
          i +
            leaf.offset,
          5
        )
      );
    }
  }

  /* STEM */

  for (
    let i = 1;
    i <= 700;
    i++
  ) {
    const u =
      halton(i, 2);

    const v =
      halton(i, 3);

    const angle =
      Math.PI * 2 * v;

    const y =
      -0.48 +
      4.20 * u;

    const radius =
      0.105 -
      0.030 * u;

    add(
      "stem",
      new THREE.Vector3(
        Math.cos(angle) *
          radius,
        y,
        Math.sin(angle) *
          radius
      ),
      STEM_COLOR,
      halton(i, 5)
    );
  }

  /* NECK */

  for (
    let i = 1;
    i <= 160;
    i++
  ) {
    const u =
      halton(i, 2);

    const v =
      halton(i, 3);

    const angle =
      Math.PI * 2 * v;

    const radius =
      0.085 +
      0.015 * u;

    const z =
      0.02 +
      0.75 * u;

    add(
      "stem",
      new THREE.Vector3(
        Math.cos(angle) *
          radius,
        3.90 +
          Math.sin(angle) *
            radius,
        z
      ),
      STEM_COLOR,
      halton(i, 5)
    );
  }

  /* POT */

  for (
    let i = 1;
    i <= 600;
    i++
  ) {
    const u =
      halton(i, 2);

    const v =
      halton(i, 3);

    const angle =
      Math.PI * 2 * u;

    const radius =
      0.50 +
      0.20 * v;

    const y =
      -0.45 +
      1.30 * v;

    add(
      "pot",
      new THREE.Vector3(
        Math.cos(angle) *
          radius,
        y,
        Math.sin(angle) *
          radius
      ),
      POT_COLOR,
      halton(i, 5)
    );
  }

  for (
    const category of Object.keys(
      categories
    )
  ) {
    categories[
      category
    ].sort(
      (a, b) =>
        a.priority -
        b.priority
    );
  }

  return categories;
}

/* =========================================================
   FAIR RAY ORDER
========================================================= */

function interleaveRays(
  categoryRays
) {
  const weights = {
    petal: 24,
    centre: 10,
    leaf: 23,
    stem: 23,
    pot: 20,
  };

  const indices = {
    petal: 0,
    centre: 0,
    leaf: 0,
    stem: 0,
    pot: 0,
  };

  const result = [];

  while (true) {
    let bestCategory =
      null;

    let bestScore =
      Infinity;

    for (
      const category of Object.keys(
        categoryRays
      )
    ) {
      const index =
        indices[category];

      if (
        index >=
        categoryRays[
          category
        ].length
      ) {
        continue;
      }

      const score =
        index /
        weights[category];

      if (
        score < bestScore
      ) {
        bestScore = score;
        bestCategory =
          category;
      }
    }

    if (!bestCategory) {
      break;
    }

    result.push(
      categoryRays[
        bestCategory
      ][
        indices[
          bestCategory
        ]
      ]
    );

    indices[
      bestCategory
    ]++;
  }

  return result;
}

/* =========================================================
   CHAMBER RAY TERMINATION

   After a ray passes through the aperture, terminate it at
   whichever chamber surface it reaches first: the rear
   screen, the floor, or the ceiling.
========================================================= */

function getRayEndPoint({
  aperturePoint,
  direction,
  screenX,
  floorY = 0,
  ceilingY = 5,
}) {
  if (
    Math.abs(direction.x) < 0.00001
  ) {
    return null;
  }

  const tScreen =
    (screenX - aperturePoint.x) /
    direction.x;

  if (
    !Number.isFinite(tScreen) ||
    tScreen <= 0
  ) {
    return null;
  }

  let bestT = tScreen;
  let hitType = "screen";

  if (
    Math.abs(direction.y) > 0.00001
  ) {
    const tFloor =
      (floorY - aperturePoint.y) /
      direction.y;

    if (
      Number.isFinite(tFloor) &&
      tFloor > 0 &&
      tFloor < bestT
    ) {
      bestT = tFloor;
      hitType = "floor";
    }

    const tCeiling =
      (ceilingY - aperturePoint.y) /
      direction.y;

    if (
      Number.isFinite(tCeiling) &&
      tCeiling > 0 &&
      tCeiling < bestT
    ) {
      bestT = tCeiling;
      hitType = "ceiling";
    }
  }

  return {
    point: aperturePoint
      .clone()
      .add(
        direction
          .clone()
          .multiplyScalar(bestT)
      ),
    hitType,
  };
}

/* =========================================================
   VISIBLE RAY SAMPLER
========================================================= */

function useVisibleRays({
  plantGroupRef,
  sunflowerRef,
  potRef,
  pinhole,
  screenX,
  objectDistance,
  pinholeDiameter,
}) {
  const [
    visibleRays,
    setVisibleRays,
  ] = useState([]);

  useEffect(() => {
    if (
      !plantGroupRef.current ||
      !sunflowerRef.current ||
      !potRef.current
    ) {
      return undefined;
    }

    const frame =
      requestAnimationFrame(
        () => {
          const plantGroup =
            plantGroupRef.current;

          const sunflower =
            sunflowerRef.current;

          const pot =
            potRef.current;

          plantGroup.updateMatrixWorld(
            true
          );

          const categories =
            createSurfaceCandidates();

          const objects = {
            petal: sunflower,
            centre: sunflower,
            leaf: sunflower,
            stem: sunflower,
            pot: pot,
          };

          const apertureOffsets = {
            petal: 0,
            centre: 3000,
            leaf: 6000,
            stem: 9000,
            pot: 12000,
          };

          const apertureRadius =
            pinholeDiameter / 2;

          const raycaster =
            new THREE.Raycaster();

          const maxRays = 220;

          const accepted = {
            petal: [],
            centre: [],
            leaf: [],
            stem: [],
            pot: [],
          };

          const targetWeights = {
            petal: 0.24,
            centre: 0.10,
            leaf: 0.23,
            stem: 0.23,
            pot: 0.20,
          };

          for (
            const category of Object.keys(
              categories
            )
          ) {
            const candidates =
              categories[
                category
              ];

            const object =
              objects[category];

            object.updateMatrixWorld(
              true
            );

            const target =
              Math.ceil(
                maxRays *
                  targetWeights[
                    category
                  ]
              );

            for (
              let i = 0;
              i <
                candidates.length &&
              accepted[
                category
              ].length <
                target;
              i++
            ) {
              const candidate =
                candidates[i];

              const worldPoint =
                candidate.point
                  .clone()
                  .applyMatrix4(
                    object.matrixWorld
                  );

              /*
                 Each visible ray now uses a different point
                 across the finite circular aperture instead
                 of being forced through the exact centre.
              */

              const aperturePoint =
                sampleAperturePoint(
                  pinhole,
                  apertureRadius,
                  i +
                    apertureOffsets[
                      category
                    ]
                );

              const toAperture =
                new THREE.Vector3()
                  .subVectors(
                    aperturePoint,
                    worldPoint
                  );

              const distance =
                toAperture.length();

              if (
                distance < 0.001
              ) {
                continue;
              }

              const direction =
                toAperture.normalize();

              const rayStart =
                worldPoint
                  .clone()
                  .add(
                    direction
                      .clone()
                      .multiplyScalar(
                        0.004
                      )
                  );

              raycaster.set(
                rayStart,
                direction
              );

              const intersections =
                raycaster.intersectObject(
                  plantGroup,
                  true
                );

              let blocked = false;

              for (
                const hit of
                  intersections
              ) {
                if (
                  hit.distance >
                    0.008 &&
                  hit.distance <
                    distance - 0.008
                ) {
                  blocked = true;
                  break;
                }
              }

              if (blocked) {
                continue;
              }

              const rayEnd =
                getRayEndPoint({
                  aperturePoint,
                  direction,
                  screenX,
                  floorY: 0,
                  ceilingY: 5,
                });

              if (!rayEnd) {
                continue;
              }

              accepted[
                category
              ].push({
                origin:
                  worldPoint.clone(),

                /*
                   Keep the existing property name so RayLines
                   and RayArrows continue to work unchanged.
                   It now stores the sampled aperture point.
                */
                pinhole:
                  aperturePoint.clone(),

                /*
                   The existing `screen` field is used as the
                   visible end point. It may now lie on the
                   screen, floor, or ceiling.
                */
                screen:
                  rayEnd.point,

                hitType:
                  rayEnd.hitType,

                color:
                  candidate.color,

                category,
              });
            }
          }

          const ordered =
            interleaveRays(
              accepted
            );

          setVisibleRays(
            ordered.slice(
              0,
              maxRays
            )
          );
        }
      );

    return () =>
      cancelAnimationFrame(
        frame
      );
  }, [
    plantGroupRef,
    sunflowerRef,
    potRef,
    pinhole,
    screenX,
    objectDistance,
    pinholeDiameter,
  ]);

  return visibleRays;
}

/* =========================================================
   RAY SYSTEM
========================================================= */

function SunflowerRays({
  plantGroupRef,
  sunflowerRef,
  potRef,
  pinhole,
  screenX,
  rayCount,
  objectDistance,
  pinholeDiameter,
}) {
  const allVisibleRays =
    useVisibleRays({
      plantGroupRef,
      sunflowerRef,
      potRef,
      pinhole,
      screenX,
      objectDistance,
      pinholeDiameter,
    });

  const rays =
    useMemo(
      () =>
        allVisibleRays.slice(
          0,
          rayCount
        ),
      [
        allVisibleRays,
        rayCount,
      ]
    );

  return (
    <>
      <RayLines
        rays={rays}
      />

      <RayArrows
        rays={rays}
      />
    </>
  );
}

/* =========================================================
   LIGHT CONE GEOMETRY

   Each cone is constructed from the actual optical geometry:

       visible object point
              ↓
       circular aperture ring
              ↓
       screen / floor / ceiling

   The aperture ring uses the real pinhole diameter, so increasing
   pinhole diameter automatically widens both halves of the light
   volume and increases its footprint inside the chamber.
========================================================= */

function createLightConeGeometry({
  origin,
  pinhole,
  screenX,
  pinholeDiameter,
  segments = 40,
}) {
  const apertureRadius =
    Math.max(
      pinholeDiameter / 2,
      0.0001
    );

  const aperturePoints = [];
  const endPoints = [];

  for (
    let i = 0;
    i < segments;
    i++
  ) {
    const angle =
      (i / segments) *
      Math.PI *
      2;

    const aperturePoint =
      new THREE.Vector3(
        pinhole.x,
        pinhole.y +
          Math.cos(angle) *
            apertureRadius,
        pinhole.z +
          Math.sin(angle) *
            apertureRadius
      );

    const direction =
      new THREE.Vector3()
        .subVectors(
          aperturePoint,
          origin
        )
        .normalize();

    const rayEnd =
      getRayEndPoint({
        aperturePoint,
        direction,
        screenX,
        floorY: 0,
        ceilingY: 5,
      });

    if (!rayEnd) {
      return null;
    }

    aperturePoints.push(
      aperturePoint
    );

    endPoints.push(
      rayEnd.point
    );
  }

  const positions = [];

  /*
     Vertex 0 is the object-point origin.

     Then:
       1 ... segments              = aperture ring
       1 + segments ...            = downstream ring
  */

  positions.push(
    origin.x,
    origin.y,
    origin.z
  );

  for (
    const point of
    aperturePoints
  ) {
    positions.push(
      point.x,
      point.y,
      point.z
    );
  }

  for (
    const point of
    endPoints
  ) {
    positions.push(
      point.x,
      point.y,
      point.z
    );
  }

  const indices = [];

  const apertureOffset = 1;
  const endOffset =
    1 + segments;

  for (
    let i = 0;
    i < segments;
    i++
  ) {
    const next =
      (i + 1) %
      segments;

    const apertureA =
      apertureOffset + i;

    const apertureB =
      apertureOffset + next;

    const endA =
      endOffset + i;

    const endB =
      endOffset + next;

    /*
       Object point -> aperture:
       triangular fan forming the incoming cone.
    */

    indices.push(
      0,
      apertureA,
      apertureB
    );

    /*
       Aperture -> chamber:
       two triangles per strip around the circumference.
       Individual boundary rays are already clipped by the same
       floor / ceiling / screen rule as the ray view.
    */

    indices.push(
      apertureA,
      endA,
      endB,

      apertureA,
      endB,
      apertureB
    );
  }

  const geometry =
    new THREE.BufferGeometry();

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      positions,
      3
    )
  );

  geometry.setIndex(indices);

  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const apertureRingGeometry =
    new THREE.BufferGeometry()
      .setFromPoints(
        aperturePoints
      );

  return {
    geometry,
    apertureRingGeometry,
  };
}

/* =========================================================
   SINGLE LIGHT CONE
========================================================= */

function LightConeVolume({
  origin,
  color,
  pinhole,
  screenX,
  pinholeDiameter,
  opacity = 0.105,
}) {
  const coneData =
    useMemo(
      () =>
        createLightConeGeometry({
          origin,
          pinhole,
          screenX,
          pinholeDiameter,
          segments: 40,
        }),
      [
        origin,
        pinhole,
        screenX,
        pinholeDiameter,
      ]
    );

  useEffect(() => {
    return () => {
      if (!coneData) {
        return;
      }

      coneData.geometry.dispose();

      coneData.apertureRingGeometry.dispose();
    };
  }, [coneData]);

  if (!coneData) {
    return null;
  }

  return (
    <group>
      <mesh
        geometry={
          coneData.geometry
        }
        renderOrder={2}
        onUpdate={(object) => {
          object.layers.set(
            RAY_LAYER
          );
        }}
      >
        <meshBasicMaterial
          color={color}
          transparent
          opacity={opacity}
          depthWrite={false}
          side={
            THREE.DoubleSide
          }
        />
      </mesh>

      {/* Slightly clearer waist at the finite aperture. */}

      <lineLoop
        geometry={
          coneData.apertureRingGeometry
        }
        renderOrder={3}
        onUpdate={(object) => {
          object.layers.set(
            RAY_LAYER
          );
        }}
      >
        <lineBasicMaterial
          color={color}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </lineLoop>
    </group>
  );
}

/* =========================================================
   SUNFLOWER LIGHT CONES

   Reuse the existing visibility sampler so each cone originates
   from a point that is actually visible through the aperture.

   We choose one stable representative from each optical category:

       petal
       brown centre
       leaf
       stem
       pot
========================================================= */

function SunflowerLightCones({
  plantGroupRef,
  sunflowerRef,
  potRef,
  pinhole,
  screenX,
  objectDistance,
  pinholeDiameter,
}) {
  const allVisibleRays =
    useVisibleRays({
      plantGroupRef,
      sunflowerRef,
      potRef,
      pinhole,
      screenX,
      objectDistance,
      pinholeDiameter,
    });

  const representativeOrigins =
    useMemo(() => {
      const categories = [
        "petal",
        "centre",
        "leaf",
        "stem",
        "pot",
      ];

      return categories
        .map((category) => {
          const ray =
            allVisibleRays.find(
              (candidate) =>
                candidate.category ===
                category
            );

          if (!ray) {
            return null;
          }

          const displayOrigin =
            ray.origin.clone();

          let displayColor =
            ray.color;

          /*
             The petal and brown-centre origins are physically close
             together on the flower head. For cone mode only, separate
             their DISPLAY origins slightly in Y so both volumes remain
             legible. The real plant, ray mode and projection optics are
             not moved.
          */

          if (category === "petal") {
            /*
               Keep a small readability offset, but bring the yellow
               cone slightly lower than before.
            */
            displayOrigin.y -= 0.04;
            displayColor = "#fff01f";
          }

          if (category === "centre") {
            /*
               Lift the brown cone origin slightly so it reads clearly
               as emerging from the brown seed head.
            */
            displayOrigin.y += 0.17;
            displayColor = "#a66f32";
          }

          return {
            category,
            origin:
              displayOrigin,
            color:
              displayColor,
          };
        })
        .filter(Boolean);
    }, [allVisibleRays]);

  return (
    <>
      {representativeOrigins.map(
        ({
          category,
          origin,
          color,
        }) => (
          <group key={category}>
            <LightConeVolume
              origin={origin}
              color={color}
              pinhole={pinhole}
              screenX={screenX}
              pinholeDiameter={
                pinholeDiameter
              }
              opacity={0.4}
            />

            <ConeOriginMarker
              origin={origin}
            />
          </group>
        )
      )}
    </>
  );
}


/* =========================================================
   CONE ORIGIN MARKER

   Small scientific-style "+" marker placed at the exact
   display origin used by each light cone.
========================================================= */

function ConeOriginMarker({
  origin,
}) {
  const markerRef =
    useRef(null);

  const { camera } =
    useThree();

  const size = 0.13;
  const thickness = 0.022;
  const markerColor = "#e63946";

  useFrame(() => {
    if (!markerRef.current) {
      return;
    }

    /*
       Billboard the "+" toward the camera while keeping it
       anchored to the exact cone origin.

       Nudge it a tiny amount toward the camera so it does not
       disappear into the sunflower surface at oblique angles.
    */

    markerRef.current.quaternion.copy(
      camera.quaternion
    );

    const towardCamera =
      new THREE.Vector3()
        .subVectors(
          camera.position,
          origin
        )
        .normalize()
        .multiplyScalar(
          0.035
        );

    markerRef.current.position.copy(
      origin
    );

    markerRef.current.position.add(
      towardCamera
    );
  });

  return (
    <group
      ref={markerRef}
      position={[
        origin.x,
        origin.y,
        origin.z,
      ]}
      onUpdate={(object) => {
        object.layers.set(
          MARKER_LAYER
        );
      }}
    >
      <mesh>
        <boxGeometry
          args={[
            size,
            thickness,
            thickness,
          ]}
        />
        <meshBasicMaterial
          color={markerColor}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>

      <mesh>
        <boxGeometry
          args={[
            thickness,
            size,
            thickness,
          ]}
        />
        <meshBasicMaterial
          color={markerColor}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}


/* =========================================================
   PINHOLE WALL
========================================================= */

function PinholeWall({
  x,
  holeY,
  holeDiameter,
}) {
  const wallWidth = 4.0;
  const wallHeight = 5.0;
  const wallDepth = 0.04;

  const wallShape =
    useMemo(() => {
      const shape =
        new THREE.Shape();

      const halfWidth =
        wallWidth / 2;

      const halfHeight =
        wallHeight / 2;

      shape.moveTo(
        -halfWidth,
        -halfHeight
      );

      shape.lineTo(
        halfWidth,
        -halfHeight
      );

      shape.lineTo(
        halfWidth,
        halfHeight
      );

      shape.lineTo(
        -halfWidth,
        halfHeight
      );

      shape.closePath();

      const holeRadius =
        holeDiameter / 2;

      const hole =
        new THREE.Path();

      hole.absarc(
        0,
        holeY -
          wallHeight / 2,
        holeRadius,
        0,
        Math.PI * 2,
        true
      );

      shape.holes.push(
        hole
      );

      return shape;
    }, [
      holeY,
      holeDiameter,
    ]);

  const geometry =
    useMemo(() => {
      const geometry =
        new THREE.ExtrudeGeometry(
          wallShape,
          {
            depth: wallDepth,
            bevelEnabled: false,
            curveSegments: 48,
          }
        );

      geometry.rotateY(
        Math.PI / 2
      );

      geometry.translate(
        x,
        wallHeight / 2,
        0
      );

      return geometry;
    }, [
      x,
      wallShape,
    ]);

  const innerFaceGeometry =
    useMemo(() => {
      const geometry =
        new THREE.ShapeGeometry(
          wallShape,
          48
        );

      geometry.rotateY(
        Math.PI / 2
      );

      /*
         The chamber lies on the +X side of the pinhole wall.
         Place this face just beyond the inner wall surface to
         avoid z-fighting while keeping the same hole cutout.
      */
      geometry.translate(
        x +
          wallDepth +
          0.0006,
        wallHeight / 2,
        0
      );

      return geometry;
    }, [
      x,
      wallShape,
    ]);

  useEffect(() => {
    return () => {
      geometry.dispose();
      innerFaceGeometry.dispose();
    };
  }, [
    geometry,
    innerFaceGeometry,
  ]);

  return (
    <>
      <mesh
        geometry={geometry}
        castShadow
        onUpdate={(object) => {
          object.layers.set(
            APPARATUS_LAYER
          );
        }}
      >
        <meshStandardMaterial
          color="#d7d0c0"
          roughness={0.9}
          side={
            THREE.DoubleSide
          }
        />
      </mesh>

      {/* Slightly differentiated chamber-facing inner surface */}
      <mesh
        geometry={
          innerFaceGeometry
        }
        onUpdate={(object) => {
          object.layers.set(
            APPARATUS_LAYER
          );
        }}
      >
        <meshStandardMaterial
          color="#cec8bb"
          roughness={0.9}
          side={
            THREE.DoubleSide
          }
        />
      </mesh>
    </>
  );
}


/* =========================================================
   CORRECT PROJECTION RENDERER

   This is separate from the screen mesh so the actual
   scene object can be rendered into the target without
   touching visibility of the rays.
========================================================= */

function ProjectionRenderer({
  pinhole,
  screenX,
  plantGroupRef,
  renderTarget,
  pinholeDiameter,
  objectDistance,
}) {
  const {
    gl,
    scene,
  } = useThree();

  const camera =
    useMemo(
      () =>
        new THREE.PerspectiveCamera(
          45,
          4 / 5,
          0.01,
          100
        ),
      []
    );

  /*
     First render ONE sharp ideal-pinhole image from the
     centre of the aperture. The finite-aperture effect is
     then applied as a smooth circular convolution.
  */

  const sharpTarget =
    useMemo(
      () =>
        new THREE.WebGLRenderTarget(
          1024,
          1280,
          {
            minFilter:
              THREE.LinearFilter,
            magFilter:
              THREE.LinearFilter,
            format:
              THREE.RGBAFormat,
            depthBuffer: true,
            stencilBuffer: false,
          }
        ),
      []
    );

  /*
     Full-screen disk-blur pass.

     The sample points follow a golden-angle / Vogel disk
     distribution. A tiny deterministic rotation per output
     pixel prevents the samples from reading as a handful of
     coherent "ghost" copies of the sunflower.

     This is still a geometric aperture blur: samples are
     distributed over a CIRCULAR kernel rather than a Gaussian.
  */

  const blurPass =
    useMemo(() => {
      const blurScene =
        new THREE.Scene();

      const blurCamera =
        new THREE.OrthographicCamera(
          -1,
          1,
          1,
          -1,
          0,
          1
        );

      const material =
        new THREE.ShaderMaterial({
          uniforms: {
            tSharp: {
              value: null,
            },
            blurRadiusUv: {
              value:
                new THREE.Vector2(
                  0,
                  0
                ),
            },
          },

          vertexShader: `
            varying vec2 vUv;

            void main() {
              vUv = uv;

              gl_Position = vec4(
                position.xy,
                0.0,
                1.0
              );
            }
          `,

          fragmentShader: `
            uniform sampler2D tSharp;
            uniform vec2 blurRadiusUv;

            varying vec2 vUv;

            const int SAMPLE_COUNT = 64;
            const float PI =
              3.141592653589793;
            const float GOLDEN_ANGLE =
              2.399963229728653;

            float hash12(vec2 p) {
              vec3 p3 =
                fract(
                  vec3(p.xyx) *
                  0.1031
                );

              p3 += dot(
                p3,
                p3.yzx + 33.33
              );

              return fract(
                (p3.x + p3.y) *
                p3.z
              );
            }

            void main() {
              /*
                 Rotate the same uniform disk pattern slightly
                 at each output pixel. This removes visible
                 repeated-image spokes while remaining stable
                 from frame to frame.
              */

              float rotation =
                hash12(
                  floor(
                    gl_FragCoord.xy
                  )
                ) *
                PI *
                2.0;

              vec4 sum =
                vec4(0.0);

              for (
                int i = 0;
                i < SAMPLE_COUNT;
                i++
              ) {
                float fi =
                  float(i) + 0.5;

                /*
                   sqrt() gives uniform AREA density
                   across the circular aperture.
                */

                float radius =
                  sqrt(
                    fi /
                    float(
                      SAMPLE_COUNT
                    )
                  );

                float angle =
                  fi *
                  GOLDEN_ANGLE +
                  rotation;

                vec2 disk =
                  vec2(
                    cos(angle),
                    sin(angle)
                  ) *
                  radius;

                vec2 sampleUv =
                  clamp(
                    vUv +
                    disk *
                    blurRadiusUv,
                    vec2(0.0),
                    vec2(1.0)
                  );

                sum +=
                  texture2D(
                    tSharp,
                    sampleUv
                  );
              }

              gl_FragColor =
                sum /
                float(
                  SAMPLE_COUNT
                );
            }
          `,

          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        });

      const geometry =
        new THREE.PlaneGeometry(
          2,
          2
        );

      const quad =
        new THREE.Mesh(
          geometry,
          material
        );

      blurScene.add(quad);

      return {
        scene: blurScene,
        camera: blurCamera,
        material,
        geometry,
      };
    }, []);

  const dirtyRef =
    useRef(true);

  useEffect(() => {
    dirtyRef.current = true;
  }, [
    pinhole,
    screenX,
    objectDistance,
    pinholeDiameter,
  ]);

  useEffect(() => {
    return () => {
      sharpTarget.dispose();
      blurPass.geometry.dispose();
      blurPass.material.dispose();
    };
  }, [
    sharpTarget,
    blurPass,
  ]);

  useFrame(() => {
    if (
      !plantGroupRef.current ||
      !dirtyRef.current
    ) {
      return;
    }

    dirtyRef.current = false;

    plantGroupRef.current.updateMatrixWorld(
      true
    );

    /*
       =====================================================
       1. RENDER THE IDEAL SHARP PINHOLE IMAGE
       =====================================================
    */

    camera.position.copy(
      pinhole
    );

    camera.up.set(
      0,
      1,
      0
    );

    camera.lookAt(
      pinhole.x - 1,
      pinhole.y,
      pinhole.z
    );

    const screenDistance =
      screenX -
      pinhole.x;

    const screenBottomY =
      0.0;

    const screenTopY =
      5.0;

    const screenHalfWidth =
      2.0;

    const near =
      camera.near;

    const left =
      (-screenHalfWidth /
        screenDistance) *
      near;

    const right =
      (screenHalfWidth /
        screenDistance) *
      near;

    /*
       Preserve the vertical sign correction established in
       the aligned pinhole version. The displayed texture is
       rotated 180 degrees on the physical screen.
    */

    const bottom =
      (-(screenTopY -
        pinhole.y) /
        screenDistance) *
      near;

    const top =
      (-(screenBottomY -
        pinhole.y) /
        screenDistance) *
      near;

    camera.projectionMatrix.makePerspective(
      left,
      right,
      top,
      bottom,
      near,
      camera.far
    );

    camera.projectionMatrixInverse
      .copy(
        camera.projectionMatrix
      )
      .invert();

    camera.updateMatrixWorld(
      true
    );

    camera.layers.set(
      OBJECT_LAYER
    );

    camera.layers.enable(
      PROJECTION_ONLY_LAYER
    );

    const previousTarget =
      gl.getRenderTarget();

    const previousAutoClear =
      gl.autoClear;

    const previousClearColor =
      new THREE.Color();

    gl.getClearColor(
      previousClearColor
    );

    const previousClearAlpha =
      gl.getClearAlpha();

    const previousXr =
      gl.xr.enabled;

    gl.xr.enabled = false;
    gl.autoClear = true;

    gl.setRenderTarget(
      sharpTarget
    );

    gl.setClearColor(
      0xf2f6f7,
      1
    );

    gl.clear(
      true,
      true,
      true
    );

    gl.render(
      scene,
      camera
    );

    /*
       =====================================================
       2. CALCULATE THE CIRCLE OF CONFUSION
       =====================================================

       Treat the whole plant as being at one distance u.

       For:
         D = aperture diameter
         u = object distance
         v = screen distance

       geometric blur DIAMETER on the screen is:

         B = D * (1 + v / u)

       Therefore the blur RADIUS is:

         R = (D / 2) * (1 + v / u)
    */

    const safeObjectDistance =
      Math.max(
        objectDistance,
        0.001
      );

    const blurRadiusWorld =
      (pinholeDiameter / 2) *
      (
        1 +
        screenDistance /
          safeObjectDistance
      );

    /*
       Convert physical screen units into texture UV.

       Screen:
         world Z width = 4
         world Y height = 5

       Using different UV scales preserves a physically
       circular blur on the rectangular 4 x 5 screen.
    */

    blurPass.material.uniforms
      .blurRadiusUv.value.set(
        blurRadiusWorld / 4.0,
        blurRadiusWorld / 5.0
      );

    blurPass.material.uniforms
      .tSharp.value =
      sharpTarget.texture;

    /*
       =====================================================
       3. APPLY ONE SMOOTH CIRCULAR APERTURE BLUR
       =====================================================
    */

    gl.setRenderTarget(
      renderTarget
    );

    gl.setClearColor(
      0xf2f6f7,
      1
    );

    gl.clear(
      true,
      true,
      true
    );

    gl.render(
      blurPass.scene,
      blurPass.camera
    );

    /*
       Restore the main renderer state.
    */

    gl.setRenderTarget(
      previousTarget
    );

    gl.setClearColor(
      previousClearColor,
      previousClearAlpha
    );

    gl.autoClear =
      previousAutoClear;

    gl.xr.enabled =
      previousXr;
  });

  return null;
}

/* =========================================================
   PROJECTION CHAMBER

   Adds a floor and roof between the pinhole wall and the
   screen so the projection region reads as an optical box.
========================================================= */


function ChamberBlock({
  position,
  size,
  blockRef,
  color = "#b9b1a2",
}) {
  return (
    <group
      ref={blockRef}
      position={position}
      onUpdate={(object) => {
        object.layers.set(
          APPARATUS_LAYER
        );
      }}
    >
      <mesh
        castShadow
        onUpdate={(object) => {
          object.layers.set(
            APPARATUS_LAYER
          );
        }}
      >
        <boxGeometry args={size} />
        <meshStandardMaterial
          color={color}
          roughness={0.95}
        />
      </mesh>
    </group>
  );
}

function ProjectionChamber({
  pinholeX,
  screenX,
}) {
  const { camera } = useThree();

  const positiveZWallRef =
    useRef(null);

  const negativeZWallRef =
    useRef(null);

  const ceilingGroupRef =
    useRef(null);

  const cameraDirectionRef =
    useRef(
      new THREE.Vector3()
    );

  const straightDownRef =
    useRef(
      new THREE.Vector3(
        0,
        -1,
        0
      )
    );

  const slabThickness = 0.20;

  /*
     Extend the chamber through the rear screen's
     full thickness so the floor, roof, and side
     walls meet the back wall cleanly.
  */
  const backWallThickness = 0.04;

  const backOverlap =
    backWallThickness / 2;

  const length =
    screenX -
    pinholeX +
    backOverlap;

  const centreX =
    (pinholeX +
      screenX +
      backOverlap) /
    2;

  const chamberWidth = 4.0;
  const chamberHeight = 5.0;

  /*
     The floor/roof intentionally overlap the rear screen slightly,
     but the SIDE walls stop at the inside faces of the front/rear
     slabs. This avoids overlapping box volumes and reduces z-fighting.
  */

  const frontWallThickness = 0.04;

  const sideWallStartX =
    pinholeX + frontWallThickness;

  const sideWallEndX =
    screenX - backWallThickness;

  const sideWallLength =
    sideWallEndX - sideWallStartX;

  const sideWallCentreX =
    (sideWallStartX + sideWallEndX) / 2;

  /*
     Keep only the FAR side wall visible.

     IMPORTANT: React no longer owns the `visible` property on these
     two walls. Visibility is controlled imperatively here only, so a
     slider/state re-render cannot briefly restore an old JSX value.
  */

  const updateChamberVisibility = () => {
    if (
      positiveZWallRef.current &&
      negativeZWallRef.current
    ) {
      const cameraOnPositiveZ =
        camera.position.z >= 0;

      positiveZWallRef.current.visible =
        !cameraOnPositiveZ;

      negativeZWallRef.current.visible =
        cameraOnPositiveZ;
    }

    if (
      ceilingGroupRef.current
    ) {
      /*
         Once the camera is looking steeply down into the chamber,
         remove the ceiling so the optical path stays readable.

         Hide below 50° from straight down
         (= more than 40° downward from horizontal).

         Restore only after 55° from straight down, giving a small
         hysteresis band so the roof cannot flicker at the boundary.
      */
      camera.getWorldDirection(
        cameraDirectionRef.current
      );

      const angleFromStraightDown =
        cameraDirectionRef.current.angleTo(
          straightDownRef.current
        );

      const hideThreshold =
        THREE.MathUtils.degToRad(
          50
        );

      const showThreshold =
        THREE.MathUtils.degToRad(
          55
        );

      if (
        ceilingGroupRef.current.visible &&
        angleFromStraightDown <
          hideThreshold
      ) {
        ceilingGroupRef.current.visible =
          false;
      } else if (
        !ceilingGroupRef.current.visible &&
        angleFromStraightDown >
          showThreshold
      ) {
        ceilingGroupRef.current.visible =
          true;
      }
    }
  };

  useLayoutEffect(() => {
    updateChamberVisibility();
  }, [camera]);

  useFrame(() => {
    updateChamberVisibility();
  });

  return (
    <>
      <ChamberBlock
        position={[
          centreX,
          -slabThickness / 2,
          0,
        ]}
        size={[
          length,
          slabThickness,
          chamberWidth,
        ]}
        color="#b8bdbe"
      />

      <group
        ref={ceilingGroupRef}
      >
        <ChamberBlock
          position={[
            centreX,
            chamberHeight +
              slabThickness / 2,
            0,
          ]}
          size={[
            length,
            slabThickness,
            chamberWidth,
          ]}
          color="#b8bdbe"
        />

        {/* Slightly differentiated chamber-facing underside of ceiling */}

        <mesh
          position={[
            centreX,
            chamberHeight -
              0.0006,
            0,
          ]}
          rotation={[
            Math.PI / 2,
            0,
            0,
          ]}
          onUpdate={(object) => {
            object.layers.set(
              APPARATUS_LAYER
            );
          }}
        >
          <planeGeometry
            args={[
              length,
              chamberWidth,
            ]}
          />

          <meshStandardMaterial
            color="#b1b7b8"
            roughness={0.95}
            side={
              THREE.DoubleSide
            }
          />
        </mesh>
      </group>

      <ChamberBlock
        blockRef={positiveZWallRef}
        position={[
          sideWallCentreX,
          chamberHeight / 2,
          chamberWidth / 2 -
            slabThickness / 2,
        ]}
        size={[
          sideWallLength,
          chamberHeight,
          slabThickness,
        ]}
      />

      <ChamberBlock
        blockRef={negativeZWallRef}
        position={[
          sideWallCentreX,
          chamberHeight / 2,
          -chamberWidth / 2 +
            slabThickness / 2,
        ]}
        size={[
          sideWallLength,
          chamberHeight,
          slabThickness,
        ]}
      />
    </>
  );
}

/* =========================================================
   SCREEN
========================================================= */

function Screen({
  x,
  pinhole,
  plantGroupRef,
  pinholeDiameter,
  objectDistance,
}) {
  const renderTarget =
    useMemo(
      () =>
        new THREE.WebGLRenderTarget(
          1024,
          1280,
          {
            minFilter:
              THREE.LinearFilter,
            magFilter:
              THREE.LinearFilter,

            format:
              THREE.RGBAFormat,

            depthBuffer: true,
            stencilBuffer: false,
          }
        ),
      []
    );

  useEffect(() => {
    return () =>
      renderTarget.dispose();
  }, [renderTarget]);

  return (
    <>
      {/* SCREEN BODY */}

      <mesh
        position={[
          x,
          2.5,
          0,
        ]}
        castShadow
        onUpdate={(object) => {
          object.layers.set(
            APPARATUS_LAYER
          );
        }}
      >
        <boxGeometry
          args={[
            0.04,
            5.0,
            4.0,
          ]}
        />

        <meshStandardMaterial
          color="#f2f6f7"
          roughness={0.8}
        />
      </mesh>

      {/* PROJECTED IMAGE */}

      <ProjectedScreenImage
        x={x}
        renderTarget={
          renderTarget
        }
      />

      {/* ACTUAL OFFSCREEN CAMERA */}

      <ProjectionRenderer
        pinhole={pinhole}
        screenX={x}
        plantGroupRef={
          plantGroupRef
        }
        renderTarget={
          renderTarget
        }
        pinholeDiameter={
          pinholeDiameter
        }
        objectDistance={
          objectDistance
        }
      />
    </>
  );
}

/* =========================================================
   PROJECTED SCREEN IMAGE

   The render target is rotated 180 degrees.

   That produces:

       top    -> bottom
       bottom -> top
       left   -> right
       right  -> left

   which is the inverted pinhole-camera image.
========================================================= */

function ProjectedScreenImage({
  x,
  renderTarget,
}) {
  const materialRef =
    useRef(null);

  useEffect(() => {
    if (
      !materialRef.current
    ) {
      return;
    }

    const texture =
      renderTarget.texture;

    texture.center.set(
      0.5,
      0.5
    );

    /*
       The render target is already a
       representation of the actual 3D object.

       Rotate it 180 degrees for the
       pinhole inversion.
    */

    texture.rotation =
      Math.PI;

    texture.needsUpdate =
      true;
  }, [renderTarget]);

  return (
    <mesh
      position={[
        x - 0.021,
        2.5,
        0,
      ]}
      rotation={[
        0,
        Math.PI / 2,
        0,
      ]}
      renderOrder={1}
      onUpdate={(object) => {
        object.layers.set(
          APPARATUS_LAYER
        );
      }}
    >
      <planeGeometry
        args={[
          4.0,
          5.0,
        ]}
      />

      <meshBasicMaterial
        ref={materialRef}
        map={
          renderTarget.texture
        }
        transparent
        opacity={0.98}
        depthWrite={false}
        side={
          THREE.DoubleSide
        }
        toneMapped={false}
      />
    </mesh>
  );
}

/* =========================================================
   MAIN CAMERA LAYERS

   The normal camera sees:

       layer 0 = plant
       layer 1 = rays
       layer 2 = apparatus
========================================================= */

function MainCameraLayers() {
  const { camera } =
    useThree();

  useEffect(() => {
    camera.layers.enable(
      OBJECT_LAYER
    );

    camera.layers.enable(
      RAY_LAYER
    );

    camera.layers.enable(
      APPARATUS_LAYER
    );

    camera.layers.enable(
      MARKER_LAYER
    );
  }, [camera]);

  return null;
}

/* =========================================================
   SHADOW-CASTING LIGHT

   The apparatus lives on layer 2, so the shadow camera must
   explicitly see that layer as well as the normal object layer.
========================================================= */

function ShadowCastingLight() {
  const lightRef =
    useRef(null);

  useEffect(() => {
    if (!lightRef.current) {
      return;
    }

    lightRef.current.shadow.camera.layers.enable(
      OBJECT_LAYER
    );

    lightRef.current.shadow.camera.layers.enable(
      APPARATUS_LAYER
    );

    lightRef.current.shadow.camera.updateProjectionMatrix();
  }, []);

  return (
    <directionalLight
      ref={lightRef}
      position={[
        4,
        7,
        5,
      ]}
      intensity={3}
      castShadow
      shadow-mapSize-width={2048}
      shadow-mapSize-height={2048}
      shadow-camera-left={-12}
      shadow-camera-right={12}
      shadow-camera-top={10}
      shadow-camera-bottom={-10}
      shadow-camera-near={0.5}
      shadow-camera-far={35}
      shadow-bias={-0.00025}
      shadow-normalBias={0.02}
      shadow-radius={4}
    />
  );
}


/* =========================================================
   CAMERA PRESETS

   Smoothly moves both the main camera and OrbitControls target.
   After the transition, normal orbiting is restored.
========================================================= */

function CameraPresetController({
  preset,
  objectDistance,
  controlsRef,
  resetToken,
}) {
  const { camera } =
    useThree();

  const transitionRef =
    useRef(null);

  /*
     Track the sunflower's world X position separately from
     camera-preset changes.

     Object-distance changes must NOT re-run the active camera
     preset. The only exception is Object view, where both the
     camera and OrbitControls target translate by exactly the
     same amount as the sunflower. This preserves the current
     camera-to-target vector, so neither angle nor zoom changes.
  */
  const previousObjectXRef =
    useRef(
      -objectDistance
    );

  const getPreset =
    () => {
      const objectX =
        -objectDistance;

      const opticalMidX =
        (objectX + 4.5) / 2;

      switch (preset) {
        case "side":
          return {
            position:
              new THREE.Vector3(
                opticalMidX,
                3.25,
                14.5
              ),
            target:
              new THREE.Vector3(
                opticalMidX,
                2.15,
                0
              ),
          };

        case "object":
          return {
            position:
              new THREE.Vector3(
                objectX - 2.8,
                4.0,
                6.2
              ),
            target:
              new THREE.Vector3(
                objectX,
                2.45,
                0
              ),
          };

        case "screen":
          return {
            position:
              new THREE.Vector3(
                1.15,
                2.85,
                2.8
              ),
            target:
              new THREE.Vector3(
                4.46,
                2.5,
                0
              ),
          };

        case "pinhole":
          return {
            /*
               Chamber-side view looking straight through the
               aperture in the direction of the object.
            */
            position:
              new THREE.Vector3(
                0.70,
                2.15,
                0
              ),
            target:
              new THREE.Vector3(
                objectX,
                2.15,
                0
              ),
          };

        case "optics":
        default:
          return {
            position:
              new THREE.Vector3(
                7,
                4.5,
                10
              ),
            target:
              new THREE.Vector3(
                0,
                2.0,
                0
              ),
          };
      }
    };

  /*
     Camera transitions happen ONLY when the user chooses a
     different preset. Object distance is intentionally absent
     from this dependency list.
  */
  useEffect(() => {
    if (!controlsRef.current) {
      return;
    }

    const destination =
      getPreset();

    transitionRef.current = {
      startPosition:
        camera.position.clone(),
      startTarget:
        controlsRef.current.target.clone(),
      endPosition:
        destination.position,
      endTarget:
        destination.target,
      progress: 0,
    };

    controlsRef.current.enabled =
      false;

    /*
       Reset the tracking reference whenever a preset is chosen
       so Object view begins following from the current sunflower
       position rather than from a stale distance.
    */
    previousObjectXRef.current =
      -objectDistance;
  }, [
    preset,
    resetToken,
    camera,
    controlsRef,
  ]);

  /*
     Distance-slider behaviour.

     Side / Optics / Screen / Pinhole:
       camera and target remain completely fixed.

     Object:
       translate camera and target together by the sunflower's
       X displacement. Because the same delta is applied to both,
       camera.position - target is unchanged exactly.
  */
  useEffect(() => {
    const objectX =
      -objectDistance;

    const previousObjectX =
      previousObjectXRef.current;

    const deltaX =
      objectX -
      previousObjectX;

    previousObjectXRef.current =
      objectX;

    if (
      preset !== "object" ||
      !controlsRef.current ||
      Math.abs(deltaX) <
        1e-9
    ) {
      return;
    }

    camera.position.x +=
      deltaX;

    controlsRef.current.target.x +=
      deltaX;

    /*
       If the slider moves while the preset transition itself is
       still animating, translate the whole transition path too.
       This avoids a snap and still preserves the Object-view angle.
    */
    if (
      transitionRef.current
    ) {
      transitionRef.current
        .startPosition.x +=
        deltaX;

      transitionRef.current
        .startTarget.x +=
        deltaX;

      transitionRef.current
        .endPosition.x +=
        deltaX;

      transitionRef.current
        .endTarget.x +=
        deltaX;
    }

    controlsRef.current.update();
  }, [
    objectDistance,
    preset,
    camera,
    controlsRef,
  ]);

  useEffect(() => {
    return () => {
      if (
        controlsRef.current
      ) {
        controlsRef.current.enabled =
          true;
      }
    };
  }, [controlsRef]);

  useFrame(
    (
      _state,
      delta
    ) => {
      const transition =
        transitionRef.current;

      if (
        !transition ||
        !controlsRef.current
      ) {
        return;
      }

      transition.progress =
        Math.min(
          1,
          transition.progress +
            delta * 2.25
        );

      const t =
        transition.progress;

      /*
         Smoothstep easing.
      */
      const eased =
        t *
        t *
        (3 - 2 * t);

      camera.position.lerpVectors(
        transition.startPosition,
        transition.endPosition,
        eased
      );

      controlsRef.current.target
        .lerpVectors(
          transition.startTarget,
          transition.endTarget,
          eased
        );

      controlsRef.current.update();

      if (t >= 1) {
        camera.position.copy(
          transition.endPosition
        );

        controlsRef.current.target.copy(
          transition.endTarget
        );

        controlsRef.current.update();

        controlsRef.current.enabled =
          true;

        transitionRef.current =
          null;
      }
    }
  );

  return null;
}



/* =========================================================
   ADAPTIVE CAMERA SENSITIVITY

   OrbitControls should feel precise when zoomed in and quicker
   when zoomed out. The current app has mouse panning disabled,
   so the important value here is rotateSpeed; panSpeed is kept
   in sync in case panning is enabled later.
========================================================= */

function AdaptiveControlSensitivity({
  controlsRef,
  preset,
}) {
  const { camera } =
    useThree();

  useFrame(() => {
    const controls =
      controlsRef.current;

    if (!controls) {
      return;
    }

    const distance =
      camera.position.distanceTo(
        controls.target
      );

    /*
       Close to the target:
         ~0.28x mouse sensitivity

       Far from the target:
         ~0.90x mouse sensitivity

       Smoothly blend between them so there is no noticeable
       threshold or jump while zooming.
    */
    const t =
      THREE.MathUtils.smoothstep(
        distance,
        3.5,
        13.0
      );

    if (preset === "pinhole") {
      /*
         Extra-precise "hack" for the through-the-pinhole view.

         Even when relatively zoomed out, dragging remains much
         slower than in the other camera presets so tiny framing
         adjustments are easier to control.
      */
      controls.rotateSpeed =
        THREE.MathUtils.lerp(
          0.04,
          0.14,
          t
        );

      controls.panSpeed =
        THREE.MathUtils.lerp(
          0.05,
          0.16,
          t
        );
    } else {
      controls.rotateSpeed =
        THREE.MathUtils.lerp(
          0.28,
          0.90,
          t
        );

      controls.panSpeed =
        THREE.MathUtils.lerp(
          0.30,
          1.00,
          t
        );
    }
  });

  return null;
}


/* =========================================================
   PINHOLE VIEW GUIDE

   The camera tracker lives INSIDE <Canvas>, where useThree/useFrame
   are legal. It reports only simple guide data to the DOM overlay.
========================================================= */

function PinholeGuideTracker({
  active,
  objectDistance,
  onGuideChange,
}) {
  const { camera } =
    useThree();

  const lastRef =
    useRef({
      objectY: null,
      label: null,
    });

  useFrame(() => {
    if (!active) {
      return;
    }

    const pinholeX = 0;
    const pinholeY = 2.15;
    const objectX =
      -objectDistance;

    /*
       Extend the REAL line from the camera through the pinhole
       until it reaches the sunflower's X-plane.

       C + t(P - C), solved for x = objectX.

       This is the point on the object plane that the observer is
       actually sighting through the aperture.
    */
    const denominator =
      pinholeX -
      camera.position.x;

    if (
      Math.abs(denominator) <
      0.0001
    ) {
      return;
    }

    const t =
      (objectX -
        camera.position.x) /
      denominator;

    const objectY =
      camera.position.y +
      t *
        (pinholeY -
          camera.position.y);

    const verticalDifference =
      objectY -
      pinholeY;

    let label = "Level";

    if (
      verticalDifference >
      0.10
    ) {
      label = "Looking up";
    } else if (
      verticalDifference <
      -0.10
    ) {
      label = "Looking down";
    }

    const last =
      lastRef.current;

    if (
      last.objectY === null ||
      Math.abs(
        objectY -
        last.objectY
      ) > 0.015 ||
      label !== last.label
    ) {
      lastRef.current = {
        objectY,
        label,
      };

      onGuideChange({
        objectY,
        label,
      });
    }
  });

  return null;
}


function PinholeViewInset({
  objectY,
  label,
}) {
  /*
     Map the real vertical dimensions of the apparatus into the
     little side-view drawing. The floor is at about -0.72 and the
     flower head is around y = 3.9, so this scale lets the endpoint
     visibly land on flower / stem / pot regions.
  */
  const worldYToSvg =
    (worldY) =>
      80 -
      (worldY + 0.72) *
        12.5;

  const objectX = 24;
  const pinholeX = 101;
  const observerX = 126;

  const pinholeSvgY =
    worldYToSvg(
      2.15
    );

  const objectSvgY =
    worldYToSvg(
      objectY
    );

  /*
     The observer marker is placed on the SAME mathematical SVG
     line as the object point and pinhole. This removes the kink:
     object -> pinhole -> observer is one perfectly straight line.
  */
  const lineSlope =
    (pinholeSvgY -
      objectSvgY) /
    (pinholeX -
      objectX);

  const observerSvgY =
    pinholeSvgY +
    lineSlope *
      (observerX -
        pinholeX);

  /*
     Stop the red sightline just short of the eye centre so the
     observer symbol remains visually clear. The endpoint still
     lies on exactly the same straight sightline.
  */
  const eyeSideTrim = 4.0;

  const eyeDx =
    observerX -
    pinholeX;

  const eyeDy =
    observerSvgY -
    pinholeSvgY;

  const eyeLength =
    Math.hypot(
      eyeDx,
      eyeDy
    );

  const lineEndX =
    observerX -
    (eyeDx / eyeLength) *
      eyeSideTrim;

  const lineEndY =
    observerSvgY -
    (eyeDy / eyeLength) *
      eyeSideTrim;

  return (
    <div
      style={{
        position: "absolute",
        right: "14px",
        top: "58px",
        zIndex: 10,
        width: "184px",
        transform:
          "scale(2)",
        transformOrigin:
          "top right",
        padding:
          "10px 10px 8px 10px",
        borderRadius: "10px",
        background:
          "rgba(255,255,255,0.94)",
        boxShadow:
          "0 2px 10px rgba(0,0,0,0.14)",
        fontFamily:
          "'IBM Plex Sans', sans-serif",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontFamily: "'Fraunces', serif",
          fontSize: "12px",
          fontWeight: 560,
          marginBottom: "6px",
          color: "#263b4a",
        }}
      >
        Through the pinhole
      </div>

      <svg
        width="164"
        height="110"
        viewBox="0 0 164 110"
        style={{
          display: "block",
          overflow: "visible",
        }}
      >
        {/* Ground */}
        <line
          x1="8"
          y1="80"
          x2="140"
          y2="80"
          stroke="#97a286"
          strokeWidth="2"
        />

        {/* Simplified sunflower, vertically matched to the model */}
        <g>
          {/* flower head */}
          <circle
            cx={objectX}
            cy={
              worldYToSvg(
                3.90
              )
            }
            r="10"
            fill="#f5b400"
            stroke="#9c6f00"
            strokeWidth="1.2"
          />
          <circle
            cx={objectX}
            cy={
              worldYToSvg(
                3.90
              )
            }
            r="4"
            fill="#593318"
          />

          {/* stem */}
          <line
            x1={objectX}
            y1={
              worldYToSvg(
                3.05
              )
            }
            x2={objectX}
            y2={
              worldYToSvg(
                0.60
              )
            }
            stroke="#3f8635"
            strokeWidth="4"
            strokeLinecap="round"
          />

          {/* leaves */}
          <ellipse
            cx={objectX - 7}
            cy={
              worldYToSvg(
                2.25
              )
            }
            rx="8"
            ry="3.5"
            transform={`rotate(62 ${objectX - 7} ${worldYToSvg(2.25)})`}
            fill="#397d2f"
          />
          <ellipse
            cx={objectX + 7}
            cy={
              worldYToSvg(
                1.55
              )
            }
            rx="8"
            ry="3.5"
            transform={`rotate(-62 ${objectX + 7} ${worldYToSvg(1.55)})`}
            fill="#397d2f"
          />

          {/* pot */}
          <path
            d={`
              M ${objectX - 8} ${worldYToSvg(0.48)}
              L ${objectX + 8} ${worldYToSvg(0.48)}
              L ${objectX + 6} ${worldYToSvg(-0.62)}
              L ${objectX - 6} ${worldYToSvg(-0.62)}
              Z
            `}
            fill="#c65f38"
            stroke="#9b482c"
            strokeWidth="1"
          />
        </g>

        {/* Pinhole wall */}
        <rect
          x={pinholeX - 2.5}
          y="13"
          width="5"
          height="67"
          rx="1.5"
          fill="#b9b1a2"
        />

        <circle
          cx={pinholeX}
          cy={pinholeSvgY}
          r="2.4"
          fill="#2d2823"
        />

        {/* One straight sightline: object -> pinhole -> observer */}
        <line
          x1={objectX}
          y1={objectSvgY}
          x2={lineEndX}
          y2={lineEndY}
          stroke="#e63946"
          strokeWidth="2.2"
          strokeLinecap="round"
        />

        {/* Exact object point currently being sighted */}
        <circle
          cx={objectX}
          cy={objectSvgY}
          r="3.2"
          fill="#e63946"
          stroke="#ffffff"
          strokeWidth="1"
        />

        {/* Emphasise the pivot at the aperture */}
        <circle
          cx={pinholeX}
          cy={pinholeSvgY}
          r="3.0"
          fill="#e63946"
        />

        {/* Classic ray-diagram observer eye, based on the reference */}
        <g
          transform={`
            translate(${observerX} ${observerSvgY})
            rotate(${Math.atan2(
              observerSvgY -
                pinholeSvgY,
              observerX -
                pinholeX
            ) * (180 / Math.PI)})
            scale(-0.48 0.48)
          `}
        >
          {/*
             Pointed front at the left, with gently curving upper
             and lower outlines opening toward the rear.
          */}
          <path
            d="
              M -15 0
              C -7 -1 -1 -1 5 -3
              C 9 -4.5 12 -6.5 15 -9
            "
            fill="none"
            stroke="#3f4b52"
            strokeWidth="1.8"
            strokeLinecap="round"
          />

          <path
            d="
              M -15 0
              C -8 2 -2 5 4 9
              C 8 11.5 11 13.5 14 16
            "
            fill="none"
            stroke="#3f4b52"
            strokeWidth="1.8"
            strokeLinecap="round"
          />

          {/*
             Short rear continuations, like the textbook symbol.
          */}
          <path
            d="
              M 15 -9
              C 18 -11 20 -13 21 -16
            "
            fill="none"
            stroke="#3f4b52"
            strokeWidth="1.8"
            strokeLinecap="round"
          />

          <path
            d="
              M 14 16
              L 18 20
            "
            fill="none"
            stroke="#3f4b52"
            strokeWidth="1.8"
            strokeLinecap="round"
          />

          {/*
             Vertical green lens near the rear of the eye.
          */}
          <path
            d="
              M 8 -7
              C 12 -4 13 4 10 10
              C 8 13 6 13 5 10
              C 4 5 5 -3 8 -7
              Z
            "
            fill="#2f7d4d"
            stroke="#225e3a"
            strokeWidth="1.1"
          />
        </g>

        {/* Bottom labels: object and observer share one baseline */}
        <text
          x={objectX}
          y="98"
          textAnchor="middle"
          fontSize="8.5"
          fontFamily="IBM Plex Mono, monospace"
          fontWeight="500"
          letterSpacing="0.04em"
          fill="#4a443b"
        >
          OBJECT
        </text>

        <text
          x={observerX}
          y="98"
          textAnchor="middle"
          fontSize="8.5"
          fontFamily="IBM Plex Mono, monospace"
          fontWeight="500"
          letterSpacing="0.04em"
          fill="#4a443b"
        >
          OBSERVER
        </text>

        {/* Pinhole gets its own callout beside the aperture */}
        <g pointerEvents="none">
          <text
            x={pinholeX - 9}
            y={pinholeSvgY - 10}
            textAnchor="end"
            fontSize="8.5"
            fontFamily="IBM Plex Mono, monospace"
            fontWeight="500"
            letterSpacing="0.04em"
            fill="#4a443b"
          >
            PINHOLE
          </text>
          <line
            x1={pinholeX - 8}
            y1={pinholeSvgY - 7}
            x2={pinholeX - 3.5}
            y2={pinholeSvgY - 2.5}
            stroke="#6e736e"
            strokeWidth="1"
            strokeLinecap="round"
          />
        </g>
      </svg>

      <div
        style={{
          marginTop: "6px",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: "10px",
          color: "#3f392f",
          display: "flex",
          justifyContent:
            "space-between",
          alignItems: "center",
        }}
      >
        <span>
          Sightline:
        </span>

        <strong>
          {label}
        </strong>
      </div>
    </div>
  );
}


/* =========================================================
   SCENE
========================================================= */

function SceneWithRays({
  rayCount,
  objectDistance,
  pinholeDiameter,
  viewMode,
  cameraPreset,
  cameraResetToken,
  onPinholeGuideChange,
}) {
  const plantGroupRef =
    useRef(null);

  const sunflowerRef =
    useRef(null);

  const potRef =
    useRef(null);

  const controlsRef =
    useRef(null);

  const plantPosition =
    useMemo(
      () =>
        new THREE.Vector3(
          -objectDistance,
          0,
          0
        ),
      [objectDistance]
    );

  const plantRotation =
    Math.PI / 2;

  const wallX = 0;

  const screenX = 4.5;

  const isIdealPinhole =
    pinholeDiameter <=
    IDEAL_PINHOLE_SLIDER_VALUE +
      0.000001;

  /*
     The special final slider notch represents an ideal pinhole:
     zero finite-aperture spread/blur in the optical model.

     Keep only a tiny visible hole in the wall so the aperture
     remains legible in the 3D geometry.
  */
  const opticalPinholeDiameter =
    isIdealPinhole
      ? 0
      : pinholeDiameter;

  const visualPinholeDiameter =
    isIdealPinhole
      ? IDEAL_PINHOLE_VISUAL_DIAMETER
      : pinholeDiameter;

  const pinhole =
    useMemo(
      () =>
        new THREE.Vector3(
          wallX,
          2.15,
          0
        ),
      [wallX]
    );

  return (
    <>
      {/* CAMERA LAYERS */}

      <MainCameraLayers />

      <CameraPresetController
        preset={
          cameraPreset
        }
        objectDistance={
          objectDistance
        }
        controlsRef={
          controlsRef
        }
        resetToken={
          cameraResetToken
        }
      />

      <AdaptiveControlSensitivity
        controlsRef={
          controlsRef
        }
        preset={
          cameraPreset
        }
      />

      <PinholeGuideTracker
        active={
          cameraPreset ===
          "pinhole"
        }
        objectDistance={
          objectDistance
        }
        onGuideChange={
          onPinholeGuideChange
        }
      />

      {/* =================================================
          LIGHTING
      ================================================= */}

      <ambientLight
        intensity={2.0}
      />

      <ShadowCastingLight />

      {/* =================================================
          COMPLETE 3D PLANT

          This stays on layer 0.
      ================================================= */}

      <group
        ref={plantGroupRef}
        position={
          plantPosition
        }
        rotation={[
          0,
          plantRotation,
          0,
        ]}
      >
        <Sunflower
          sunflowerRef={
            sunflowerRef
          }
        />

        <Pot
          potRef={potRef}
        />
      </group>

      {/* =================================================
          OPTICAL VISUALISATION MODE

          Rays mode keeps the existing ray renderer unchanged.

          Light-cones mode is wired to the same plant, aperture,
          object-distance and screen data. Cone geometry comes next.
      ================================================= */}

      {viewMode === "rays" && (
        <SunflowerRays
          plantGroupRef={
            plantGroupRef
          }
          sunflowerRef={
            sunflowerRef
          }
          potRef={potRef}
          pinhole={pinhole}
          screenX={screenX}
          rayCount={rayCount}
          objectDistance={
            objectDistance
          }
          pinholeDiameter={
            opticalPinholeDiameter
          }
        />
      )}

      {viewMode === "cones" && (
        <SunflowerLightCones
          plantGroupRef={
            plantGroupRef
          }
          sunflowerRef={
            sunflowerRef
          }
          potRef={potRef}
          pinhole={pinhole}
          screenX={screenX}
          objectDistance={
            objectDistance
          }
          pinholeDiameter={
            opticalPinholeDiameter
          }
        />
      )}

      {/* "image" mode intentionally renders no optical overlay.
          The plant, chamber and projected screen image remain visible. */}

      {/* =================================================
          PINHOLE WALL

          Layer 2.
      ================================================= */}

      <PinholeWall
        x={wallX}
        holeY={pinhole.y}
        holeDiameter={
          visualPinholeDiameter
        }
      />

      {/* =================================================
          PROJECTION BOX

          Floor + roof between pinhole and screen.
          Layer 2.
      ================================================= */}

      <ProjectionChamber
        pinholeX={wallX}
        screenX={screenX}
      />

      {/* =================================================
          SCREEN

          Layer 2.
      ================================================= */}

      <Screen
        x={screenX}
        pinhole={pinhole}
        plantGroupRef={
          plantGroupRef
        }
        pinholeDiameter={
          opticalPinholeDiameter
        }
        objectDistance={
          objectDistance
        }
      />

      {/* =================================================
          PROJECTION-ONLY EXTERIOR GROUND

          This is the ground plane seen by the projection camera.
          It exists only on the object side of the pinhole so the
          projected image includes the outside floor, not ground
          unrealistically extending underneath the camera box.

          Projection-only layer (hidden from the main camera).
      ================================================= */}

      <mesh
        rotation={[
          -Math.PI / 2,
          0,
          0,
        ]}
        position={[
          -5.5,
          -0.72,
          0,
        ]}
        receiveShadow={false}
        onUpdate={(object) => {
          object.layers.set(
            PROJECTION_ONLY_LAYER
          );
        }}
      >
        <planeGeometry
          args={[
            11,
            12,
          ]}
        />

        <meshStandardMaterial
          color="#7f9a78"
          roughness={0.94}
        />
      </mesh>

      {/* =================================================
          GROUND

          Layer 2.
      ================================================= */}

      <mesh
        rotation={[
          -Math.PI / 2,
          0,
          0,
        ]}
        position={[
          -2.0,
          -0.72,
          0,
        ]}
        receiveShadow
        onUpdate={(object) => {
          object.layers.set(
            APPARATUS_LAYER
          );
        }}
      >
        <planeGeometry
          args={[
            20,
            12,
          ]}
        />

        <meshStandardMaterial
          color="#7f9a78"
          roughness={0.94}
        />
      </mesh>

      {/* =================================================
          CONTROLS
      ================================================= */}

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        enableZoom={
          cameraPreset !==
          "pinhole"
        }
        maxDistance={18}
        target={[
          0,
          2.0,
          0,
        ]}
        minPolarAngle={
          Math.PI * 0.04
        }
        maxPolarAngle={
          Math.PI * 0.75
        }
      />
    </>
  );
}

/* =========================================================
   APP
========================================================= */

function Pinhole3DLab() {
  const [
    rayCount,
    setRayCount,
  ] = useState(10);

  const [
    objectDistance,
    setObjectDistance,
  ] = useState(7.0);

  const [
    pinholeDiameter,
    setPinholeDiameter,
  ] = useState(0.20);

  const [
    viewMode,
    setViewMode,
  ] = useState("rays");

  const [
    cameraPreset,
    setCameraPreset,
  ] = useState("side");

  const [
    cameraResetToken,
    setCameraResetToken,
  ] = useState(0);

  const [
    pinholeGuide,
    setPinholeGuide,
  ] = useState({
    objectY: 2.15,
    label: "Level",
  });

  const resetSimulation =
    () => {
      setRayCount(10);
      setObjectDistance(7.0);
      setPinholeDiameter(0.20);
      setViewMode("rays");
      setCameraPreset("side");

      /*
         Force the Side preset to re-run even when Side is already
         selected but the user has manually orbited the camera.
      */
      setCameraResetToken(
        (value) =>
          value + 1
      );
    };

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        overflow: "hidden",
        background:
          "#daf3ff",
        fontFamily:
          "'IBM Plex Sans', sans-serif",
      }}
    >
      <Canvas
        shadows={{
          type:
            THREE.PCFSoftShadowMap,
        }}
        camera={{
          position: [
            7,
            4.5,
            10,
          ],
          fov: 45,
        }}
      >
        <SceneWithRays
          rayCount={
            rayCount
          }
          objectDistance={
            objectDistance
          }
          pinholeDiameter={
            pinholeDiameter
          }
          viewMode={
            viewMode
          }
          cameraPreset={
            cameraPreset
          }
          cameraResetToken={
            cameraResetToken
          }
          onPinholeGuideChange={
            setPinholeGuide
          }
        />
      </Canvas>

      {/* =================================================
          CAMERA PRESETS
      ================================================= */}

      <div
        style={{
          position: "absolute",
          top: "-5px",
          left: "50%",
          transform:
            "translateX(-50%) scale(2)",
          transformOrigin:
            "top center",
          zIndex: 10,
          display: "block",
          fontFamily:
            "IBM Plex Sans, sans-serif",
        }}
      >
        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "7px",
            fontWeight: 500,
            letterSpacing: "0.08em",
            color: "#4d6478",
            margin: "0 0 0px 4px",
          }}
        >
          VIEW
        </div>

        <div
          style={{
            display: "flex",
            gap: "2px",
            padding: "2px 3px",
            borderRadius: "6px",
            background: "rgba(255,255,255,0.90)",
            border: "1px solid rgba(89,106,122,0.14)",
            boxShadow: "0 12px 28px rgba(86,118,141,0.14)",
          }}
        >
          {[
          [
            "side",
            "Side",
            "Side-on view of object, aperture and screen",
          ],
          [
            "optics",
            "Optics",
            "Angled overview centred near the pinhole",
          ],
          [
            "object",
            "Object",
            "View toward the sunflower and incoming light",
          ],
          [
            "screen",
            "Screen",
            "View into the chamber toward the projected image",
          ],
          [
            "pinhole",
            "Pinhole",
            "Look straight through the pinhole toward the object",
          ],
        ].map(
          ([
            mode,
            label,
            title,
          ]) => {
            const selected =
              cameraPreset ===
              mode;

            return (
              <button
                key={mode}
                type="button"
                title={title}
                aria-pressed={selected}
                onClick={() => {
                  setCameraPreset(
                    mode
                  );

                  if (
                    mode ===
                    "pinhole"
                  ) {
                    setViewMode(
                      "image"
                    );
                  }
                }}
                style={{
                  padding:
                    "2px 6px",
                  borderRadius:
                    "6px",
                  border:
                    selected
                      ? "1px solid #50483e"
                      : "1px solid #c6beb1",
                  background:
                    selected
                      ? "linear-gradient(180deg, #f5b47a 0%, #f29b66 100%)"
                      : "#fffdf8",
                  color:
                    selected
                      ? "#243746"
                      : "#4d6478",
                  fontFamily:
                    "'IBM Plex Mono', monospace",
                  fontSize:
                    "8.8px",
                  fontWeight: 500,
                  letterSpacing:
                    "0.055em",
                  textTransform:
                    "uppercase",
                  whiteSpace:
                    "nowrap",
                  cursor:
                    "pointer",
                  boxShadow:
                    selected
                      ? "0 1px 3px rgba(0,0,0,0.18)"
                      : "0 1px 2px rgba(0,0,0,0.06)",
                }}
              >
                {label}
              </button>
            );
          }
        )}
        </div>
      </div>

      {cameraPreset ===
        "pinhole" && (
        <PinholeViewInset
          objectY={
            pinholeGuide.objectY
          }
          label={
            pinholeGuide.label
          }
        />
      )}

      {/* =================================================
          COMPACT CONTROLS
      ================================================= */}

      <div
        style={{
          position: "absolute",
          left: "10px",
          bottom: "10px",
          zIndex: 10,
          width: "172px",
          transform:
            "scale(2)",
          transformOrigin:
            "bottom left",
          padding: "6px 8px",
          borderRadius: "7px",
          background: "rgba(255,255,255,0.90)",
          boxShadow: "0 1px 6px rgba(0,0,0,0.14)",
          fontFamily: "'IBM Plex Sans', sans-serif",
          fontSize: "9px",
          lineHeight: 1.15,
        }}
      >
        {/* VIEW MODE */}

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "4px",
            marginBottom: "7px",
          }}
        >
          {[
            ["rays", "Rays"],
            ["cones", "Light cones"],
            ["image", "Image only"],
          ].map(([mode, label]) => {
            const selected =
              viewMode === mode;

            return (
              <button
                key={mode}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (
                    mode === "cones" &&
                    pinholeDiameter <=
                      IDEAL_PINHOLE_SLIDER_VALUE +
                        0.000001
                  ) {
                    setPinholeDiameter(
                      0.15
                    );
                  }

                  setViewMode(mode);
                }}
                style={{
                  padding: "5px 3px",
                  minHeight: "28px",
                  borderRadius: "6px",
                  border: selected
                    ? "1px solid #50483e"
                    : "1px solid #c6beb1",
                  background: selected
                    ? "linear-gradient(180deg, #f5b47a 0%, #f29b66 100%)"
                    : "#fffdf8",
                  color: selected
                    ? "#243746"
                    : "#3f3932",
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: "8.5px",
                  fontWeight: 500,
                  lineHeight: 1.05,
                  letterSpacing: "0.055em",
                  textTransform: "uppercase",
                  boxShadow: selected
                    ? "0 1px 3px rgba(0,0,0,0.18)"
                    : "0 1px 2px rgba(0,0,0,0.06)",
                  cursor: "pointer",
                  transition:
                    "background 120ms ease, color 120ms ease, border-color 120ms ease, transform 120ms ease",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* OBJECT DISTANCE */}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "2px",
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          <span
            title="Smaller = closer to pinhole"
            style={{ cursor: "help" }}
          >
            Object distance
          </span>
          <strong>{objectDistance.toFixed(1)}</strong>
        </div>

        <input
          title="Smaller = closer to pinhole"
          aria-label="Object distance"
          aria-valuetext={`${objectDistance.toFixed(1)} world units`}
          type="range"
          min="3.5"
          max="11"
          step="0.1"
          value={objectDistance}
          onChange={(event) =>
            setObjectDistance(
              Number(event.target.value)
            )
          }
          style={{
            width: "100%",
            height: "10px",
            margin: "0 0 5px 0",
          }}
        />

        {/* PINHOLE DIAMETER */}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "2px",
            fontFamily: "'IBM Plex Mono', monospace",
          }}
        >
          <span
            title="Larger = more ray spread and blur"
            style={{ cursor: "help" }}
          >
            Pinhole diameter
          </span>
          <strong
            style={{
              fontSize:
                pinholeDiameter <=
                IDEAL_PINHOLE_SLIDER_VALUE +
                  0.000001
                  ? "8px"
                  : "inherit",
              whiteSpace:
                "nowrap",
            }}
          >
            {pinholeDiameter <=
            IDEAL_PINHOLE_SLIDER_VALUE +
              0.000001
              ? "Ideal pinhole"
              : pinholeDiameter.toFixed(
                  2
                )}
          </strong>
        </div>

        <input
          title="Larger = more ray spread and blur"
          aria-label="Pinhole diameter"
          aria-valuetext={
            pinholeDiameter <=
            IDEAL_PINHOLE_SLIDER_VALUE +
              0.000001
              ? "Ideal pinhole"
              : `${pinholeDiameter.toFixed(2)} world units`
          }
          type="range"
          min={
            viewMode === "cones"
              ? "0.05"
              : "0.04"
          }
          max="0.50"
          step="0.01"
          value={pinholeDiameter}
          onChange={(event) =>
            setPinholeDiameter(
              Number(event.target.value)
            )
          }
          style={{
            width: "100%",
            height: "10px",
            margin: "0 0 5px 0",
          }}
        />        {/* NUMBER OF RAYS */}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "2px",
            fontFamily: "'IBM Plex Mono', monospace",
            color:
              viewMode !== "rays"
                ? "#aaa59d"
                : "inherit",
            opacity:
              viewMode !== "rays"
                ? 0.55
                : 1,
          }}
        >
          <span>Number of rays</span>
          <strong>{rayCount}</strong>
        </div>

        <input
          aria-label="Number of rays"
          aria-valuetext={`${rayCount} rays`}
          type="range"
          min="10"
          max="200"
          step="1"
          value={rayCount}
          disabled={
            viewMode !== "rays"
          }
          onChange={(event) =>
            setRayCount(
              Number(event.target.value)
            )
          }
          style={{
            width: "100%",
            height: "10px",
            margin: 0,
            opacity:
              viewMode !== "rays"
                ? 0.35
                : 1,
            cursor:
              viewMode !== "rays"
                ? "not-allowed"
                : "pointer",
          }}
        />

        <button
          type="button"
          onClick={
            resetSimulation
          }
          title="Reset simulation and camera"
          style={{
            width: "100%",
            marginTop: "7px",
            padding: "5px 6px",
            borderRadius: "6px",
            border:
              "1px solid #9e978d",
            background:
              "#fffdf8",
            color: "#263b4a",
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: "8.8px",
            fontWeight: 500,
            letterSpacing: "0.055em",
            textTransform: "uppercase",
            cursor: "pointer",
            boxShadow:
              "0 1px 2px rgba(0,0,0,0.06)",
          }}
        >
          Reset
        </button>


      </div>
    </div>
  );
}

/* =========================================================
   APP SHELL – LEARN / 3D LAB
========================================================= */

export default function App() {
  const [section, setSection] = useState("learn");
  const inLab = section === "lab";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        background: "#daf3ff",
        fontFamily: "sans-serif",
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,340..600;1,9..144,420..520&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');

        html, body, #root {
          width: 100%;
          height: 100%;
          margin: 0;
        }
        body { overflow: hidden; }
      `}</style>

      <nav
        aria-label="Main sections"
        style={{
          position: "absolute",
          top: "14px",
          right: "14px",
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: "6px",
          borderRadius: "14px",
          background: "rgba(255,255,255,0.94)",
          border: "1px solid rgba(89, 106, 122, 0.14)",
          boxShadow: "0 10px 28px rgba(70, 97, 120, 0.16)",
          backdropFilter: "blur(10px)",
        }}
      >
        {[
          ["learn", "Learn"],
          ["lab", "3D Lab"],
        ].map(([key, label]) => {
          const selected = section === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSection(key)}
              aria-pressed={selected}
              style={{
                border: 0,
                borderRadius: "8px",
                padding: "10px 18px",
                background: selected
                  ? "linear-gradient(180deg, #f5b47a 0%, #f29b66 100%)"
                  : "transparent",
                color: selected ? "#243746" : "#4d6478",
                boxShadow: selected
                  ? "0 6px 14px rgba(242,155,102,0.24)"
                  : "none",
                fontFamily: "'IBM Plex Sans', sans-serif",
                fontSize: "15px",
                fontWeight: 700,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
            >
              {label}
            </button>
          );
        })}
      </nav>

      <main
        style={{
          width: "100%",
          height: "100vh",
          overflowY: inLab ? "hidden" : "auto",
          overflowX: "hidden",
          position: "relative",
        }}
      >
        {section === "learn" ? (
          <PinholeOpticsLearn onOpen3D={() => setSection("lab")} />
        ) : (
          <Pinhole3DLab />
        )}
      </main>
    </div>
  );
}
