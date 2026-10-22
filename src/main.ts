/**
 * Wires the walking skeleton together: the WebGPU check, the courtyard, one
 * Duel between a DualSense-driven Duelist and an idle opponent, and the frame
 * loop that steps the fixed-rate simulation and renders interpolated
 * snapshots at display rate.
 */
import "./style.css";
import { courtyard, courtyardSpawns } from "./arena/courtyard";
import type { Controller } from "./controllers/controller";
import { idleController } from "./controllers/controller";
import { createHumanController } from "./controllers/human-controller";
import { readDualSense, scanGamepads } from "./dualsense/input";
import type { DualSenseSnapshot } from "./dualsense/input";
import { createDuel } from "./duel/duel";
import type { DuelistId, DuelSnapshot } from "./duel/duel";
import { idleIntent } from "./duel/intent";
import type { Intent } from "./duel/intent";
import { createFixedStepClock } from "./game-loop";
import { createOverlay } from "./overlay";
import { createCameraRig } from "./render/camera-rig";
import { createCourtyardScene } from "./render/courtyard-view";
import { createDuelistView } from "./render/duelist-view";
import { sampleDuelist } from "./render/interpolate";
import type { DuelistSample } from "./render/interpolate";
import { createFramePipeline } from "./render/pipeline";
import { createWebGPURenderer } from "./render/renderer";
import { createReticle } from "./render/reticle";
import { text } from "./text";
import { tuning } from "./tuning";

const localId: DuelistId = "local";
const opponentId: DuelistId = "opponent";

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

  const controllers = new Map<DuelistId, Controller>([
    [localId, createHumanController(() => pad)],
    [opponentId, idleController],
  ]);

  const scene = createCourtyardScene(courtyard);

  const views = new Map([
    [localId, createDuelistView("#8a1c24")],
    [opponentId, createDuelistView("#1f5a3a")],
  ]);

  for (const view of views.values()) {
    scene.add(view.object);
  }

  const rig = createCameraRig(tuning.camera, tuning.duelist.chestHeight);
  const frame = createFramePipeline(renderer, scene, rig.camera, tuning.render);
  const reticle = createReticle(element("#reticle", HTMLElement));
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

    const { ticks, alpha } = clock.advance(seconds);

    for (let tick = 0; tick < ticks; tick += 1) {
      previous = current;
      current = duel.step(intentsFor(current)).snapshot;
    }

    const samples = new Map<DuelistId, DuelistSample>();

    for (const state of current.duelists) {
      const before =
        previous.duelists.find((each) => each.id === state.id) ?? state;

      const sample = sampleDuelist(before, state, alpha);

      samples.set(state.id, sample);
      views.get(state.id)?.show(sample);
    }

    const local = current.duelists.find((each) => each.id === localId);
    const localSample = samples.get(localId);

    if (local && localSample) {
      const target =
        local.targetId === null ? undefined : samples.get(local.targetId);

      rig.follow(localSample, target?.position, seconds);
      reticle.show(localSample.aimPoint, rig.camera);
    }

    frame.render();
  });
};

void start();
