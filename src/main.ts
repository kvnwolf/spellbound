/**
 * Wires the game together: the WebGPU check, the courtyard, one Duel between
 * a DualSense-driven Duelist and a stationary opponent, and the frame loop
 * that steps the fixed-rate simulation, feeds its events to the VFX, HUD and
 * camera, and renders interpolated snapshots at display rate.
 */
import "./style.css";
import { courtyard, courtyardSpawns } from "./arena/courtyard";
import type { Controller } from "./controllers/controller";
import { idleController } from "./controllers/controller";
import { createDebugCasterController } from "./controllers/debug-caster";
import { createHumanController } from "./controllers/human-controller";
import { readDualSense, scanGamepads } from "./dualsense/input";
import type { DualSenseSnapshot } from "./dualsense/input";
import { createDuel } from "./duel/duel";
import type { DuelEvent, DuelistId, DuelSnapshot } from "./duel/duel";
import { idleIntent } from "./duel/intent";
import type { Intent } from "./duel/intent";
import { createFixedStepClock } from "./game-loop";
import { createHud } from "./hud";
import { createOverlay } from "./overlay";
import { createCameraRig } from "./render/camera-rig";
import { createCameraShake } from "./render/camera-shake";
import { createCourtyardScene } from "./render/courtyard-view";
import { createDuelistView } from "./render/duelist-view";
import { sampleDuelist } from "./render/interpolate";
import type { DuelistSample } from "./render/interpolate";
import { createFramePipeline } from "./render/pipeline";
import { createWebGPURenderer } from "./render/renderer";
import { createReticle } from "./render/reticle";
import { createSpellVfx } from "./render/spell-vfx";
import { text } from "./text";
import { tuning } from "./tuning";

const localId: DuelistId = "local";
const opponentId: DuelistId = "opponent";

/**
 * Where the camera stands for the Knockout shot: a point a few metres in
 * front of the fallen Duelist (toward the opponent they were facing), facing
 * back at them, so the rig frames them from the winner's side.
 */
const knockoutViewpoint = (fallen: DuelistSample) => ({
  facing: { x: -fallen.facing.x, z: -fallen.facing.z },
  position: {
    x: fallen.position.x + fallen.facing.x * tuning.knockoutCamera.standOff,
    z: fallen.position.z + fallen.facing.z * tuning.knockoutCamera.standOff,
  },
});

const element = <T extends HTMLElement>(
  selector: string,
  type: new () => T
): T => {
  const found = document.querySelector(selector);

  if (!(found instanceof type)) {
    throw new TypeError(`Missing ${selector}`);
  }

  return found;
};

