/**
 * The parts of the HUD that live in the world, as DOM projected through the
 * camera every frame:
 *
 * - Above every opponent's head (never the local Duelist's or a teammate's),
 *   a small Health bar with no name and the same pale lag segment as the
 *   local bar, shown while they are on screen and standing (Lock-on is marked
 *   on the opponent's own silhouette, not on the bar). When they cast
 *   a Special Spell, its name shows small above the bar, so the player can
 *   read what is coming.
 * - At the impact point of every hit on an opponent, its own damage number
 *   that rises and fades (no summing: rapid hits show many numbers), white
 *   for a normal hit and gold for a strong one (the third Stupefy, an
 *   empowered Confringo from a Perfect Release).
 */
import "./world-hud.css";
import { Vector3 } from "three/webgpu";
import type { PerspectiveCamera } from "three/webgpu";

import type {
  DuelEvent,
  DuelistId,
  DuelistState,
  DuelSnapshot,
} from "../duel/duel";
import type { Point3 } from "../duel/geometry";
import { specialSpellKinds } from "../duel/spell-slots";
import { createHealthBar } from "../health-bar";
import type { HealthBar, HealthBarSettings } from "../health-bar";
import { text } from "../text";
import type { Tuning } from "../tuning";
import type { DuelistSample } from "./interpolate";

export interface WorldHudSettings extends HealthBarSettings {
  readonly damageNumbers: Tuning["hud"]["damageNumbers"];
  readonly floatingBar: Tuning["hud"]["floatingBar"];
  /** How tall a Duelist stands, metres: the bar floats over this. */
  readonly duelistHeight: number;
}

export interface WorldHud {
  /**
   * Shows this frame: `samples` are where each Duelist is drawn, `camera`
   * the one the frame renders with, `seconds` the real frame time.
   */
  readonly show: (
    snapshot: DuelSnapshot,
    events: readonly DuelEvent[],
    samples: ReadonlyMap<DuelistId, DuelistSample>,
    camera: PerspectiveCamera,
    seconds: number
  ) => void;
}

interface OpponentBar {
  readonly root: HTMLElement;
  readonly bar: HealthBar;
  readonly spell: HTMLElement;
}

interface DamageNumber {
  readonly element: HTMLElement;
  readonly at: Point3;
  /** Sideways step in pixels, so numbers on one spot do not overlap. */
  readonly offset: number;
  age: number;
}

const create = (className: string, parent: HTMLElement) => {
  const element = document.createElement("div");
  element.className = className;
  parent.append(element);

  return element;
};

/** Positions an element's anchor at a screen point, in pixels. */
const place = (element: HTMLElement, x: number, y: number) => {
  element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
};

