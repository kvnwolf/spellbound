/**
 * The slice of WebHID (Chromium only) Spellbound uses to send DualSense
 * output reports, and the Gamepad API's newer `effects` list: neither is in
 * TypeScript's DOM types yet.
 */
import type { HidCollectionLike } from "./dualsense/output";

declare global {
  interface HIDDevice {
    readonly opened: boolean;
    readonly collections: readonly HidCollectionLike[];
    readonly open: () => Promise<void>;
    readonly sendReport: (
      reportId: number,
      data: BufferSource
    ) => Promise<void>;
  }

  interface HIDConnectionEvent extends Event {
    readonly device: HIDDevice;
  }

  interface HIDDeviceFilter {
    readonly vendorId?: number;
    readonly productId?: number;
  }

  interface HIDEventMap {
    connect: HIDConnectionEvent;
    disconnect: HIDConnectionEvent;
  }

  interface HID {
    readonly getDevices: () => Promise<HIDDevice[]>;
    readonly requestDevice: (options: {
      readonly filters: readonly HIDDeviceFilter[];
    }) => Promise<HIDDevice[]>;
    readonly addEventListener: <K extends keyof HIDEventMap>(
      type: K,
      listener: (event: HIDEventMap[K]) => void
    ) => void;
  }

  interface Navigator {
    /** Missing outside Chromium. */
    readonly hid?: HID;
  }

  interface GamepadHapticActuator {
    /** The effects this pad can play; missing in browsers that predate it. */
    readonly effects?: readonly GamepadHapticEffectType[];
  }
}
