/**
 * Sends the haptics director's output to the DualSense (ADR-0001): through
 * WebHID output reports once the player has granted the device, otherwise
 * through the Gamepad API's dual-rumble where the pad supports it. WebHID is
 * never read: input stays on the Gamepad API.
 *
 * WebHID's `requestDevice` needs a mouse click or keypress (gamepad presses
 * are not user activation), so the first click or keypress on the page asks
 * for the DualSense, once per page load and only while none is granted yet.
 * Later visits reattach through `getDevices()` without asking.
 */
import {
  encodeLightbarRelease,
  encodeOutputReport,
  transportOf,
} from "./dualsense/output";
import type {
  DualSenseOutput,
  OutputReport,
  Transport,
} from "./dualsense/output";
import { text } from "./text";
import { tuning } from "./tuning";

/** Sony's vendor id with the DualSense and DualSense Edge product ids. */
const dualSenseFilters = [
  { productId: 0x0c_e6, vendorId: 0x05_4c },
  { productId: 0x0d_f2, vendorId: 0x05_4c },
] as const;

/** Still motors, free triggers and a dark lightbar: what the pad is left with. */
const silent: DualSenseOutput = {
  lightbar: { b: 0, g: 0, r: 0 },
  playerLeds: 0,
  rumble: { left: 0, right: 0 },
  triggers: { l2: { kind: "off" }, r2: { kind: "off" } },
};

/** The output bytes without framing or sequence: equal keys mean nothing changed. */
const outputKey = (output: DualSenseOutput) =>
  encodeOutputReport(output, "usb", 0).data.join(",");

/**
 * An opened DualSense that output reports go to: only when the output
 * changed, one report in flight at a time, the latest output winning.
 */
const createWebHidSink = (
  device: HIDDevice,
  transport: Transport,
  onLost: () => void
) => {
  let sequence = 0;
  let sentKey: string | undefined;
  let pending: DualSenseOutput | undefined;
  let busy = false;

  const write = async (report: OutputReport) => {
    sequence = (sequence + 1) % 16;
    await device.sendReport(report.reportId, report.data);
  };

  const pump = async () => {
    busy = true;

    try {
      while (pending) {
        const output = pending;
        pending = undefined;
        const key = outputKey(output);

        if (key !== sentKey) {
          sentKey = key;
          // oxlint-disable-next-line no-await-in-loop -- reports go out one at a time, in order
          await write(encodeOutputReport(output, transport, sequence));
        }
      }
    } catch {
      onLost();
    } finally {
      busy = false;
    }
  };

  return {
    device,
    /** Takes the lightbar over from the light a Bluetooth pad shows after pairing. */
    release: async () => {
      try {
        await write(encodeLightbarRelease(transport, sequence));
      } catch {
        onLost();
      }
    },
    send: (output: DualSenseOutput) => {
      pending = output;

      if (!busy) {
        void pump();
      }
    },
  };
};

type WebHidSink = ReturnType<typeof createWebHidSink>;

/** The pad's Gamepad API rumble, when it can play dual-rumble. */
const dualRumbleOf = (gamepad: Gamepad | undefined) => {
  const actuator: GamepadHapticActuator | null | undefined =
    gamepad?.vibrationActuator;

  return actuator?.effects?.includes("dual-rumble") === true
    ? actuator
    : undefined;
};

/** Plays one moment of dual-rumble. */
const playRumble = async (
  actuator: GamepadHapticActuator,
  left: number,
  right: number
) => {
  try {
    await actuator.playEffect("dual-rumble", {
      duration: tuning.haptics.fallback.effectSeconds * 1000,
      strongMagnitude: Math.min(left, 1),
      weakMagnitude: Math.min(right, 1),
    });
  } catch {
    // The pad went away or refused: the next frame tries again.
  }
};

const stopRumble = async (actuator: GamepadHapticActuator) => {
  try {
    await actuator.reset();
  } catch {
    // Nothing to stop.
  }
};

