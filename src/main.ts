/**
 * Wires the game together: the language and the can't-play checks (a phone
 * or tablet, no WebGPU), the courtyard, one Duel between
 * a DualSense-driven Duelist and an AI opponent, and the frame loop
 * that steps the fixed-rate simulation, feeds its events to the VFX, HUD and
 * camera, and renders interpolated snapshots at display rate.
 */
import { createActivationHint } from "./activation-hint";
import { courtyard, courtyardSpawns } from "./arena/courtyard";
import { createDuelAudio } from "./audio/audio";
import { menuSoundFor } from "./audio/cues";
import type { MenuSound } from "./audio/cues";
import { createClashHud } from "./clash-hud";
import type { Controller } from "./controllers/controller";
import { createHumanController } from "./controllers/human-controller";
import {
  createDemoControllers,
  demoDuelConfig,
  demoIsSolo,
  demoLearner,
} from "./controllers/lesson-demo";
import { createRandom } from "./controllers/random";
import { createRival } from "./controllers/rival";
import { isPhoneOrTablet } from "./device-check";
import { createDualSenseEffects } from "./dualsense-effects";
import { createHapticsDirector } from "./dualsense/haptics";
import { readDualSense, scanGamepads } from "./dualsense/input";
import type { DualSenseSnapshot } from "./dualsense/input";
import { createMenuInput } from "./dualsense/menu-input";
import { chargeStage } from "./duel/charge";
import { clashOpponentOf, createDuel } from "./duel/duel";
import type {
  ArenaLayout,
  DuelEvent,
  DuelistId,
  DuelistState,
  DuelSnapshot,
} from "./duel/duel";
import { wrapAngle } from "./duel/geometry";
import type { GroundPoint, Point3 } from "./duel/geometry";
import { idleIntent } from "./duel/intent";
import type { Intent } from "./duel/intent";
import { practiceRulesFor } from "./duel/practice";
import type { PracticeRival } from "./duel/practice";
import {
  advanceLesson,
  lessonPlans,
  lessonRules,
  startLesson,
} from "./duel/training";
import type { Lesson, LessonProgress } from "./duel/training";
import { createFixedStepClock } from "./game-loop";
import { createHud } from "./hud";
import { createLoadingScreen } from "./loading-screen";
import { loadOptions, saveOptions } from "./options-store";
import { createOverlay } from "./overlay";
import { knockoutSide, knockoutViewpoint } from "./render/camera-framing";
import { clashViewpoint, createCameraRig } from "./render/camera-rig";
import type { Framing } from "./render/camera-rig";
import { createCameraShake } from "./render/camera-shake";
import { createChargeRing } from "./render/charge-ring";
import { chargingWands } from "./render/charging-wands";
import { createClashVfx } from "./render/clash-vfx";
import { createCourtyardScene, torchSpots } from "./render/courtyard-view";
import { createDefenceVfx } from "./render/defence-vfx";
import { createDemoCamera } from "./render/demo-camera";
import { createDepulsoHits } from "./render/depulso-vfx";
import { createDuelistView } from "./render/duelist-view";
import { createFrameProbe, perfRequested } from "./render/frame-probe";
import { sampleDuelist } from "./render/interpolate";
import type { DuelistSample } from "./render/interpolate";
import { createLooseWandView } from "./render/loose-wand-view";
import { createFramePipeline, createPreviewPipeline } from "./render/pipeline";
import { createWebGPURenderer } from "./render/renderer";
import { createReticle } from "./render/reticle";
import { createRuinsView } from "./render/ruins/ruins-view";
import { createSlideDust } from "./render/slide-dust";
import { seededRandom } from "./render/spark-ring";
import { createSpellVfx, spellVfxSettings } from "./render/spell-vfx";
import { loadWizardAssets } from "./render/wizard-assets";
import { createWorldHud } from "./render/world-hud";
import {
  duelOf,
  initialScreenState,
  noTraining,
  practiceOf,
  reduceScreens,
  showsDuel,
} from "./screens/screens";
import type {
  CantPlay,
  DuelScreen,
  PadKind,
  PlayerOptions,
  Screen,
  ScreenEvent,
  ScreenState,
} from "./screens/screens";
import { scrollOf, viewOf } from "./screens/view";
import { createSpellSlotsHud } from "./spell-slots-hud";
import { setLanguage } from "./text";
import type { Language } from "./text";
import { createTrainingHud } from "./training-hud";
import { createTrainingScroll } from "./training-scroll";
import { loadTraining, saveTraining } from "./training-store";
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

