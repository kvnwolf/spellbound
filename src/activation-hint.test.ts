import { describe, expect, it } from "vitest";

import { activationHintText } from "./activation-hint";
import { text } from "./text";

describe(activationHintText, () => {
  it("names both when both are pending", () => {
    expect(activationHintText({ effects: true, sound: true })).toBe(
      "Haz clic en la página para activar el sonido y los efectos del DualSense"
    );
  });

  it("names only the sound when only it is pending", () => {
    expect(activationHintText({ effects: false, sound: true })).toBe(
      text.activationHint.sound
    );
  });

  it("names only the effects when only they are pending", () => {
    expect(activationHintText({ effects: true, sound: false })).toBe(
      text.activationHint.effects
    );
  });

  it("is hidden when nothing is pending", () => {
    expect(
      activationHintText({ effects: false, sound: false })
    ).toBeUndefined();
  });
});
