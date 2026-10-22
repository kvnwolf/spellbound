# DualSense: read through the Gamepad API, drive effects through hand-rolled WebHID

The standard Gamepad API exposes the DualSense's buttons, sticks and analog triggers reliably, but not its adaptive triggers, lightbar or player LEDs, and its rumble does not work on Windows Chrome. WebHID reaches all of those (Chromium only, behind a one-time permission click). We read input only through the Gamepad API and use WebHID only to send output reports, so the game stays fully playable when WebHID is not granted, and a Bluetooth pad is never switched into the extended input mode that can break the browser's own gamepad parsing. The output-report writer, including the Bluetooth CRC32, is hand-rolled in about 200 lines instead of depending on `dualsense-ts`, which is LGPL-3.0 and also takes over input.

## Considered Options

- Everything through WebHID (input too, which also unlocks the gyro): rejected for now; it makes the permission mandatory and risks Bluetooth mode conflicts. Gyro aiming can revisit this.
- `dualsense-ts`: rejected for its licence and because it owns input as well as output.