/**
 * Dual-rumble through the Gamepad API, for when WebHID was not granted. Each
 * play lasts a moment, so it is replayed while the rumble fades, and reset
 * as soon as it stops.
 */
const createFallbackRumble = () => {
  let rumbling = false;
  let playedAt = Number.NEGATIVE_INFINITY;

  return (output: DualSenseOutput, gamepad: Gamepad | undefined) => {
    const actuator = dualRumbleOf(gamepad);

    if (!actuator) {
      return;
    }

    const { left, right } = output.rumble;
    const now = performance.now() / 1000;
    const wasRumbling = rumbling;
    rumbling = left > 0 || right > 0;

    if (!rumbling) {
      if (wasRumbling) {
        void stopRumble(actuator);
      }

      return;
    }

    if (
      !wasRumbling ||
      now - playedAt >= tuning.haptics.fallback.resendSeconds
    ) {
      playedAt = now;
      void playRumble(actuator, left, right);
    }
  };
};

/**
 * Drives the DualSense's effects for the page. `overlay` is the title's
 * panel, where a hint says a click turns the effects on until they are
 * granted.
 */
export const createDualSenseEffects = (overlay: HTMLElement) => {
  const { hid } = navigator;
  const hint = document.createElement("p");
  hint.className = "overlay-effects";
  hint.textContent = text.effectsHint;
  hint.hidden = true;
  overlay.append(hint);

  let sink: WebHidSink | undefined;
  /** `getDevices()` has answered, so a click knows whether a DualSense is already granted. */
  let checked = false;
  let granted = false;
  /** The chooser was shown this page load; it is never shown twice. */
  let prompted = false;

  const updateHint = () => {
    hint.hidden = !hid || !checked || granted || prompted;
  };

  const attach = async (device: HIDDevice) => {
    if (sink) {
      return;
    }

    try {
      if (!device.opened) {
        await device.open();
      }
    } catch (error) {
      console.warn("DualSense effects: could not open the controller", error);

      return;
    }

    const transport = transportOf(device.collections);

    if (!transport) {
      console.warn("DualSense effects: unknown HID descriptor, left alone");

      return;
    }

    const opened = createWebHidSink(device, transport, () => {
      sink = undefined;
    });

    sink = opened;
    await opened.release();
  };

  const attachFirst = async (devices: readonly HIDDevice[]) => {
    granted ||= devices.length > 0;
    updateHint();

    for (const device of devices) {
      // oxlint-disable-next-line no-await-in-loop -- the first one that opens wins
      await attach(device);
    }
  };

  const ask = async () => {
    if (!hid || !checked || granted || prompted) {
      return;
    }

    prompted = true;
    updateHint();

    try {
      await attachFirst(await hid.requestDevice({ filters: dualSenseFilters }));
    } catch {
      // The chooser failed to open: no more asking until the next visit.
    }
  };

  const reattach = async (webHid: HID) => {
    try {
      const devices = await webHid.getDevices();
      checked = true;
      await attachFirst(devices);
    } catch {
      checked = true;
      updateHint();
    }
  };

  if (hid) {
    void reattach(hid);

    // A granted DualSense plugged back in, over USB or Bluetooth.
    hid.addEventListener("connect", (event) => {
      void attachFirst([event.device]);
    });
    hid.addEventListener("disconnect", (event) => {
      if (event.device === sink?.device) {
        sink = undefined;
      }
    });

    const onGesture = () => {
      void ask();
    };

    window.addEventListener("pointerdown", onGesture);
    window.addEventListener("keydown", onGesture);
    // Leave the pad still and dark when the page goes away.
    window.addEventListener("pagehide", () => sink?.send(silent));
  }

  const fallback = createFallbackRumble();

  return {
    /** Sends this frame's desired output: over WebHID when attached, else as dual-rumble on `gamepad`. */
    send: (output: DualSenseOutput, gamepad: Gamepad | undefined) => {
      if (sink) {
        sink.send(output);
      } else {
        fallback(output, gamepad);
      }
    },
  };
};
