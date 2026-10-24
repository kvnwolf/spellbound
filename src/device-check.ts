/**
 * Whether this is a phone or a tablet, where Spellbound cannot be played:
 * a touch-first screen with no fine pointer (no mouse or trackpad), or a
 * browser that says it is mobile (its client hints or its user agent,
 * iPadOS's desktop one included). A laptop with a touchscreen still has
 * its trackpad, so it plays.
 */

const mobileAgent = /Android|iPhone|iPad|iPod|Mobile|Tablet|Silk|Kindle/u;

declare global {
  /** User-Agent Client Hints (Chromium only): not in TypeScript's DOM types yet. */
  interface Navigator {
    readonly userAgentData?: { readonly mobile: boolean };
  }
}

export const isPhoneOrTablet = (): boolean => {
  const touchFirst =
    window.matchMedia("(pointer: coarse)").matches &&
    !window.matchMedia("(any-pointer: fine)").matches;

  // iPadOS asks for desktop pages as a Mac; no Mac has a touchscreen.
  const iPad =
    navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1;

  return (
    touchFirst ||
    iPad ||
    navigator.userAgentData?.mobile === true ||
    mobileAgent.test(navigator.userAgent)
  );
};
