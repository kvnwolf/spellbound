import type { DuelistId, DuelSnapshot } from "../duel/duel";
import { idleIntent } from "../duel/intent";
import type { Intent } from "../duel/intent";

/** What a Controller sees when deciding: the Duel as of the last tick, and who it drives. */
export interface ControllerView {
  readonly snapshot: DuelSnapshot;
  readonly self: DuelistId;
}

/**
 * The source of a Duelist's Intent, human or AI. Every Duelist is driven by
 * exactly one Controller, so a Duel can hold any mix of them.
 */
export interface Controller {
  readonly intent: (view: ControllerView) => Intent;
}

/** A Controller that never does anything: the opponent before the AI exists. */
export const idleController: Controller = {
  intent: () => idleIntent,
};
