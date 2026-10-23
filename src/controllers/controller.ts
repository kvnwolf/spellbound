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
  /**
   * The Duel has stopped asking for Intents (a menu, the pause, a prompt).
   * Called every frame it is not stepping. A Controller reading a human's
   * buttons uses it to ignore whatever is held when asking resumes.
   */
  readonly suspend?: () => void;
}

/** A Controller that never does anything: a dummy opponent for testing (`?rival=idle`). */
export const idleController: Controller = {
  intent: () => idleIntent,
};
