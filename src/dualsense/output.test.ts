import { describe, expect, it } from "vitest";

import {
  crc32,
  encodeLightbarRelease,
  encodeOutputReport,
  fitToDescriptor,
  outputReportBytes,
  transportOf,
} from "./output";
import type { DualSenseOutput } from "./output";

const ascii = (value: string) => new TextEncoder().encode(value);

/** A report's non-zero bytes as `[offset, byte]` pairs. */
const nonZero = (bytes: Uint8Array) =>
  [...bytes].flatMap((byte, offset) => (byte === 0 ? [] : [[offset, byte]]));

/** The bytes from `start` up to `end` as a plain array. */
const bytesAt = (bytes: Uint8Array, start: number, end?: number) => [
  ...bytes.subarray(start, end),
];

/** Strong rumble on the left motor, a little on the right, an orange lightbar and the centre player LED. */
const rumbling: DualSenseOutput = {
  lightbar: { b: 0, g: 64, r: 255 },
  playerLeds: 0b0_0100,
  rumble: { left: 1, right: 0.2 },
  triggers: { l2: { kind: "off" }, r2: { kind: "off" } },
};

describe(crc32, () => {
  it("matches the standard CRC-32 check value", () => {
    // The CRC-32 (IEEE 802.3, zlib) check value for "123456789".
    expect(crc32(ascii("123456789"))).toBe(0xcb_f4_39_26);
  });
});

describe(encodeOutputReport, () => {
  describe("over USB", () => {
    it("writes report 0x02: valid flags, both motors, lightbar and player LEDs", () => {
      const report = encodeOutputReport(rumbling, "usb", 0);

      expect(report.reportId).toBe(0x02);
      // The 47 bytes the DualSense's descriptor declares for report 0x02.
      expect(report.data).toHaveLength(47);
      expect(nonZero(report.data)).toStrictEqual([
        // Compatible vibration, haptics select, right and left trigger effects.
        [0, 0x0f],
        // Lightbar and player indicator control.
        [1, 0x14],
        // Right (light) motor, then left (heavy) motor.
        [2, 51],
        [3, 255],
        [43, 0b0_0100],
        [44, 255],
        [45, 64],
      ]);
    });

    it("writes the right then the left trigger effect blocks", () => {
      const report = encodeOutputReport(
        {
          ...rumbling,
          triggers: {
            l2: { end: 0.6, force: 0.4, kind: "section", start: 0.2 },
            r2: { force: 1, kind: "resistance", start: 0.2 },
          },
        },
        "usb",
        0
      );

      // Right trigger block: mode, then its parameters.
      expect(bytesAt(report.data, 10, 21)).toStrictEqual([
        0x01, 51, 255, 0, 0, 0, 0, 0, 0, 0, 0,
      ]);
      // Left trigger block.
      expect(bytesAt(report.data, 21, 32)).toStrictEqual([
        0x02, 51, 153, 102, 0, 0, 0, 0, 0, 0, 0,
      ]);
    });

    it("writes a vibrating trigger as frequency, amplitude and start", () => {
      const report = encodeOutputReport(
        {
          ...rumbling,
          triggers: {
            l2: { kind: "off" },
            r2: { amplitude: 1, frequency: 30, kind: "vibration", start: 0.2 },
          },
        },
        "usb",
        0
      );

      expect(bytesAt(report.data, 10, 14)).toStrictEqual([0x06, 30, 255, 51]);
    });

    it("clamps out-of-range levels to a byte", () => {
      const report = encodeOutputReport(
        {
          ...rumbling,
          lightbar: { b: -20, g: 300, r: 12.4 },
          rumble: { left: 1.5, right: -0.2 },
        },
        "usb",
        0
      );

      expect(bytesAt(report.data, 2, 4)).toStrictEqual([0, 255]);
      expect(bytesAt(report.data, 44, 47)).toStrictEqual([12, 255, 0]);
    });
  });

  describe("over Bluetooth", () => {
    it("writes report 0x31: sequence, tag, the shared block and a CRC32 over the 0xA2 seed", () => {
      const report = encodeOutputReport(rumbling, "bluetooth", 0);

      expect(report.reportId).toBe(0x31);
      // 78 bytes on the wire, the report id included.
      expect(report.data).toHaveLength(77);
      expect(nonZero(report.data)).toStrictEqual([
        // Sequence 0 in the high nibble, then the fixed 0x10 tag.
        [1, 0x10],
        // The same block as over USB, two bytes further in.
        [2, 0x0f],
        [3, 0x14],
        [4, 51],
        [5, 255],
        [45, 0b0_0100],
        [46, 255],
        [47, 64],
        // CRC32 of 0xA2, 0x31 and the first 73 bytes, little-endian
        // (worked out independently with Python's zlib.crc32).
        [73, 89],
        [74, 44],
        [75, 28],
        [76, 6],
      ]);
    });

    it("carries the sequence number in the high nibble, wrapping at 16", () => {
      const fifth = encodeOutputReport(rumbling, "bluetooth", 5);
      const wrapped = encodeOutputReport(rumbling, "bluetooth", 21);

      expect(fifth.data[0]).toBe(0x50);
      expect(bytesAt(fifth.data, 73)).toStrictEqual([21, 12, 162, 81]);
      expect([...wrapped.data]).toStrictEqual([...fifth.data]);
    });
  });
});

