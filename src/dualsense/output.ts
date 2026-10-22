/**
 * DualSense output over WebHID (ADR-0001: output only, input never). Encodes
 * a desired output state into the bytes of the controller's main output
 * report: report 0x02 over USB, report 0x31 over Bluetooth with a sequence
 * number and a trailing CRC32. Pure: no DOM, no WebHID; the adapter that owns
 * the `HIDDevice` sends what this returns. Byte layout after Linux's
 * `drivers/hid/hid-playstation.c` and the MIT `daidr/dualsense-tester`.
 */
/* oxlint-disable no-bitwise -- report bytes, flags and the CRC are bit arithmetic */

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let crc = index;

  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xed_b8_83_20 ^ (crc >>> 1) : crc >>> 1;
  }

  return crc >>> 0;
});

/** Standard CRC-32 (IEEE 802.3, as zlib computes it) over `bytes`. */
export const crc32 = (bytes: Iterable<number>): number => {
  let crc = 0xff_ff_ff_ff;

  for (const byte of bytes) {
    crc = (crc >>> 8) ^ (crcTable[(crc ^ byte) & 0xff] ?? 0);
  }

  return (crc ^ 0xff_ff_ff_ff) >>> 0;
};

/** A colour as 0-255 channels. */
export interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

/**
 * What an adaptive trigger does. Positions run from 0 (at rest) to 1 (fully
 * pulled); force and amplitude from 0 to 1; frequency is in Hz.
 */
export type TriggerEffect =
  | { readonly kind: "off" }
  /** Continuous resistance from `start` to the end of the pull. */
  | {
      readonly kind: "resistance";
      readonly start: number;
      readonly force: number;
    }
  /** Resistance only between `start` and `end`, like a gun's trigger break. */
  | {
      readonly kind: "section";
      readonly start: number;
      readonly end: number;
      readonly force: number;
    }
  /** The trigger buzzes from `start` on. */
  | {
      readonly kind: "vibration";
      readonly start: number;
      readonly amplitude: number;
      readonly frequency: number;
    };

/** Everything Spellbound drives on the DualSense: the desired output state. */
export interface DualSenseOutput {
  /** Rumble motor strengths from 0 to 1: the left motor is the heavy one, the right the light one. */
  readonly rumble: { readonly left: number; readonly right: number };
  readonly lightbar: Rgb;
  /** The five player LEDs under the touchpad as a bit mask, bit 0 the leftmost. */
  readonly playerLeds: number;
  readonly triggers: {
    readonly l2: TriggerEffect;
    readonly r2: TriggerEffect;
  };
}

/** How the DualSense is connected; it decides the report's framing. */
export type Transport = "bluetooth" | "usb";

/** How each transport frames the main output report. */
const wire = {
  bluetooth: {
    /** 78 bytes on the wire, the report id included. */
    dataLength: 77,
    reportId: 0x31,
    /** Must be set; its meaning is not documented. */
    tag: 0x10,
  },
  /** Seeds the CRC of every output report. */
  crcSeed: 0xa2,
  /** 63 bytes on the wire, the report id included. */
  usb: { dataLength: 62, reportId: 0x02 },
} as const;

/** The parts of WebHID's `HIDCollectionInfo` the transport is told from. */
export interface HidCollectionLike {
  readonly inputReports?: readonly HidReportLike[];
  readonly outputReports?: readonly HidReportLike[];
}

interface HidReportLike {
  readonly reportId: number;
  readonly items?: readonly {
    readonly reportCount?: number;
    readonly reportSize?: number;
  }[];
}

const reportBits = (report: HidReportLike) =>
  (report.items ?? []).reduce(
    (bits, item) => bits + (item.reportSize ?? 0) * (item.reportCount ?? 0),
    0
  );

/** Input report sizes in bits, after the report id, as the DualSense declares them. */
const inputBitsByTransport = new Map<number, Transport>([
  [504, "usb"],
  [616, "bluetooth"],
]);

/**
 * Tells USB from Bluetooth by the HID descriptor WebHID exposes: first by the
 * size of the largest input report (as `daidr/dualsense-tester` does), then
 * by which main output report is declared. Undefined when neither fits.
 */
export const transportOf = (
  collections: readonly HidCollectionLike[]
): Transport | undefined => {
  const inputBits = Math.max(
    0,
    ...collections.flatMap((each) => (each.inputReports ?? []).map(reportBits))
  );

  const bySize = inputBitsByTransport.get(inputBits);

  if (bySize) {
    return bySize;
  }

  const outputIds = new Set(
    collections.flatMap((each) =>
      (each.outputReports ?? []).map((report) => report.reportId)
    )
  );

  if (outputIds.has(wire.bluetooth.reportId)) {
    return "bluetooth";
  }

  return outputIds.has(wire.usb.reportId) ? "usb" : undefined;
};

