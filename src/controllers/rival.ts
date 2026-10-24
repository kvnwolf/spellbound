import type { PracticeRival } from "../duel/practice";
import { createAiController } from "./ai-controller";
import type { AiSetup } from "./ai-controller";
import { createCasterDummy } from "./caster-dummy";
import { createClashDummy } from "./clash-dummy";
import type { Controller } from "./controller";
import { idleController } from "./controller";
import { createDisarmsDummy } from "./disarms-dummy";

/**
 * The Controller for the local Duelist's opponent: the AI at the chosen
 * Difficulty (a Duel, or a Practice against Rival real), or one of the
 * Training Dummies, each set to its rhythm in `tuning.practice.dummies`.
 */
export const createRival = (
  rival: PracticeRival,
  setup: AiSetup
): Controller => {
  const { tuning } = setup;
  const { dummies } = tuning.practice;
  const ticksOf = (seconds: number) => Math.round(seconds * tuning.tickRate);

  if (rival === "idle") {
    return idleController;
  }

  if (rival === "casts") {
    return createCasterDummy(ticksOf(dummies.castInterval));
  }

  if (rival === "clash") {
    return createClashDummy({
      fullSeconds: tuning.confringo.fullSeconds,
      holdPastFullTicks: ticksOf(dummies.clashHoldPastFull),
      pumpEveryTicks: ticksOf(1 / dummies.clashPumpRate),
    });
  }

  if (rival === "disarms") {
    return createDisarmsDummy({
      firstCastTicks: ticksOf(dummies.disarmsFirstCast),
      intervalTicks: ticksOf(dummies.disarmsInterval),
      spellSlots: tuning,
    });
  }

  return createAiController(setup);
};