/** A HID report declared with one item of `bytes` bytes. */
const declared = (reportId: number, bytes: number) => ({
  items: [{ reportCount: bytes, reportSize: 8 }],
  reportId,
});

const gamepadCollection = { usage: 0x05, usagePage: 0x01 };

describe(transportOf, () => {
  it("knows USB by its 64-byte input report", () => {
    expect(
      transportOf([
        {
          ...gamepadCollection,
          inputReports: [declared(0x01, 63)],
          outputReports: [declared(0x02, 47)],
        },
      ])
    ).toBe("usb");
  });

  it("knows Bluetooth by its 78-byte input report", () => {
    expect(
      transportOf([
        {
          ...gamepadCollection,
          inputReports: [declared(0x01, 9), declared(0x31, 77)],
          outputReports: [declared(0x31, 77)],
        },
      ])
    ).toBe("bluetooth");
  });

  it("falls back to the output report the descriptor declares", () => {
    expect(
      transportOf([
        { ...gamepadCollection, outputReports: [declared(0x31, 77)] },
      ])
    ).toBe("bluetooth");
    expect(
      transportOf([
        { ...gamepadCollection, outputReports: [declared(0x02, 47)] },
      ])
    ).toBe("usb");
  });

  it("gives up on a descriptor it does not recognise", () => {
    expect(transportOf([])).toBeUndefined();
  });
});

describe(outputReportBytes, () => {
  it("sums the declared items of the report with that id, in bytes", () => {
    expect(
      outputReportBytes(
        [
          {
            ...gamepadCollection,
            outputReports: [
              declared(0x02, 47),
              {
                items: [
                  { reportCount: 4, reportSize: 8 },
                  { reportCount: 8, reportSize: 4 },
                ],
                reportId: 0x05,
              },
            ],
          },
        ],
        0x05
      )
    ).toBe(8);
  });

  it("finds the report in any collection", () => {
    expect(
      outputReportBytes(
        [
          { ...gamepadCollection, outputReports: [declared(0x31, 77)] },
          { ...gamepadCollection, outputReports: [declared(0x02, 47)] },
        ],
        0x02
      )
    ).toBe(47);
  });

  it("is undefined when the descriptor does not declare the report", () => {
    expect(
      outputReportBytes(
        [{ ...gamepadCollection, outputReports: [declared(0x31, 77)] }],
        0x02
      )
    ).toBeUndefined();
    expect(outputReportBytes([], 0x02)).toBeUndefined();
  });
});

/** A descriptor that declares output report 0x02 as `bytes` bytes. */
const declaring = (bytes: number) => [
  { ...gamepadCollection, outputReports: [declared(0x02, bytes)] },
];

describe(fitToDescriptor, () => {
  const report = { data: new Uint8Array([1, 2, 3, 4]), reportId: 0x02 };

  it("pads a short report with zeros up to the declared size", () => {
    const fitted = fitToDescriptor(report, declaring(6));

    expect(fitted.reportId).toBe(0x02);
    expect([...fitted.data]).toStrictEqual([1, 2, 3, 4, 0, 0]);
  });

  it("trims the tail of a long report down to the declared size", () => {
    expect([...fitToDescriptor(report, declaring(3)).data]).toStrictEqual([
      1, 2, 3,
    ]);
  });

  it("leaves a report of the declared size as it is", () => {
    expect([...fitToDescriptor(report, declaring(4)).data]).toStrictEqual([
      1, 2, 3, 4,
    ]);
  });

  it("leaves the report as it is when the descriptor does not declare it", () => {
    expect(fitToDescriptor(report, [])).toBe(report);
  });
});

describe(encodeLightbarRelease, () => {
  it("over Bluetooth, fades out the pairing light so the lightbar can be driven", () => {
    const report = encodeLightbarRelease("bluetooth", 1);

    expect(report.reportId).toBe(0x31);
    expect(nonZero(report.data)).toStrictEqual([
      [0, 0x10],
      [1, 0x10],
      // Lightbar setup control, then the "light out" setup.
      [40, 0x02],
      [43, 0x02],
      [73, 234],
      [74, 18],
      [75, 13],
      [76, 74],
    ]);
  });

  it("over USB, sends the same setup in report 0x02", () => {
    const report = encodeLightbarRelease("usb", 0);

    expect(report.reportId).toBe(0x02);
    expect(report.data).toHaveLength(47);
    expect(nonZero(report.data)).toStrictEqual([
      [38, 0x02],
      [41, 0x02],
    ]);
  });
});