const start = async () => {
  const canvas = element("#scene", HTMLCanvasElement);
  const overlay = createOverlay(element("#overlay", HTMLElement));
  const renderer = await createWebGPURenderer(canvas);

  if (!renderer) {
    overlay.show(text.unsupportedBrowser.heading, text.unsupportedBrowser.body);

    return;
  }

  const duel = createDuel({
    arena: courtyard,
    duelists: [
      { id: localId, spawn: courtyardSpawns.near, team: "near" },
      { id: opponentId, spawn: courtyardSpawns.far, team: "far" },
    ],
    tuning,
  });

  // The DualSense is read once per frame; the human Controller reads that
  // frame's snapshot for every tick run during the frame.
  let pad: DualSenseSnapshot | undefined;

  // The opponent stands still until the AI exists; `?rival=casts` makes it
  // cast Stupefy on a beat, for trying out incoming Spells.
  const rivalCasts =
    new URLSearchParams(window.location.search).get("rival") === "casts";

  const controllers = new Map<DuelistId, Controller>([
    [localId, createHumanController(() => pad)],
    [
      opponentId,
      rivalCasts
        ? createDebugCasterController(
            Math.round(tuning.debug.rivalCastInterval * tuning.tickRate)
          )
        : idleController,
    ],
  ]);

  const shake = createCameraShake(tuning.cameraShake);

  /** Impacts shake the camera: more when the local Duelist is the one hit. */
  const shakeOnHits = (events: readonly DuelEvent[]) => {
    const { hitDealt, hitTaken, strongBonus } = tuning.cameraShake;

    for (const event of events) {
      if (event.type !== "spell-hit") {
        continue;
      }

      const bonus = event.spell.strong ? strongBonus : 0;

      if (event.targetId === localId) {
        shake.add(hitTaken + bonus);
      } else if (event.spell.casterId === localId) {
        shake.add(hitDealt + bonus);
      }
    }
  };

  const scene = createCourtyardScene(courtyard);

  const views = new Map([
    [localId, createDuelistView("#8a1c24")],
    [opponentId, createDuelistView("#1f5a3a")],
  ]);

  for (const view of views.values()) {
    scene.add(view.object);
  }

  const vfx = createSpellVfx();
  scene.add(vfx.object);

  const rig = createCameraRig(
    tuning.camera,
    tuning.duelist.chestHeight,
    courtyard,
    shake
  );

  const frame = createFramePipeline(renderer, scene, rig.camera, tuning.render);

  const reticleElement = element("#reticle", HTMLElement);
  const reticle = createReticle(reticleElement);
  const hudElement = element("#hud", HTMLElement);

  const hud = createHud(hudElement, localId, {
    ...tuning.hud,
    maxHealth: tuning.duelist.health,
    roundsToWin: tuning.round.roundsToWin,
  });

  const clock = createFixedStepClock(tuning.tickRate);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    rig.resize(window.innerWidth / window.innerHeight);
  };

  resize();
  window.addEventListener("resize", resize);

  let previous: DuelSnapshot = duel.snapshot();
  let current: DuelSnapshot = previous;
  let lastFrame: number | undefined;

  const intentsFor = (snapshot: DuelSnapshot) => {
    const intents: Record<DuelistId, Intent> = {};

    for (const { id } of snapshot.duelists) {
      intents[id] =
        controllers.get(id)?.intent({ self: id, snapshot }) ?? idleIntent;
    }

    return intents;
  };

  // Resolves once the loop is installed; the loop itself runs every frame.
  void renderer.setAnimationLoop((now: number) => {
    const seconds = lastFrame === undefined ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;

    const scan = scanGamepads(navigator.getGamepads());
    pad =
      scan.kind === "dualsense"
        ? readDualSense(scan.gamepad, tuning.input)
        : undefined;

    if (scan.kind === "none") {
      overlay.show(text.title, text.connectDualSense);
    } else if (scan.kind === "unsupported") {
      overlay.show(text.title, text.requiresDualSense);
    } else {
      overlay.hide();
    }

    // The Duel only runs with a DualSense in hand, so the Round's countdown
    // never plays out behind the connect prompt. A Knockout plays in slow
    // motion: slow motion only scales the time fed to the simulation.
    const playing = scan.kind === "dualsense";
    hudElement.hidden = !playing;

    const timeScale =
      current.round.phase === "knockout" ? tuning.round.knockout.timeScale : 1;

    const simSeconds = playing ? seconds * timeScale : 0;
    const { ticks, alpha } = clock.advance(simSeconds);
    const events: DuelEvent[] = [];

    for (let tick = 0; tick < ticks; tick += 1) {
      previous = current;
      const result = duel.step(intentsFor(current));
      current = result.snapshot;
      events.push(...result.events);
    }

    shakeOnHits(events);
    vfx.handle(events);
    vfx.update(previous.spells, current.spells, alpha, simSeconds);
    hud.show(current, events, seconds);

    const samples = new Map<DuelistId, DuelistSample>();

    for (const state of current.duelists) {
      const before =
        previous.duelists.find((each) => each.id === state.id) ?? state;

      const sample = sampleDuelist(before, state, alpha);

      samples.set(state.id, sample);
      views.get(state.id)?.show(sample, seconds);
    }

    const local = current.duelists.find((each) => each.id === localId);
    const localSample = samples.get(localId);
    const fallen = current.duelists.find((each) => each.knockedOut);
    const fallenSample = fallen ? samples.get(fallen.id) : undefined;

    if (fallenSample && current.round.phase !== "fighting") {
      // The Knockout shot: look down on the fallen Duelist from the side
      // they were hit from, until the next Round lines everyone up again.
      rig.follow(
        knockoutViewpoint(fallenSample),
        fallenSample.position,
        seconds
      );
      reticleElement.hidden = true;
    } else if (local && localSample) {
      const target =
        local.targetId === null ? undefined : samples.get(local.targetId);

      rig.follow(localSample, target?.position, seconds);
      reticle.show(localSample.aimPoint, rig.camera);
    }

    frame.render();
  });
};

void start();
