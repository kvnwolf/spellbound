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
import { createDualSenseEffects } from "./dualsense-effects";
import { createHapticsDirector } from "./dualsense/haptics";
import { readDualSense, scanGamepads } from "./dualsense/input";
import type { DualSenseSnapshot } from "./dualsense/input";
import { createMenuInput } from "./dualsense/menu-input";
import type { Difficulty } from "./duel/difficulty";
import { createDuel } from "./duel/duel";
import type { DuelEvent, DuelistId, DuelSnapshot } from "./duel/duel";
import { idleIntent } from "./duel/intent";
import type { Intent } from "./duel/intent";
import { createFixedStepClock } from "./game-loop";
import { createHud } from "./hud";
import { createOverlay } from "./overlay";
import { createCameraRig } from "./render/camera-rig";
import { createCameraShake } from "./render/camera-shake";
import { createCourtyardScene, torchSpots } from "./render/courtyard-view";
import { createDuelistView } from "./render/duelist-view";
import { sampleDuelist } from "./render/interpolate";
import type { DuelistSample } from "./render/interpolate";
import { createFramePipeline } from "./render/pipeline";
import { createWebGPURenderer } from "./render/renderer";
import { createReticle } from "./render/reticle";
import { createSpellVfx } from "./render/spell-vfx";
import {
  initialScreenState,
  reduceScreens,
  showsDuel,
} from "./screens/screens";
import type { PadKind, ScreenEvent } from "./screens/screens";
import { viewOf } from "./screens/view";
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
    const view = viewOf(initialScreenState(false).screen);

    if (view) {
      overlay.show(view);
    }

    return;
  }

  // Which screen the game is on; the Duel only runs on the Duel screen.
  let screens = initialScreenState(true);

  const send = (event: ScreenEvent) => {
    screens = reduceScreens(screens, event, tuning.screens);
  };

  const menuInput = createMenuInput(tuning.menu);
  // Rumble, lightbar and player LEDs (ADR-0001): WebHID once granted, else dual-rumble.
  const effects = createDualSenseEffects(element("#overlay", HTMLElement));
  const haptics = createHapticsDirector(localId, tuning.haptics);
  let lastPad: PadKind = "none";

  // The DualSense is read once per frame; the human Controller reads that
  // frame's snapshot for every tick run during the frame.
  let pad: DualSenseSnapshot | undefined;

  // The opponent stands still until the AI exists; `?rival=casts` makes it
  // cast Stupefy on a beat, for trying out incoming Spells.
  const rivalCasts =
    new URLSearchParams(window.location.search).get("rival") === "casts";

  const createDuelFor = (difficulty: Difficulty) =>
    createDuel({
      arena: courtyard,
      difficulty,
      duelists: [
        { id: localId, spawn: courtyardSpawns.near, team: "near" },
        { id: opponentId, spawn: courtyardSpawns.far, team: "far" },
      ],
      tuning,
    });

  const createControllers = () =>
    new Map<DuelistId, Controller>([
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

  // Behind the title and the Difficulty select sits a fresh Duel (run 0),
  // frozen at its start; every Duel the screens start is a new run.
  let duel = createDuelFor("duelista");
  let controllers = createControllers();
  let activeRun = 0;

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
    [localId, createDuelistView("#8a1c24", tuning.lockOnGlow)],
    [opponentId, createDuelistView("#1f5a3a", tuning.lockOnGlow)],
  ]);

  for (const view of views.values()) {
    scene.add(view.object);
  }

  const vfx = createSpellVfx();
  scene.add(vfx.object);

  // The camera must also stay clear of the torch stands on the parapet, which
  // are scenery rather than Cover, so Spells ignore them.
  const cameraObstacles = {
    ...courtyard,
    cover: [
      ...courtyard.cover,
      ...torchSpots(courtyard.bounds).map((spot) => ({
        center: { x: spot.x, z: spot.z },
        radius: tuning.camera.clearance.torchRadius,
      })),
    ],
  };

  const rig = createCameraRig(
    {
      camera: tuning.camera,
      chestHeight: tuning.duelist.chestHeight,
      eye: tuning.aim.eye,
    },
    cameraObstacles,
    shake
  );

  const frame = createFramePipeline(renderer, scene, rig.camera, tuning.render);

  const reticleElement = element("#reticle", HTMLElement);
  const reticle = createReticle(reticleElement, tuning.aimAssist.bendAngle);
  const hudElement = element("#hud", HTMLElement);

  const hud = createHud(hudElement, localId, {
    ...tuning.hud,
    maxHealth: tuning.duelist.health,
    roundsToWin: tuning.round.roundsToWin,
  });

  let clock = createFixedStepClock(tuning.tickRate);

  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    rig.resize(window.innerWidth / window.innerHeight);
  };

  resize();
  window.addEventListener("resize", resize);

  let previous: DuelSnapshot = duel.snapshot();
  let current: DuelSnapshot = previous;
  let lastFrame: number | undefined;

  /** Swaps in a brand-new Duel, as the first or a restarted one. */
  const startRun = (run: number, difficulty: Difficulty) => {
    // Hide any Spell still flying from the old Duel before its ids repeat.
    vfx.update(current.spells, [], 0, 0);
    duel = createDuelFor(difficulty);
    controllers = createControllers();
    clock = createFixedStepClock(tuning.tickRate);
    previous = duel.snapshot();
    current = previous;
    activeRun = run;
  };

  const intentsFor = (snapshot: DuelSnapshot) => {
    const intents: Record<DuelistId, Intent> = {};

    for (const { id } of snapshot.duelists) {
      intents[id] =
        controllers.get(id)?.intent({ self: id, snapshot }) ?? idleIntent;
    }

    return intents;
  };

  /**
   * Tells the screens what the controller did this frame, then builds a new
   * Duel if they now call for one: a Duel they just started is a new
   * simulation, and the title and the Difficulty select show a fresh one
   * waiting at its start.
   */
  const syncScreens = (padKind: PadKind, seconds: number) => {
    if (padKind !== lastPad) {
      lastPad = padKind;
      send({ pad: padKind, type: "pad" });
    }

    for (const event of menuInput.read(pad, seconds)) {
      send(event);
    }

    const { screen } = screens;

    if (screen.kind === "duel" && screen.run !== activeRun) {
      startRun(screen.run, screen.difficulty);
    } else if (
      (screen.kind === "title" || screen.kind === "difficulty") &&
      activeRun !== 0
    ) {
      startRun(0, "duelista");
    }

    return screen;
  };

  /** Runs the ticks owed for `simSeconds`; the screens hear when the Duel ends. */
  const advance = (simSeconds: number) => {
    const { ticks, alpha } = clock.advance(simSeconds);
    const events: DuelEvent[] = [];

    for (let tick = 0; tick < ticks; tick += 1) {
      previous = current;
      const result = duel.step(intentsFor(current));
      current = result.snapshot;
      events.push(...result.events);
    }

    for (const event of events) {
      if (event.type === "duel-end") {
        const local = current.duelists.find((each) => each.id === localId);
        send({ type: "duel-ended", won: event.winner === local?.team });
      }
    }

    return { alpha, events };
  };

  // Resolves once the loop is installed; the loop itself runs every frame.
  // Poses every Duelist and points the camera: the Knockout shot, Lock-on framing or free aim.
  const showDuelists = (alpha: number, seconds: number) => {
    const samples = new Map<DuelistId, DuelistSample>();

    const local = current.duelists.find((each) => each.id === localId);

    for (const state of current.duelists) {
      const before =
        previous.duelists.find((each) => each.id === state.id) ?? state;

      const sample = sampleDuelist(before, state, alpha);

      samples.set(state.id, sample);
      // The local Duelist's Lock-on Target glows round its silhouette.
      views.get(state.id)?.show(sample, seconds, local?.targetId === state.id);
    }

    const localSample = samples.get(localId);
    const fallen = current.duelists.find((each) => each.knockedOut);
    const fallenSample = fallen ? samples.get(fallen.id) : undefined;

    if (localSample && fallenSample && current.round.phase !== "fighting") {
      // The Knockout shot: look down on the fallen Duelist from the side
      // they were hit from, until the next Round lines everyone up again.
      rig.follow(
        localSample,
        {
          nudge: { pitch: 0, yaw: 0 },
          self: knockoutViewpoint(fallenSample).position,
          target: fallenSample.position,
        },
        seconds
      );
      reticle.show({ crosshair: false }, rig.camera);
    } else if (localSample) {
      const target =
        localSample.targetId === null
          ? undefined
          : samples.get(localSample.targetId);

      // Free: the camera follows the aim and the crosshair marks where
      // Spells go. Locked On: the camera frames both, the ring marks the Target.
      rig.follow(
        localSample,
        target && {
          nudge: localSample.lockNudge,
          self: localSample.position,
          target: target.position,
        },
        seconds
      );

      reticle.show(
        {
          crosshair: !target,
          lockRing: target && {
            at: { ...target.position, y: tuning.duelist.chestHeight },
            hidden: localSample.targetHidden,
          },
        },
        rig.camera
      );
    }
  };

  void renderer.setAnimationLoop((now: number) => {
    const seconds = lastFrame === undefined ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;

    const scan = scanGamepads(navigator.getGamepads());
    pad =
      scan.kind === "dualsense"
        ? readDualSense(scan.gamepad, tuning.input)
        : undefined;

    // The screens act first, so everything below sees the screen this frame ends on.
    const screen = syncScreens(scan.kind, seconds);

    // The Duel only advances on its own screen: never behind a menu, the
    // pause or the "Reconecta tu mando" prompt. A Knockout plays in slow
    // motion: slow motion only scales the time fed to the simulation.
    const playing = screen.kind === "duel";
    const inDuel = showsDuel(screen);
    hudElement.hidden = !inDuel;
    // Behind the pause the Round's call-out would fight the menu for the centre.
    hudElement.classList.toggle("hud-held", inDuel && !playing);

    const timeScale =
      current.round.phase === "knockout" ? tuning.round.knockout.timeScale : 1;

    const simSeconds = playing ? seconds * timeScale : 0;
    const { alpha, events } = advance(simSeconds);

    effects.send(
      haptics.frame({ events, live: playing, seconds, snapshot: current }),
      scan.kind === "dualsense" ? scan.gamepad : undefined
    );

    if (playing) {
      send({ seconds, type: "tick" });
    }

    const view = viewOf(screens.screen);

    if (view) {
      overlay.show(view);
    } else {
      overlay.hide();
    }

    shakeOnHits(events);
    vfx.handle(events);
    vfx.update(previous.spells, current.spells, alpha, simSeconds);
    hud.show(current, events, seconds);

    showDuelists(alpha, seconds);

    if (!inDuel) {
      reticleElement.hidden = true;
    }

    frame.render();
  });
};

void start();