/** One output report, ready for `HIDDevice.sendReport(reportId, data)`. */
export interface OutputReport {
  readonly reportId: number;
  /** The report's bytes after the report id. */
  readonly data: Uint8Array<ArrayBuffer>;
}

/** Offsets inside the block shared by the USB and Bluetooth reports. */
const common = {
  leftMotor: 3,
  leftTrigger: 21,
  length: 47,
  lightbar: 44,
  lightbarSetup: 41,
  playerLeds: 43,
  rightMotor: 2,
  rightTrigger: 10,
  validFlag0: 0,
  validFlag1: 1,
  validFlag2: 38,
} as const;

const flag2 = { lightbarSetup: 0x02 } as const;

const lightbarSetupLightOut = 0x02;

const flag0 = {
  compatibleVibration: 0x01,
  hapticsSelect: 0x02,
  leftTriggerEffect: 0x08,
  rightTriggerEffect: 0x04,
} as const;

const flag1 = { lightbar: 0x04, playerIndicator: 0x10 } as const;

const triggerModes = {
  off: 0x00,
  resistance: 0x01,
  section: 0x02,
  vibration: 0x06,
} as const;

const toByte = (value: number) => Math.min(Math.max(Math.round(value), 0), 255);

/** A 0-1 level as a byte. */
const level = (value: number) => toByte(value * 255);

/** The effect block of one trigger: the mode, then its parameters. */
const triggerBlock = (effect: TriggerEffect): number[] => {
  const mode = triggerModes[effect.kind];

  if (effect.kind === "resistance") {
    return [mode, level(effect.start), level(effect.force)];
  }

  if (effect.kind === "section") {
    return [mode, level(effect.start), level(effect.end), level(effect.force)];
  }

  if (effect.kind === "vibration") {
    return [
      mode,
      toByte(effect.frequency),
      level(effect.amplitude),
      level(effect.start),
    ];
  }

  return [mode];
};

/** The block both transports share, with every output Spellbound drives set to `state`. */
const commonBlock = (state: DualSenseOutput) => {
  const block = new Uint8Array(common.length);

  block[common.validFlag0] =
    flag0.compatibleVibration |
    flag0.hapticsSelect |
    flag0.rightTriggerEffect |
    flag0.leftTriggerEffect;
  block[common.validFlag1] = flag1.lightbar | flag1.playerIndicator;
  block[common.rightMotor] = level(state.rumble.right);
  block[common.leftMotor] = level(state.rumble.left);
  block.set(triggerBlock(state.triggers.r2), common.rightTrigger);
  block.set(triggerBlock(state.triggers.l2), common.leftTrigger);
  block[common.playerLeds] = state.playerLeds & 0b1_1111;
  block.set(
    [
      toByte(state.lightbar.r),
      toByte(state.lightbar.g),
      toByte(state.lightbar.b),
    ],
    common.lightbar
  );

  return block;
};

/**
 * Wraps the shared block for the wire. USB sends it as is in report 0x02.
 * Bluetooth sends report 0x31: a sequence number in the high nibble, a fixed
 * tag, the block, padding, and a CRC32 over the 0xA2 output seed, the report
 * id and everything before the CRC itself.
 */
const frame = (
  block: Uint8Array,
  transport: Transport,
  sequence: number
): OutputReport => {
  if (transport === "usb") {
    const data = new Uint8Array(wire.usb.dataLength);
    data.set(block);

    return { data, reportId: wire.usb.reportId };
  }

  const { dataLength, reportId, tag } = wire.bluetooth;
  const data = new Uint8Array(dataLength);
  data.set([(sequence & 0x0f) << 4, tag]);
  data.set(block, 2);

  const crcAt = dataLength - 4;
  const crc = crc32([wire.crcSeed, reportId, ...data.subarray(0, crcAt)]);
  data.set([crc, crc >>> 8, crc >>> 16, crc >>> 24], crcAt);

  return { data, reportId };
};

/**
 * Encodes the desired output state as the DualSense's main output report.
 * `sequence` counts the reports sent to this controller; Bluetooth carries
 * it (modulo 16) so the pad can tell a new report from a repeat.
 */
export const encodeOutputReport = (
  state: DualSenseOutput,
  transport: Transport,
  sequence: number
): OutputReport => frame(commonBlock(state), transport, sequence);

/**
 * The one-off report that fades out the light a Bluetooth DualSense shows
 * after pairing, which otherwise keeps the lightbar from being driven. Harmless
 * over USB. Send it once when the controller is attached.
 */
export const encodeLightbarRelease = (
  transport: Transport,
  sequence: number
): OutputReport => {
  const block = new Uint8Array(common.length);

  block[common.validFlag2] = flag2.lightbarSetup;
  block[common.lightbarSetup] = lightbarSetupLightOut;

  return frame(block, transport, sequence);
};
