/**
 * The Charge ring: the local Duelist's Heavy Spell Charge, drawn as its own
 * SVG ring around the screen centre (a separate element from the reticle,
 * which it never touches; it stays up while Locked On, when the reticle
 * fades). It reads the snapshot's `chargeSeconds` through the shared Charge
 * windows (`duel/charge.ts`), so it always agrees with the simulation:
 *
 * - The inner ring fills clockwise from the top as the Charge builds, in
 *   ember orange.
 * - A gold band straddles the top: the Perfect Release window. The fill
 *   completes at the tick mark at the top, the Perfect Release point; inside
 *   the window the ring burns white-gold.
 * - Past the window the ring turns gold (the safe window) and an outer arc
 *   counts down the time left before Overcharge, shifting gold to red and
 *   pulsing ever faster as the Backfire nears.
 * - A release flies the ring out: a quick fade, a big white-gold flare for a
 *   Perfect Release, or a red shatter for a Backfire.
 */
import { chargeLevel, chargeStage, overchargeShare } from "../duel/charge";
import type { DuelEvent, DuelistId } from "../duel/duel";
import type { Tuning } from "../tuning";

export interface ChargeRingSettings {
  readonly confringo: Tuning["confringo"];
  readonly ring: Tuning["hud"]["chargeRing"];
}

export interface ChargeRing {
  /**
   * Shows the local Duelist's Charge after `seconds` of real time, reacting
   * to this frame's events. `visible` is false off the Duel or during the
   * Knockout shot.
   */
  readonly show: (
    chargeSeconds: number,
    events: readonly DuelEvent[],
    seconds: number,
    visible: boolean
  ) => void;
}

const svgNs = "http://www.w3.org/2000/svg";

/** The ring's geometry in its 100 × 100 view box. */
const centre = 50;
const innerRadius = 40;
const outerRadius = 47;

const circle = (parent: SVGElement, className: string, radius: number) => {
  const arc = document.createElementNS(svgNs, "circle");
  arc.setAttribute("class", className);
  arc.setAttribute("cx", `${centre}`);
  arc.setAttribute("cy", `${centre}`);
  arc.setAttribute("r", `${radius}`);
  // Lengths along the ring as shares of it, so dashes read as 0 to 1.
  arc.setAttribute("pathLength", "1");
  // Start at the top and run clockwise.
  arc.setAttribute("transform", `rotate(-90 ${centre} ${centre})`);
  parent.append(arc);

  return arc;
};

type Flourish = "backfire" | "perfect" | "release";

export const createChargeRing = (
  root: HTMLElement,
  settings: ChargeRingSettings,
  localId: DuelistId
): ChargeRing => {
  const { confringo, ring } = settings;
  const svg = document.createElementNS(svgNs, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  root.append(svg);

  circle(svg, "charge-track", innerRadius);
  const band = circle(svg, "charge-window", innerRadius);
  circle(svg, "charge-fill", innerRadius);
  circle(svg, "charge-safe", outerRadius);

  // The Perfect Release point: a tick across the ring at the top.
  const mark = document.createElementNS(svgNs, "line");
  mark.setAttribute("class", "charge-mark");
  mark.setAttribute("x1", `${centre}`);
  mark.setAttribute("x2", `${centre}`);
  mark.setAttribute("y1", `${centre - innerRadius - 6}`);
  mark.setAttribute("y2", `${centre - innerRadius + 6}`);
  svg.append(mark);

  // The Perfect Release window as a band across the top: `late` past the
  // point, then (after a gap) `early` before it, up to the end of the ring.
  const early = confringo.perfectRelease.early / confringo.fullSeconds;
  const late = confringo.perfectRelease.late / confringo.fullSeconds;
  band.setAttribute(
    "stroke-dasharray",
    `${late} ${1 - late - early} ${early} 1`
  );

  let lingering = 0;
  let pulse = 0;

  const flourish = (kind: Flourish) => {
    const seconds = {
      backfire: ring.backfireSeconds,
      perfect: ring.perfectSeconds,
      release: ring.releaseSeconds,
    }[kind];

    lingering = seconds;
    root.dataset.flourish = kind;

    const frames: Record<Flourish, Keyframe[]> = {
      backfire: [
        { opacity: 1, transform: "scale(1) rotate(0deg)" },
        { offset: 0.2, opacity: 0.9, transform: "scale(0.85) rotate(-8deg)" },
        { opacity: 0, transform: "scale(1.3) rotate(10deg)" },
      ],
      perfect: [
        { opacity: 1, transform: "scale(1)" },
        { offset: 0.25, opacity: 1, transform: "scale(1.25)" },
        { opacity: 0, transform: "scale(1.9)" },
      ],
      release: [
        { opacity: 1, transform: "scale(1)" },
        { opacity: 0, transform: "scale(1.35)" },
      ],
    };

    svg.animate(frames[kind], {
      duration: seconds * 1000,
      easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    });
  };

  return {
    show: (chargeSeconds, events, seconds, visible) => {
      for (const event of events) {
        if (event.type === "perfect-release" && event.duelistId === localId) {
          flourish("perfect");
        } else if (event.type === "backfire" && event.duelistId === localId) {
          flourish("backfire");
        } else if (
          event.type === "spell-cast" &&
          event.spell.kind === "confringo" &&
          event.spell.casterId === localId &&
          !event.spell.empowered
        ) {
          flourish("release");
        }
      }

      lingering = Math.max(lingering - seconds, 0);
      const stage = chargeStage(chargeSeconds, confringo);
      root.hidden = !visible || (stage === "none" && lingering === 0);

      if (root.hidden || stage === "none") {
        // A release keeps the look it had while the flourish plays out.
        return;
      }

      delete root.dataset.flourish;
      root.dataset.stage = stage;

      const danger = overchargeShare(chargeSeconds, confringo);
      const { from, to } = ring.warnPulse;
      pulse += seconds * (from + (to - from) * danger) * Math.PI * 2;

      root.style.setProperty(
        "--level",
        chargeLevel(chargeSeconds, confringo).toFixed(4)
      );
      root.style.setProperty("--overcharge", danger.toFixed(4));
      // The warning throbs harder and faster as Overcharge nears.
      root.style.setProperty(
        "--throb",
        (1 - 0.7 * danger * (0.5 + 0.5 * Math.sin(pulse))).toFixed(3)
      );
    },
  };
};
