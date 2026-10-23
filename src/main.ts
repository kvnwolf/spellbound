/**
 * Wires the game together: the WebGPU check, the courtyard, one Duel between
 * a DualSense-driven Duelist and an AI opponent, and the frame loop
 * that steps the fixed-rate simulation, feeds its events to the VFX, HUD and
 * camera, and renders interpolated snapshots at display rate.
 */
import "./style.css";
import { createActivationHint } from "./activation-hint";
import { courtyard, courtyardSpawns } from "./arena/courtyard";
import { createDuelAudio } from "./audio/audio";
import { createClashHud } from "./clash-hud";
import { createAiController } from "./controllers/ai-controller";
import type { Controller } from "./controllers/controller";
import { idleController } from "./controllers/controller";
import { createDebugCasterController } from "./controllers/debug-caster";
import { createDebugClashController } from "./controllers/debug-clash";
import { createDebugDisarmsController } from "./controllers/debug-disarms";
import { createHumanController } from "./controllers/human-controller";
import { createRandom } from "./controllers/random";
import { createDualSenseEffects } from "./dualsense-effects";
import { createHapticsDirector } from "./dualsense/haptics";
import { readDualSense, scanGamepads } from "./dualsense/input";
import type { DualSenseSnapshot } from "./dualsense/input";
import { createMenuInput } from "./dualsense/menu-input";
import { chargeStage } from "./duel/charge";
import type { Difficulty } from "./duel/difficulty";
import { clashOpponentOf, createDuel } from "./duel/duel";
import type { DuelEvent, DuelistId, DuelSnapshot } from "./duel/duel";
import { idleIntent } from "./duel/intent";
import type { Intent } from "./duel/intent";
import { createFixedStepClock } from "./game-loop";
import { createHud } from "./hud";
import { createOverlay } from "./overlay";
import { clashViewpoint, createCameraRig } from "./render/camera-rig";
import { createCameraShake } from "./render/camera-shake";
import { createChargeRing } from "./render/charge-ring";
import { chargingWands } from "./render/charging-wands";
import { createClashVfx } from "./render/clash-vfx";
import { createCourtyardScene, torchSpots } from "./render/courtyard-view";
import { createDefenceVfx } from "./render/defence-vfx";
import { createDuelistView } from "./render/duelist-view";
import { sampleDuelist } from "./render/interpolate";
import type { DuelistSample } from "./render/interpolate";
import { createLooseWandView } from "./render/loose-wand-view";
import { createFramePipeline } from "./render/pipeline";
import { createWebGPURenderer } from "./render/renderer";
import { createReticle } from "./render/reticle";
import { createSpellVfx } from "./render/spell-vfx";
import { createWorldHud } from "./render/world-hud";
import {
  initialScreenState,
  reduceScreens,
  showsDuel,
} from "./screens/screens";
import type { PadKind, ScreenEvent } from "./screens/screens";
import { viewOf } from "./screens/view";
import { createSpellSlotsHud } from "./spell-slots-hud";
import { tuning } from "./tuning";
import type { Tuning } from "./tuning";

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
  const activationHint = createActivationHint(element("#overlay", HTMLElement));
  const effects = createDualSenseEffects(activationHint);
  const haptics = createHapticsDirector(localId, tuning);
  let lastPad: PadKind = "none";

  // The DualSense is read once per frame; the human Controller reads that
  // frame's snapshot for every tick run during the frame.
  let pad: DualSenseSnapshot | undefined;

  // The opponent is the AI at the chosen Difficulty. For testing,
  // `?rival=casts` swaps in a stationary rival casting Stupefy on a beat,
  // `?rival=clash` one that Charges and releases a Confringo with the player
  // and pumps the Clash it leads to, `?rival=disarms` one that casts
  // Expelliarmus at the player every few seconds (free of Focus and Cooldown,
  // for every Duelist), and `?rival=idle` one that does nothing.
  const rival = new URLSearchParams(window.location.search).get("rival");

  const createRival = (difficulty: Difficulty): Controller => {
    if (rival === "idle") {
      return idleController;
    }

    if (rival === "casts") {
      return createDebugCasterController(
        Math.round(tuning.debug.rivalCastInterval * tuning.tickRate)
      );
    }

    if (rival === "clash") {
      return createDebugClashController({
        fullSeconds: tuning.confringo.fullSeconds,
        holdPastFullTicks: Math.round(
          tuning.debug.rivalClashHoldPastFull * tuning.tickRate
        ),
        pumpEveryTicks: Math.round(
          tuning.tickRate / tuning.debug.rivalClashPumpRate
        ),
      });
    }

    if (rival === "disarms") {
      return createDebugDisarmsController({
        firstCastTicks: Math.round(
          tuning.debug.rivalDisarmsFirstCast * tuning.tickRate
        ),
        intervalTicks: Math.round(
          tuning.debug.rivalDisarmsInterval * tuning.tickRate
        ),
        spellSlots: tuning,
      });
    }

    // A fresh seed every Duel, so no two play out the same.
    return createAiController({
      arena: courtyard,
      difficulty,
      random: createRandom(Math.floor(Math.random() * 2 ** 31)),
      tuning,
    });
  };

  // `?rival=disarms` makes Expelliarmus free of Focus and Cooldown, so the
  // rival can cast it without earning Focus; nothing else changes.
  const duelTuning: Tuning =
    rival === "disarms"
      ? {
          ...tuning,
          expelliarmus: {
            ...tuning.expelliarmus,
            cooldownSeconds: 0,
            segments: 0,
          },
        }
      : tuning;

  const createDuelFor = (difficulty: Difficulty) =>
    createDuel({
      arena: courtyard,
      difficulty,
      duelists: [
        { id: localId, spawn: courtyardSpawns.near, team: "near" },
        { id: opponentId, spawn: courtyardSpawns.far, team: "far" },
      ],
      tuning: duelTuning,
    });

  const createControllers = (difficulty: Difficulty) =>
    new Map<DuelistId, Controller>([
      [localId, createHumanController(() => pad)],
      [opponentId, createRival(difficulty)],
    ]);

  // Behind the connect prompt and the Difficulty select sits a fresh Duel (run 0),
  // frozen at its start; every Duel the screens start is a new run.
  let duel = createDuelFor("duelista");
  let controllers = createControllers("duelista");
  let activeRun = 0;

  const shake = createCameraShake(tuning.cameraShake);

  /**
   * Impacts shake the camera: more when the local Duelist is the one hit,
   * and more for a Charged Confringo. A Backfire jolts its caster.
   */
  const shakeOnHits = (events: readonly DuelEvent[]) => {
    const { backfire, confringoBonus, hitDealt, hitTaken, strongBonus } =
      tuning.cameraShake;

    for (const event of events) {
      if (event.type === "backfire" && event.duelistId === localId) {
        shake.add(backfire);
      }

      // Depulso's blast recoils through its caster.
      if (
        event.type === "spell-cast" &&
        event.spell.kind === "depulso" &&
        event.spell.casterId === localId
      ) {
        shake.add(tuning.cameraShake.depulsoCast);
      }

      // A Clash blowing up between the two Wands jolts the camera too.
      if (event.type === "clash-end" && event.outcome === "exploded") {
        shake.add(tuning.cameraShake.explosion);
      }

      // An Incendio blast jolts the camera, hardest for the one caught in it.
      if (event.type === "explosion") {
        shake.add(
          tuning.cameraShake.explosion *
            (event.burned.includes(localId) ? 1 : 0.5)
        );
      }

      if (event.type !== "spell-hit") {
        continue;
      }

      const bonus =
        (event.spell.strong ? strongBonus : 0) +
        (event.spell.kind === "confringo"
          ? confringoBonus * event.spell.charge
          : 0);

      if (event.targetId === localId) {
        shake.add(hitTaken + bonus);
      } else if (event.spell.casterId === localId) {
        shake.add(hitDealt + bonus);
      }
    }
  };

  const scene = createCourtyardScene(courtyard);

  // The Wand's aura once the Focus is full.
  const wandAura = { ...tuning.wandAura, focusMax: tuning.focus.max };

  // The vial at the lips while drinking, and a Potion's aura while it works.
  const potionLook = {
    ...tuning.potionLook,
    drinkSeconds: tuning.potions.drink.seconds,
  };

  const views = new Map([
    [
      localId,
      createDuelistView(
        "#8a1c24",
        tuning.lockOnGlow,
        tuning.petrifiedLook,
        tuning.duelist,
        tuning.defence.dodge.seconds,
        wandAura,
        potionLook
      ),
    ],
    [
      opponentId,
      createDuelistView(
        "#1f5a3a",
        tuning.lockOnGlow,
        tuning.petrifiedLook,
        tuning.duelist,
        tuning.defence.dodge.seconds,
        wandAura,
        potionLook
      ),
    ],
  ]);

  for (const view of views.values()) {
    scene.add(view.object);
  }

  // Disarmed Duelists' Wands, flying off, on the floor and flying home.
  const looseWands = createLooseWandView(
    tuning.looseWand,
    tuning.duelist.wand.length
  );

  scene.add(looseWands.object);

  const vfx = createSpellVfx({
    blastRadius: tuning.incendio.blastRadius,
    depulso: tuning.depulso,
    depulsoLook: tuning.depulsoLook,
  });

  scene.add(vfx.object);

  // Protego domes and Parry flashes.
  const defenceVfx = createDefenceVfx(tuning.protego);
  scene.add(defenceVfx.object);

  // The Clash's beam between two Wands and its meeting point.
  const clashVfx = createClashVfx();
  scene.add(clashVfx.object);

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

  // Sampled sound and music, heard from the camera; silent until the first click or keypress.
  const audio = createDuelAudio({
    camera: rig.camera,
    hint: activationHint,
    localId,
    settings: tuning,
  });

  const reticleElement = element("#reticle", HTMLElement);

  const reticle = createReticle(
    reticleElement,
    tuning.aimAssist.bendAngle,
    tuning.reticle.fadeSeconds
  );

  const hudElement = element("#hud", HTMLElement);

  const chargeRing = createChargeRing(
    element("#charge-ring", HTMLElement),
    { confringo: tuning.confringo, ring: tuning.hud.chargeRing },
    localId
  );

  /**
   * The local Duelist's Charge: the ring round the centre (only while the
   * Round is fought, never over the Knockout shot) and the FOV push at full Charge.
   */
  const showCharge = (
    snapshot: DuelSnapshot,
    events: readonly DuelEvent[],
    seconds: number,
    inDuel: boolean
  ) => {
    const chargeSeconds =
      snapshot.duelists.find((each) => each.id === localId)?.chargeSeconds ?? 0;

    const stage = chargeStage(chargeSeconds, tuning.confringo);

    rig.chargePush(stage === "perfect" || stage === "full" ? 1 : 0);
    chargeRing.show(
      chargeSeconds,
      events,
      seconds,
      inDuel && snapshot.round.phase === "fighting"
    );
  };

  const hud = createHud(hudElement, localId, {
    ...tuning.hud,
    maxHealth: tuning.duelist.health,
    maxStamina: tuning.defence.stamina.max,
    potionSlots: tuning.potionSlots,
    potions: tuning.potions,
    roundsToWin: tuning.round.roundsToWin,
  });

  // Focus and the Spell Slots with their Cooldowns.
  const specialsHud = createSpellSlotsHud(hudElement, localId, tuning);

  // "¡Clash!" and the △ pump prompt.
  const clashHud = createClashHud(hudElement, localId, tuning.hud.clash);

  // Opponents' floating Health bars and the damage numbers on them.
  const worldHud = createWorldHud(hudElement, localId, {
    ...tuning.hud,
    duelistHeight: tuning.duelist.height,
    maxHealth: tuning.duelist.health,
  });

  let clock = createFixedStepClock(tuning.tickRate);

  // A collapsed (hidden or zero-size) page keeps the last valid size and skips
  // rendering, so the WebGPU swapchain never sees a 0-sized texture.
  let hasArea = false;

  const resize = () => {
    const { innerHeight: height, innerWidth: width } = window;
    hasArea = width > 0 && height > 0;

    if (!hasArea) {
      return;
    }

    renderer.setSize(width, height);
    rig.resize(width / height);
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
    controllers = createControllers(difficulty);
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
   * While the Duel is not stepping, whatever is held when it next does (the
   * press that closed the menu, say) is not a gameplay input.
   */
  const suspendControllersUnless = (playing: boolean) => {
    if (playing) {
      return;
    }

    for (const controller of controllers.values()) {
      controller.suspend?.();
    }
  };

  /**
   * Tells the screens what the controller did this frame, then builds a new
   * Duel if they now call for one: a Duel they just started is a new
   * simulation, and the connect prompt and the Difficulty select show a fresh one
   * waiting at its start.
   */
  const syncScreens = (padKind: PadKind, seconds: number) => {
    if (padKind !== lastPad) {
      lastPad = padKind;
      send({ pad: padKind, type: "pad" });
    }

    for (const event of menuInput.read(pad, seconds)) {
      const before = screens.screen;
      send(event);
      audio.menu(before, screens.screen, event);
    }

    const { screen } = screens;

    if (screen.kind === "duel" && screen.run !== activeRun) {
      startRun(screen.run, screen.difficulty);
    } else if (
      (screen.kind === "connect" || screen.kind === "difficulty") &&
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
      // The local Duelist's Lock-on Target glows round its silhouette,
      // dimmed while it is out of sight behind Cover.
      let glow = 0;

      if (local?.targetId === state.id) {
        glow =
          local.targetHiddenSeconds > 0 ? tuning.lockOnGlow.hiddenShare : 1;
      }

      // A Wand flying home is not in the hand until it lands in it.
      views
        .get(state.id)
        ?.show(
          looseWands.returning(state.id)
            ? { ...sample, disarmed: true }
            : sample,
          seconds,
          glow
        );
    }

    defenceVfx.show(samples, seconds);

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
      reticle.show({ locked: false, visible: false }, rig.camera, seconds);
    } else if (localSample) {
      // In a Clash the camera frames both ends of the beam, locked or not,
      // from a step to the side so the beam crosses the screen.
      const foe = clashOpponentOf(current.clash, localId);
      const framed = foe ?? localSample.targetId;
      const target = framed === null ? undefined : samples.get(framed);

      // Free: the camera follows the aim and the reticle marks where
      // Spells go. Locked On: the camera frames both, the reticle quickly
      // fades out and the Target's glow marks the lock.
      rig.follow(
        localSample,
        target && {
          nudge: localSample.lockNudge,
          self:
            foe === undefined
              ? localSample.position
              : clashViewpoint(
                  localSample.position,
                  target.position,
                  tuning.camera.clashSideStep
                ),
          target: target.position,
        },
        seconds
      );

      reticle.show(
        { locked: target !== undefined, visible: true },
        rig.camera,
        seconds
      );
    }

    return samples;
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

    suspendControllersUnless(playing);

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
    defenceVfx.handle(events);
    vfx.update(
      previous.spells,
      current.spells,
      alpha,
      simSeconds,
      chargingWands(current.duelists, tuning, (id) =>
        views.get(id)?.wandTipPosition()
      ),
      // Embers rise off every Duelist with an Incendio Burn.
      current.duelists.flatMap((each) =>
        each.burnSeconds > 0
          ? [{ x: each.position.x, y: each.elevation, z: each.position.z }]
          : []
      )
    );
    hud.show(current, events, seconds);
    specialsHud.show(current);
    clashHud.show(current, events);
    clashVfx.handle(events);
    clashVfx.update(previous.clash, current.clash, alpha, simSeconds, (id) =>
      views.get(id)?.wandTipPosition()
    );

    showCharge(current, events, seconds, inDuel);

    // A cast moves the caster's Wand arm the way its Spell calls for; a
    // Backfire drops it; a Dodge rolls the whole Duelist.
    for (const event of events) {
      if (event.type === "spell-cast") {
        views.get(event.spell.casterId)?.cast(event.spell.kind);
      } else if (event.type === "backfire") {
        views.get(event.duelistId)?.backfire();
      } else if (event.type === "dodge") {
        views.get(event.duelistId)?.dodge(event.direction);
      } else if (event.type === "potion-drunk") {
        views.get(event.duelistId)?.drunk(event.kind);
      }
    }

    looseWands.handle(events);
    const samples = showDuelists(alpha, seconds);
    looseWands.show(previous, current, alpha, simSeconds, (id) =>
      views.get(id)?.wandTipPosition()
    );
    worldHud.show(current, events, samples, rig.camera, seconds);
    audio.frame({
      events,
      live: playing,
      screen: screens.screen,
      snapshot: current,
    });

    if (!inDuel) {
      reticleElement.hidden = true;
    }

    if (hasArea) {
      frame.render();
    }
  });
};

void start();
