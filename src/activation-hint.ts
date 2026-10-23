import { text } from "./text";

export interface Pending {
  /** The DualSense's WebHID effects still wait for the first click. */
  readonly effects: boolean;
  /** The sound still waits for the first click or keypress. */
  readonly sound: boolean;
}

/** What the hint says given what is still pending; `undefined` when nothing is. */
export const activationHintText = ({
  effects,
  sound,
}: Pending): string | undefined => {
  if (sound && effects) {
    return text.activationHint.both;
  }

  if (sound) {
    return text.activationHint.sound;
  }

  return effects ? text.activationHint.effects : undefined;
};

/**
 * The one hint line on the connect prompt and the Difficulty select that both
 * the sound and the DualSense effects report their pending state to: they start
 * on the same first click.
 */
export const createActivationHint = (overlay: HTMLElement) => {
  const element = document.createElement("p");
  element.className = "overlay-effects";
  element.hidden = true;
  overlay.append(element);

  const pending = { effects: false, sound: false };

  return {
    report: (feature: keyof Pending, isPending: boolean) => {
      pending[feature] = isPending;
      const line = activationHintText(pending);
      element.hidden = line === undefined;
      element.textContent = line ?? "";
    },
  };
};

export type ActivationHint = ReturnType<typeof createActivationHint>;
