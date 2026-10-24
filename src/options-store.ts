/**
 * The player's Options, remembered in this browser's localStorage: the
 * language and the music's and effects' volumes. A first visit plays in the
 * browser's language (Spanish if it is Spanish, else English) with every
 * volume as mixed. Storage can be missing, blocked or full (a private
 * window, cleared site data): then nothing is remembered and the game plays
 * on with the first visit's Options.
 */
import { defaultOptions } from "./screens/screens";
import type { PlayerOptions } from "./screens/screens";
import { languageFor, languages } from "./text";
import type { Language } from "./text";

const languageKey = "spellbound.options.language";
const musicKey = "spellbound.options.music";
const effectsKey = "spellbound.options.effects";

const isLanguage = (value: string | null): value is Language =>
  languages.some((each) => each === value);

/** A remembered volume, or `fallback` for none or one out of range. */
const volumeOf = (value: string | null, steps: number, fallback: number) => {
  const level = Number(value ?? Number.NaN);

  return Number.isInteger(level) && level >= 0 && level <= steps
    ? level
    : fallback;
};

/** What was remembered, or the first visit's Options in `browserLanguage`. */
export const loadOptions = (
  browserLanguage: string | undefined,
  volumeSteps: number
): PlayerOptions => {
  const first = defaultOptions(languageFor(browserLanguage), volumeSteps);

  try {
    const language = localStorage.getItem(languageKey);

    return {
      effects: volumeOf(
        localStorage.getItem(effectsKey),
        volumeSteps,
        first.effects
      ),
      language: isLanguage(language) ? language : first.language,
      music: volumeOf(localStorage.getItem(musicKey), volumeSteps, first.music),
    };
  } catch {
    return first;
  }
};

/** Remembers `options`, if storage lets it. */
export const saveOptions = (options: PlayerOptions) => {
  try {
    localStorage.setItem(languageKey, options.language);
    localStorage.setItem(musicKey, String(options.music));
    localStorage.setItem(effectsKey, String(options.effects));
  } catch {
    // Not remembered this time; the game plays on regardless.
  }
};