export const createWorldHud = (
  root: HTMLElement,
  localId: DuelistId,
  settings: WorldHudSettings
): WorldHud => {
  const layer = create("world-hud", root);
  layer.style.setProperty(
    "--strong-scale",
    String(settings.damageNumbers.strongScale)
  );
  const bars = new Map<DuelistId, OpponentBar>();
  let numbers: DamageNumber[] = [];
  let spawned = 0;
  const point = new Vector3();

  /** Where a world point lands on screen, in pixels, or null behind the camera or off screen. */
  const project = (
    camera: PerspectiveCamera,
    x: number,
    y: number,
    z: number
  ) => {
    point.set(x, y, z).project(camera);

    if (point.z > 1 || Math.abs(point.x) > 1 || Math.abs(point.y) > 1) {
      return null;
    }

    return {
      x: ((point.x + 1) / 2) * window.innerWidth,
      y: ((1 - point.y) / 2) * window.innerHeight,
    };
  };

  const barFor = (id: DuelistId) => {
    const existing = bars.get(id);

    if (existing) {
      return existing;
    }

    const anchor = create("wh-opponent", layer);
    const spell = create("wh-spell", anchor);
    const bar = createHealthBar(anchor, "wh-bar", settings);
    const made = { bar, root: anchor, spell };
    bars.set(id, made);

    return made;
  };

  /** The name of a Special Spell an opponent just cast, small above their bar. */
  const announce = (
    { spell }: OpponentBar,
    kind: (typeof specialSpellKinds)[number]
  ) => {
    for (const animation of spell.getAnimations()) {
      animation.cancel();
    }

    spell.dataset.spell = kind;
    spell.textContent = text.specials[kind];
    spell.animate(
      [
        { opacity: 0, translate: "0 0.3rem" },
        { offset: 0.12, opacity: 1, translate: "0 0" },
        { offset: 0.75, opacity: 1, translate: "0 0" },
        { opacity: 0, translate: "0 0" },
      ],
      { duration: settings.floatingBar.spellSeconds * 1000, easing: "ease-out" }
    );
  };

  const showBars = (
    opponents: readonly DuelistState[],
    self: DuelistState | undefined,
    events: readonly DuelEvent[],
    samples: ReadonlyMap<DuelistId, DuelistSample>,
    camera: PerspectiveCamera,
    seconds: number
  ) => {
    for (const [id, { root: anchor }] of bars) {
      if (!opponents.some((each) => each.id === id)) {
        anchor.remove();
        bars.delete(id);
      }
    }

    for (const opponent of opponents) {
      const view = barFor(opponent.id);
      view.bar.show(opponent.health, seconds);

      const sample = samples.get(opponent.id);

      const head =
        sample && !opponent.knockedOut
          ? project(
              camera,
              sample.position.x,
              sample.elevation +
                settings.duelistHeight +
                settings.floatingBar.headroom,
              sample.position.z
            )
          : null;

      view.root.hidden = head === null;

      if (head) {
        place(view.root, head.x, head.y);
      }
    }

    for (const event of events) {
      if (event.type !== "spell-cast") {
        continue;
      }

      const kind = specialSpellKinds.find((each) => each === event.spell.kind);
      const view = bars.get(event.spell.casterId);

      if (kind && view) {
        announce(view, kind);
      }
    }
  };

  const spawnNumbers = (
    events: readonly DuelEvent[],
    opponents: readonly DuelistState[]
  ) => {
    const { spreadPixels } = settings.damageNumbers;

    for (const event of events) {
      if (
        event.type !== "spell-hit" ||
        event.damage <= 0 ||
        !opponents.some((each) => each.id === event.targetId)
      ) {
        continue;
      }

      const strong = event.spell.strong || event.spell.empowered;

      const element = create(
        strong ? "wh-number wh-number-strong" : "wh-number",
        layer
      );

      element.textContent = String(Math.max(Math.round(event.damage), 1));
      // Centre, right, left, centre...
      const offset = ([0, 1, -1][spawned % 3] ?? 0) * spreadPixels;
      spawned += 1;
      numbers.push({ age: 0, at: event.position, element, offset });
    }
  };

  const showNumbers = (camera: PerspectiveCamera, seconds: number) => {
    const { fadeShare, risePixels, seconds: life } = settings.damageNumbers;

    numbers = numbers.filter((number) => {
      number.age += seconds;

      const progress = number.age / life;

      if (progress >= 1) {
        number.element.remove();

        return false;
      }

      const screen = project(camera, number.at.x, number.at.y, number.at.z);
      number.element.hidden = screen === null;

      if (screen) {
        // Rises fast, then eases; fades out over the end of its life.
        const rise = risePixels * (1 - (1 - progress) ** 2);
        place(number.element, screen.x + number.offset, screen.y - rise);
        number.element.style.opacity = Math.min(
          (1 - progress) / fadeShare,
          1
        ).toFixed(3);
      }

      return true;
    });
  };

  return {
    show: (snapshot, events, samples, camera, seconds) => {
      const self = snapshot.duelists.find((each) => each.id === localId);

      const opponents = snapshot.duelists.filter(
        (each) => each.team !== self?.team
      );

      // The camera may have moved since its matrices were last updated.
      camera.updateMatrixWorld();

      showBars(opponents, self, events, samples, camera, seconds);

      if (settings.damageNumbers.enabled) {
        spawnNumbers(events, opponents);
      }

      showNumbers(camera, seconds);
    },
  };
};