/** The Training lesson on show: running, paused, under a scroll or waiting for the controller. */
const trainingOf = (screen: Screen): DuelScreen["training"] =>
  duelOf(screen)?.training;

/** Where every Duelist that passes `test` stands: their feet. */
const feetOf = (
  snapshot: DuelSnapshot,
  test: (duelist: DuelistState) => boolean
) =>
  snapshot.duelists.flatMap((each) =>
    test(each)
      ? [
          {
            feet: { x: each.position.x, y: each.elevation, z: each.position.z },
            id: each.id,
          },
        ]
      : []
  );

/** Plays in `language`: every string, and the page's own language. */
const showLanguage = (language: Language) => {
  setLanguage(language);
  document.documentElement.lang = language;
};

/** A volume step as a gain, each step about as much quieter as the last. */
const gainOf = (level: number) =>
  (level / tuning.screens.volumeSteps) ** tuning.volumeCurve;

/** The player's volume steps as gains. */
const volumesOf = (options: PlayerOptions) => ({
  effects: gainOf(options.effects),
  music: gainOf(options.music),
});

/**
 * What the camera keeps clear of: the walls, the Cover still standing and
 * the torch stands. Its Cover is replaced as pieces of the Arena break.
 */
interface CameraObstacles {
  readonly bounds: ArenaLayout["bounds"];
  cover: ArenaLayout["cover"];
  obstructions: ArenaLayout["obstructions"];
}

const start = async () => {
  // The player's Options, remembered or a first visit's in the browser's
  // language: the language is set before anything is written.
  const firstOptions = loadOptions(
    navigator.language,
    tuning.screens.volumeSteps
  );

  showLanguage(firstOptions.language);
  // Loading, from the first paint: the renderer, the wizard (most of the
  // bytes) and the shaders, then the menus.
  const loading = createLoadingScreen(element("#menu", HTMLElement));
  const canvas = element("#scene", HTMLCanvasElement);
  const overlay = createOverlay(element("#overlay", HTMLElement));

  /** Says why the game cannot be played here, instead of loading it. */
  const cantPlay = (reason: CantPlay) => {
    loading.done();

    const view = viewOf(
      initialScreenState(reason, noTraining, firstOptions).screen
    );

    if (view) {
      overlay.show(view);
    }
  };

  if (isPhoneOrTablet()) {
    cantPlay("device");

    return;
  }

  const renderer = await createWebGPURenderer(canvas);
  const { stages } = tuning.loading;
  loading.progress(stages.renderer);

  if (!renderer) {
    cantPlay("browser");

    return;
  }

  // Which screen the game is on; the Duel only runs on the Duel screen.
  // What Training remembers, and the Options, are kept in this browser.
  let screens = initialScreenState(true, loadTraining(), firstOptions);

  const send = (event: ScreenEvent) => {
    const before = screens;
    screens = reduceScreens(screens, event, tuning.screens);

    if (screens.training !== before.training) {
      saveTraining(screens.training);
    }

    if (screens.options !== before.options) {
      saveOptions(screens.options);
    }
  };

  const menuInput = createMenuInput(tuning.menu);
  // Rumble, lightbar and player LEDs (ADR-0001): WebHID once granted, else dual-rumble.
  const activationHint = createActivationHint(element("#overlay", HTMLElement));
  const effects = createDualSenseEffects(activationHint);
  /** What the Gamepad API saw this frame: it shows a pad only once a button goes down. */
  let scanned: PadKind = "none";
  let lastPad: PadKind = "none";

  /** What is plugged in, as the screens see it: a DualSense open over WebHID counts unpressed. */
  const padNow = (): PadKind => (effects.connected() ? "dualsense" : scanned);

  const syncPad = () => {
    const padKind = padNow();

    if (padKind !== lastPad) {
      lastPad = padKind;
      send({ pad: padKind, type: "pad" });
    }
  };

  // Comenzar: the same click turns the sound on and asks for the DualSense
  // over WebHID (dualsense-effects); once that has answered, a granted pad
  // goes straight to the main menu, else the connect prompt asks for ✕.
  const startOnceLooked = async () => {
    await effects.settled();
    syncPad();
    send({ type: "start" });
  };

  overlay.onAction(() => {
    void startOnceLooked();
  });
  const haptics = createHapticsDirector(localId, tuning);
  // This frame's menu sounds, felt on the DualSense as well.
  let menuSounds: MenuSound[] = [];

  // The DualSense is read once per frame; the human Controller reads that
  // frame's snapshot for every tick run during the frame.
  let pad: DualSenseSnapshot | undefined;

  /**
   * What the screens ask for: a Duel against the AI at its Difficulty, or a
   * Practice (same courtyard, Practice rules) against a Training Dummy or
   * the AI, which a Training lesson is too, set up as the lesson needs.
   */
  type DuelSetup = Pick<DuelScreen, "difficulty" | "practice" | "training">;

  // Behind the menus sits a fresh Duel (run 0), frozen at its start.
  const waiting: DuelSetup = { difficulty: "duelista", practice: null };

  /** The Practice rules `setup` is played under: a Training lesson's own, or none for a Duel. */
  const rulesFor = ({ practice, training }: DuelSetup) => {
    if (training) {
      return lessonRules(training.lesson, localId, tuning);
    }

    return practice === null ? undefined : practiceRulesFor(practice, localId);
  };

  const createDuelFor = (setup: DuelSetup) =>
    createDuel({
      arena: courtyard,
      difficulty: setup.difficulty,
      duelists: [
        { id: localId, spawn: courtyardSpawns.near, team: "near" },
        { id: opponentId, spawn: courtyardSpawns.far, team: "far" },
      ],
      practice: rulesFor(setup),
      tuning,
    });

  const createControllers = ({ difficulty, practice }: DuelSetup) => {
    const rival: PracticeRival = practice ?? "ai";

    return new Map<DuelistId, Controller>([
      [localId, createHumanController(() => pad)],
      [
        opponentId,
        // A fresh seed every Duel, so no two play out the same.
        createRival(rival, {
          arena: courtyard,
          difficulty,
          random: createRandom(Math.floor(Math.random() * 2 ** 31)),
          tuning,
        }),
      ],
    ]);
  };

  // Every Duel or Practice the screens start is a new run.
  let duel = createDuelFor(waiting);
  let controllers = createControllers(waiting);
  let activeRun = 0;
  // The Training lesson being played: its goals, counted from the Duel.
  let lesson: LessonProgress | undefined;

  /**
   * The live demo of the lesson highlighted on Entrenamiento, while that
   * menu is up: which lesson, how far into its loop, the learner's aim
   * when it started (a solo demo's camera turns as the learner looks
   * round), and a restart under way: the loop starting again or another
   * lesson, swapped in once the preview has dipped to black.
   */
  let demo:
    | {
        readonly lesson: Lesson;
        seconds: number;
        readonly aimYaw: number;
        restart?: { readonly lesson: Lesson; readonly at: number };
      }
    | undefined;

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

      // A column or the fountain coming down.
      if (event.type === "structure-hit" && event.stage === "destroyed") {
        shake.add(tuning.cameraShake.structureBreak);
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

  const viewSettings = {
    arena: courtyard,
    aura: wandAura,
    dodgeSeconds: tuning.defence.dodge.seconds,
    duelist: tuning.duelist,
    getUpSeconds: tuning.practice.getUpSeconds,
    glow: tuning.lockOnGlow,
    hit: tuning.spellLook.hitFlare,
    palette: tuning.spellPalette,
    potion: potionLook,
    robe: tuning.spellLook.burn.robe,
    staminaMax: tuning.defence.stamina.max,
    stone: tuning.petrifiedLook,
  };

  // The rigged wizard both Duelists wear, loaded once.
  const wizard = await loadWizardAssets(
    `${import.meta.env.BASE_URL}${tuning.duelist.motion.url}`,
    (share) => {
      loading.progress(
        stages.renderer + (stages.wizard - stages.renderer) * share
      );
    }
  );

  // The rival is a wizard, or against a Training Dummy the enchanted
  // mannequin (same rig re-dressed); both are built and compiled up front
  // and each run shows the one it needs.
  const rivalWizard = createDuelistView(
    opponentId,
    tuning.duelist.teamLooks.far,
    viewSettings,
    wizard
  );

  const rivalDummy = createDuelistView(
    opponentId,
    tuning.duelist.dummyLook,
    viewSettings,
    wizard,
    tuning.duelist.dummyLook
  );

  const views = new Map([
    [
      localId,
      createDuelistView(
        localId,
        tuning.duelist.teamLooks.near,
        viewSettings,
        wizard
      ),
    ],
    [opponentId, rivalWizard],
  ]);

  for (const view of [...views.values(), rivalDummy]) {
    scene.add(view.object);
  }

  rivalDummy.object.visible = false;

  /** Puts the rival `setup` calls for in the courtyard: a Training Dummy, or the wizard. */
  const dressRival = ({ practice }: DuelSetup) => {
    const dummy = practice !== null && practice !== "ai";
    rivalDummy.object.visible = dummy;
    rivalWizard.object.visible = !dummy;
    views.set(opponentId, dummy ? rivalDummy : rivalWizard);
  };

  // Disarmed Duelists' Wands, flying off, on the floor and flying home.
  const looseWands = createLooseWandView(
    tuning.looseWand,
    tuning.duelist.wand.length
  );

  scene.add(looseWands.object);

  const vfx = createSpellVfx(spellVfxSettings(tuning));

  scene.add(vfx.object);

  // The columns and the fountain: whole, cracking, and broken into rubble.
  const ruins = createRuinsView(courtyard, {
    courtyard: tuning.courtyard,
    look: tuning.structureLook,
    sparks: vfx.sparks,
    structures: tuning.structures,
  });

  scene.add(ruins.object);

  // The force of Depulso bursting off every Duelist it catches.
  const depulsoHits = createDepulsoHits(vfx.object, {
    cone: tuning.depulso,
    look: tuning.depulsoLook,
    sparks: vfx.sparks,
  });

  // The dust a slide kicks up.
  const slideDust = createSlideDust(vfx.object, {
    cloud: tuning.depulsoLook.cloud,
    look: tuning.slideDust,
    random: seededRandom(31),
    sparks: vfx.sparks,
  });

  // Protego domes and Parry flashes.
  const defenceVfx = createDefenceVfx(tuning.protego, [localId, opponentId]);
  scene.add(defenceVfx.object);

  // The Clash's beam between two Wands and its meeting point.
  const clashVfx = createClashVfx({
    look: tuning.clashLook,
    palette: tuning.spellPalette,
    sparks: vfx.sparks,
  });

  scene.add(clashVfx.object);

  // The camera must also stay clear of the torch stands on the parapet, which
  // are scenery rather than Cover, so Spells ignore them. It keeps clear of
  // the columns still standing: broken ones are low rubble it looks over.
  const torchStands = torchSpots(courtyard.bounds).map((spot) => ({
    center: { x: spot.x, z: spot.z },
    radius: tuning.camera.clearance.torchRadius,
  }));

  const cameraObstacles: CameraObstacles = {
    ...courtyard,
    cover: [...courtyard.cover, ...torchStands],
  };

  /** Follows the Arena as it stands in `snapshot`, when a piece has broken. */
  const followArena = (snapshot: DuelSnapshot) => {
    const wanted = snapshot.arena.cover.length + torchStands.length;

    if (cameraObstacles.cover.length !== wanted) {
      cameraObstacles.cover = [...snapshot.arena.cover, ...torchStands];
      cameraObstacles.obstructions = snapshot.arena.obstructions;
    }
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

  vfx.watchFrom(rig.camera);
  clashVfx.watchFrom(rig.camera);

  const frame = createFramePipeline(renderer, scene, rig.camera, tuning.render);

  // The lesson preview's demo: its own framed camera, drawn by this
  // renderer into the preview's canvas on Entrenamiento's list.
  const demoCamera = createDemoCamera(
    tuning.lessonDemo.camera,
    cameraObstacles
  );

  const preview = createPreviewPipeline(
    renderer,
    scene,
    demoCamera.camera,
    tuning.render,
    overlay.lessonMenu.canvas,
    frame.gpuTimer
  );

  /**
   * Frames the demo: the learner (and the dummy, unless the lesson is the
   * learner's alone), feet to head and a body's width either side, and any
   * Wand on the floor, looking down the lane, or for a solo demo turning
   * as the learner looks round.
   */
  const frameDemo = (
    snapshot: DuelSnapshot,
    samples: ReadonlyMap<DuelistId, DuelistSample>,
    seconds: number
  ) => {
    if (!demo) {
      return;
    }

    const stage = overlay.lessonMenu.canvasSize();

    if (stage.width > 0 && stage.height > 0) {
      demoCamera.resize(stage.width / stage.height);
    }

    const solo = demoIsSolo(demo.lesson, tuning.lessonDemo);
    const { bodyRadius, height } = tuning.duelist;
    const support: Point3[] = [];

    for (const [id, sample] of samples) {
      if (solo && id !== demoLearner) {
        continue;
      }

      const { x, z } = sample.position;
      const y = sample.elevation;
      support.push({ x, y, z }, { x, y: y + height, z });

      for (const [dx, dz] of [
        [bodyRadius, 0],
        [-bodyRadius, 0],
        [0, bodyRadius],
        [0, -bodyRadius],
      ] as const) {
        support.push({ x: x + dx, y: y + height / 2, z: z + dz });
      }
    }

    for (const each of snapshot.duelists) {
      if (each.looseWand && (!solo || each.id === demoLearner)) {
        support.push(each.looseWand.position);
      }
    }

    const learner = samples.get(demoLearner);

    const turned =
      solo && learner ? wrapAngle(learner.aim.yaw - demo.aimYaw) : 0;

    demoCamera.frame(support, tuning.lessonDemo.camera.yaw + turned, seconds);
  };

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

  // A Training lesson's goal, top-centre.
  const trainingHud = createTrainingHud(hudElement);

  // The parchment scrolls before and after a Training lesson, over it.
  const trainingScroll = createTrainingScroll(document.body);

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
  // Resized since the last frame drawn: the frame's targets are still the old size.
  let resized = false;

  const resize = () => {
    const { innerHeight: height, innerWidth: width } = window;
    hasArea = width > 0 && height > 0;

    if (!hasArea) {
      return;
    }

    renderer.setSize(width, height);
    rig.resize(width / height);
    resized = true;
  };

  resize();
  window.addEventListener("resize", resize);

  let previous: DuelSnapshot = duel.snapshot();
  let current: DuelSnapshot = previous;
  let lastFrame: number | undefined;

  /** Swaps in a brand-new Duel, as the first or a restarted one. */
  const startRun = (run: number, setup: DuelSetup) => {
    // Hide any Spell still flying from the old Duel before its ids repeat.
    vfx.update(current.spells, [], 0, 0);
    duel = createDuelFor(setup);
    controllers = createControllers(setup);
    dressRival(setup);
    clock = createFixedStepClock(tuning.tickRate);
    previous = duel.snapshot();
    current = previous;
    activeRun = run;
    lesson = setup.training && startLesson(setup.training.lesson);
    demo = undefined;
  };

  // The run number a demo plays under: never one the screens start.
  const demoRun = -1;

  /** Swaps in a fresh demo of `shown`: its Practice, the learner's script and the lesson's dummy. */
  const startDemo = (shown: Lesson) => {
    vfx.update(current.spells, [], 0, 0);
    duel = createDuel(demoDuelConfig(shown, courtyard, tuning));
    controllers = new Map(createDemoControllers(shown, courtyard, tuning));
    dressRival({ difficulty: "duelista", practice: lessonPlans[shown].rival });
    clock = createFixedStepClock(tuning.tickRate);
    previous = duel.snapshot();
    current = previous;
    activeRun = demoRun;
    lesson = undefined;

    const aimYaw =
      current.duelists.find((each) => each.id === demoLearner)?.aim.yaw ?? 0;

    demo = { aimYaw, lesson: shown, seconds: 0 };
    demoCamera.cut();
  };

  /**
   * Keeps the demo on the lesson highlighted while Entrenamiento's list is
   * up: the first frame starts it at once; a new highlight, or the end of
   * the loop, dips the preview to black and swaps the fresh demo in there.
   */
  const syncDemo = (screen: Screen, seconds: number) => {
    if (screen.kind !== "lessons") {
      return;
    }

    const { fadeSeconds, loopSeconds } = tuning.lessonDemo;

    if (!demo) {
      startDemo(screen.selected);

      return;
    }

    demo.seconds += seconds;

    const wanted = screen.selected;
    const looped = demo.seconds >= loopSeconds[demo.lesson];

    if ((wanted !== demo.lesson || looped) && demo.restart?.lesson !== wanted) {
      demo.restart = { at: demo.seconds + fadeSeconds, lesson: wanted };
      overlay.lessonMenu.blink();
    }

    if (demo.restart && demo.seconds >= demo.restart.at) {
      startDemo(demo.restart.lesson);
    }
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
   * This frame's menu sounds, heard and felt: the screens going from
   * `before` with `event`, or an Option changed in place.
   */
  const soundMenu = (before: ScreenState, event: ScreenEvent) => {
    const sound =
      menuSoundFor(before.screen, screens.screen, event) ??
      (before.options === screens.options
        ? null
        : ({ kind: "menu-move" } as const));

    if (sound) {
      audio.menu(sound);
      menuSounds.push(sound);
    }
  };

  // The Options last played under: a change is heard, and read, at once.
  let applied: PlayerOptions | undefined;

  const applyOptions = () => {
    if (screens.options === applied) {
      return;
    }

    applied = screens.options;
    showLanguage(applied.language);
    audio.volumes(volumesOf(applied));
  };

  /**
   * Tells the screens what the controller did this frame, then builds a new
   * Duel if they now call for one: a Duel or Practice they just started is a
   * new simulation, and the connect prompt and the menus show a fresh one
   * waiting at its start.
   */
  const syncScreens = (seconds: number) => {
    syncPad();

    for (const event of menuInput.read(pad, seconds)) {
      const before = screens;
      send(event);
      soundMenu(before, event);
    }

    const { screen } = screens;
    // A lesson's Duel is built as its scroll opens, to wait behind it.
    const shown = duelOf(screen);

    if (shown && shown.run !== activeRun) {
      startRun(shown.run, shown);
    } else if (
      (screen.kind === "connect" ||
        screen.kind === "main" ||
        screen.kind === "difficulty" ||
        screen.kind === "rivals") &&
      activeRun !== 0
    ) {
      startRun(0, waiting);
    }

    return screen;
  };

  /**
   * Counts one tick toward the Training lesson's goals; the screens hear
   * when its last goal is met, and it rings out and pulses.
   */
  const countLesson = (events: readonly DuelEvent[]) => {
    if (!lesson || lesson.done) {
      return;
    }

    lesson = advanceLesson(
      lesson,
      { after: current, before: previous, events },
      localId,
      tuning
    );

    if (lesson.done) {
      const before = screens;
      const event = { type: "lesson-done" } as const;
      send(event);
      soundMenu(before, event);
    }
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
      countLesson(result.events);
    }

    for (const event of events) {
      if (event.type === "duel-end") {
        const local = current.duelists.find((each) => each.id === localId);
        send({ type: "duel-ended", won: event.winner === local?.team });
      }
    }

    return { alpha, events };
  };

  // The side the current Knockout shot frames the fallen Duelist from:
  // chosen once when the shot starts, so it never flips mid-shot.
  let knockoutFrom: GroundPoint | undefined;

  // The Knockout shot's framing while a Round is not being fought: the
  // fallen Duelist seen from the winner's side, or the most open side near
  // it, clear of walls and Cover whichever way they faced.
  const knockoutFraming = (
    samples: ReadonlyMap<DuelistId, DuelistSample>
  ): Framing | undefined => {
    const fallen = current.duelists.find((each) => each.knockedOut);
    const fallenSample = fallen && samples.get(fallen.id);

    if (
      fallen === undefined ||
      fallenSample === undefined ||
      current.round.phase === "fighting"
    ) {
      knockoutFrom = undefined;

      return undefined;
    }

    const winner = current.duelists.find(
      (each) => !each.knockedOut && each.team !== fallen.team
    );

    knockoutFrom ??= knockoutSide(
      fallenSample.position,
      (winner && samples.get(winner.id)?.position) ?? {
        x: fallenSample.position.x + fallenSample.facing.x,
        z: fallenSample.position.z + fallenSample.facing.z,
      },
      cameraObstacles,
      tuning
    );

    return {
      nudge: { pitch: 0, yaw: 0 },
      self: knockoutViewpoint(
        fallenSample.position,
        knockoutFrom,
        cameraObstacles,
        tuning
      ),
      target: fallenSample.position,
    };
  };

  // Resolves once the loop is installed; the loop itself runs every frame.
  // Poses every Duelist and points the camera: the Knockout shot, Lock-on framing or free aim.
  const showDuelists = (alpha: number, seconds: number) => {
    const samples = new Map<DuelistId, DuelistSample>();

    const local = current.duelists.find((each) => each.id === localId);

    for (const state of current.duelists) {
      const before =
        previous.duelists.find((each) => each.id === state.id) ?? state;

      const sample = sampleDuelist(before, state, alpha, current.clash);

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

    // A lesson's demo is framed by its own camera; the rig stays as it was.
    if (demo) {
      frameDemo(current, samples, seconds);

      return samples;
    }

    const localSample = samples.get(localId);
    const knockout = knockoutFraming(samples);

    if (localSample && knockout) {
      // The Knockout shot, until the next Round lines everyone up again.
      rig.follow(localSample, knockout, seconds);
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

      // The reticle also hides while the free camera has lifted off the
      // aim line to keep the Duelist in view near a wall.
      reticle.show(
        { locked: target !== undefined || rig.offAimLine(), visible: true },
        rig.camera,
        seconds
      );
    }

    return samples;
  };

  // Every shader the courtyard and the wizards need, before the first frame.
  await renderer.compileAsync(scene, rig.camera, null, ({ loaded, total }) => {
    loading.progress(
      stages.wizard + ((stages.shaders - stages.wizard) * loaded) / total
    );
  });

  // The first frame, then every effect not drawn yet, still behind the
  // loading screen: the menus never draw the scene, so the first frame of a
  // Duel would otherwise be the one compiling it all.
  await frame.warm((share) => {
    loading.progress(
      stages.shaders + (stages.preview - stages.shaders) * share
    );
  });

  // The same for the lesson preview, through its own camera and canvas,
  // so neither opening Entrenamiento nor moving its highlight compiles.
  const { warmSize } = tuning.lessonDemo;
  preview.fit(warmSize.width, warmSize.height, window.devicePixelRatio);
  demoCamera.resize(warmSize.width / warmSize.height);
  demoCamera.frame(
    demoDuelConfig("clash", courtyard, tuning).duelists.map(({ spawn }) => ({
      x: spawn.x,
      y: 1,
      z: spawn.z,
    })),
    tuning.lessonDemo.camera.yaw,
    0
  );
  await preview.warm((share) => {
    loading.progress(stages.preview + (1 - stages.preview) * share);
  });

  // The Training Dummy is first drawn when Entrenamiento opens (and in a
  // lesson): drawn once each way here, posed, its shadow and colour
  // pipelines exist before then.
  dressRival({ difficulty: "duelista", practice: "idle" });
  showDuelists(0, 0);
  frame.render();
  preview.render();
  dressRival(waiting);
  loading.done();

  // `?perf`: frame, CPU and per-pass GPU timings in the corner.
  const probe = perfRequested()
    ? createFrameProbe(renderer, frame.gpuTimer)
    : undefined;

  /**
   * Draws the frame. The menus are opaque: behind them the scene is not
   * drawn, but for one frame after a resize, so the first frame of a Duel
   * never has to reallocate the frame's targets. Over Entrenamiento's list,
   * the preview's demo is the one thing drawn.
   */
  const draw = (menu: boolean) => {
    if (hasArea && (!menu || resized)) {
      frame.render();
      resized = false;
    }

    const stage = overlay.lessonMenu.canvasSize();

    if (demo && stage.width > 0 && stage.height > 0) {
      preview.fit(stage.width, stage.height, window.devicePixelRatio);
      preview.render();
    }
  };

  void renderer.setAnimationLoop((now: number) => {
    probe?.begin(now);
    const seconds = lastFrame === undefined ? 0 : (now - lastFrame) / 1000;
    lastFrame = now;

    const scan = scanGamepads(navigator.getGamepads());
    pad =
      scan.kind === "dualsense"
        ? readDualSense(scan.gamepad, tuning.input)
        : undefined;

    // The screens act first, so everything below sees the screen this frame ends on.
    menuSounds = [];
    scanned = scan.kind;
    const screen = syncScreens(seconds);
    applyOptions();
    syncDemo(screen, seconds);

    // The Duel only advances on its own screen: never behind a menu, the
    // pause or the "Reconecta tu mando" prompt. A Knockout plays in slow
    // motion: slow motion only scales the time fed to the simulation. On
    // Entrenamiento's list the highlighted lesson's demo plays instead,
    // seen only in its preview: nothing of it is heard, felt or counted.
    const live = screen.kind === "duel";
    const playing = live || demo !== undefined;
    const inDuel = showsDuel(screen);
    hudElement.hidden = !inDuel;
    // Behind the pause the Round's call-out would fight the menu for the centre.
    hudElement.classList.toggle("hud-held", inDuel && !live);
    // A Practice has no Rounds: no score at the top.
    hudElement.classList.toggle("hud-practice", practiceOf(screen) !== null);

    const timeScale =
      current.round.phase === "knockout" ? tuning.round.knockout.timeScale : 1;

    suspendControllersUnless(playing);

    const simSeconds = playing ? seconds * timeScale : 0;

    const { alpha, events } = advance(simSeconds);
    // What the player's own Duel did this frame: none of a demo's.
    const played = live ? events : [];

    effects.send(
      haptics.frame({
        events: played,
        live,
        menu: menuSounds,
        seconds,
        snapshot: current,
      }),
      scan.kind === "dualsense" ? scan.gamepad : undefined
    );

    if (live) {
      send({ seconds, type: "tick" });
    }

    const view = viewOf(screens.screen, screens.training, screens.options);

    if (view) {
      overlay.show(view);
    } else {
      overlay.hide();
    }

    // The Spell VFX face whichever camera is drawing.
    const viewer = demo ? demoCamera.camera : rig.camera;
    vfx.watchFrom(viewer);
    clashVfx.watchFrom(viewer);
    shakeOnHits(played);
    vfx.handle(events);
    ruins.handle(events);
    ruins.show(current.structures, simSeconds);
    followArena(current);
    depulsoHits.handle(events);
    depulsoHits.advance(simSeconds);
    slideDust.update(current.duelists, simSeconds);
    slideDust.handle(events);
    defenceVfx.handle(events);
    vfx.update(previous.spells, current.spells, alpha, simSeconds, {
      bodyOf: (id) => views.get(id)?.bodyPoints(),
      burning: feetOf(current, (each) => each.burnSeconds > 0),
      charging: chargingWands(current.duelists, tuning, (id) =>
        views.get(id)?.wandTipPosition()
      ),
      petrified: feetOf(current, (each) => each.petrifiedSeconds > 0),
    });
    hud.show(current, played, seconds);
    specialsHud.show(current);
    clashHud.show(current, played);
    trainingHud.show(trainingOf(screens.screen) && lesson);
    trainingScroll.show(scrollOf(screens.screen));
    clashVfx.handle(events);
    clashVfx.update(previous.clash, current.clash, alpha, simSeconds, (id) =>
      views.get(id)?.wandTipPosition()
    );

    if (!demo) {
      showCharge(current, events, seconds, inDuel);
    }

    // Casts, Backfires, Dodges, landings, hits and pickups play on the wizards.
    for (const duelistView of views.values()) {
      duelistView.handle(events);
    }

    looseWands.handle(events);
    const samples = showDuelists(alpha, seconds);
    looseWands.show(previous, current, alpha, simSeconds, (id) =>
      views.get(id)?.wandTipPosition()
    );
    worldHud.show(current, played, samples, rig.camera, seconds);
    audio.frame({
      events: played,
      live,
      screen: screens.screen,
      snapshot: current,
    });

    if (!inDuel) {
      reticleElement.hidden = true;
    }

    draw(view !== undefined);
    probe?.end(frame.scale());
  });
};

void start();

if (import.meta.env.DEV) {
  void import("./tuning-panel");
}
