/**
 * A development-only panel, shown and hidden with the P key, that changes
 * the movement tuning live while playing. Changes survive a reload (browser
 * storage) and "Copiar" puts them on the clipboard as `path: value` lines to
 * carry into `tuning.ts`. Its labels are a developer's, not the player's,
 * so they stay here rather than in `text.ts`.
 */
import { tuning } from "./tuning";

type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

// SAFETY: `tuning` is a plain object literal that `as const` makes readonly
// only to the type checker; this dev panel is its one writer at runtime.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see SAFETY above
const live = tuning as Mutable<typeof tuning>;

interface Knob {
  readonly label: string;
  readonly path: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly get: () => number;
  readonly set: (value: number) => void;
}

const knob = <K extends PropertyKey>(
  label: string,
  path: string,
  holder: Record<K, number>,
  key: K,
  [min, max, step]: readonly [number, number, number]
): Knob => ({
  get: () => holder[key],
  label,
  max,
  min,
  path,
  set: (value) => {
    holder[key] = value;
  },
  step,
});

const { gait } = live.duelist.motion;
const at = "duelist.motion.gait";

const knobs: readonly Knob[] = [
  knob(
    "Caminar (m/s)",
    "duelist.walkSpeed",
    live.duelist,
    "walkSpeed",
    [1, 4, 0.05]
  ),
  knob(
    "Correr (× caminar)",
    "defence.sprint.speedScale",
    live.defence.sprint,
    "speedScale",
    [1.2, 3.5, 0.05]
  ),
  knob(
    "Arranque (s a la mitad)",
    "movement.speedUpHalflife",
    live.movement,
    "speedUpHalflife",
    [0.02, 0.4, 0.01]
  ),
  knob(
    "Frenado (s a la mitad)",
    "movement.slowDownHalflife",
    live.movement,
    "slowDownHalflife",
    [0.02, 0.4, 0.01]
  ),
  knob(
    "Giro (s a la mitad)",
    "movement.turnHalflife",
    live.movement,
    "turnHalflife",
    [0.02, 0.4, 0.01]
  ),
  knob(
    "Pasos/s caminando, base",
    `${at}.cadence.walk.base`,
    gait.cadence.walk,
    "base",
    [0.5, 3, 0.05]
  ),
  knob(
    "Pasos/s caminando, por m/s",
    `${at}.cadence.walk.perSpeed`,
    gait.cadence.walk,
    "perSpeed",
    [0, 1, 0.01]
  ),
  knob(
    "Pasos/s corriendo, base",
    `${at}.cadence.run.base`,
    gait.cadence.run,
    "base",
    [1, 4, 0.05]
  ),
  knob(
    "Pasos/s corriendo, por m/s",
    `${at}.cadence.run.perSpeed`,
    gait.cadence.run,
    "perSpeed",
    [0, 0.6, 0.01]
  ),
  knob(
    "Zancada máxima (× clip)",
    `${at}.stride[1]`,
    gait.stride,
    1,
    [0.8, 1.8, 0.01]
  ),
  knob(
    "Cadera arriba al correr (m)",
    `${at}.lift`,
    gait,
    "lift",
    [0, 0.15, 0.005]
  ),
  knob("Rebote de la cadera", `${at}.bob`, gait, "bob", [0, 1, 0.01]),
  knob(
    "Pelvis adentro, caminando",
    `${at}.tuck.walk`,
    gait.tuck,
    "walk",
    [-0.2, 0.5, 0.01]
  ),
  knob(
    "Pelvis adentro, corriendo",
    `${at}.tuck.run`,
    gait.tuck,
    "run",
    [-0.2, 0.5, 0.01]
  ),
  knob(
    "Espalda recta, caminando",
    `${at}.upright.walk`,
    gait.upright,
    "walk",
    [-0.2, 0.6, 0.01]
  ),
  knob(
    "Espalda recta, corriendo",
    `${at}.upright.run`,
    gait.upright,
    "run",
    [-0.2, 0.8, 0.01]
  ),
  knob(
    "Inclinación al arrancar",
    `${at}.lean.share`,
    gait.lean,
    "share",
    [0, 1, 0.01]
  ),
  knob(
    "Inclinación máxima",
    `${at}.lean.maxForward`,
    gait.lean,
    "maxForward",
    [0, 0.4, 0.01]
  ),
  knob("Brazos calmados", `${at}.calm`, gait, "calm", [0, 1, 0.01]),
  knob("Mirada al horizonte", `${at}.horizon`, gait, "horizon", [0, 1, 0.01]),
];

const storageKey = "spellbound.tuning-panel";
const defaults = new Map(knobs.map((each) => [each, each.get()]));

/** The knobs moved off their defaults. */
const changes = () => knobs.filter((each) => each.get() !== defaults.get(each));

/** Saved as `path=value` lines. */
const save = () => {
  try {
    localStorage.setItem(
      storageKey,
      changes()
        .map((each) => `${each.path}=${String(each.get())}`)
        .join("\n")
    );
  } catch {
    // ponytail: unsaved across reloads is fine for a dev panel.
  }
};

const restore = () => {
  let saved = "";

  try {
    saved = localStorage.getItem(storageKey) ?? "";
  } catch {
    return;
  }

  for (const line of saved.split("\n")) {
    const [path, text = ""] = line.split("=");
    const value = Number(text);
    const found = knobs.find((each) => each.path === path);

    if (found !== undefined && text !== "" && Number.isFinite(value)) {
      found.set(value);
    }
  }
};

const panel = document.createElement("div");

panel.hidden = true;

panel.style.cssText =
  "position:fixed;top:12px;right:12px;z-index:9999;width:320px;max-height:calc(100vh - 24px);overflow:auto;padding:10px 12px;background:rgb(10 12 24 / 0.9);color:#e8e6f0;font:12px/1.3 ui-monospace,monospace;border-radius:8px";

const rows = knobs.map((each) => {
  const row = document.createElement("label");
  const name = document.createElement("span");
  const shown = document.createElement("span");
  const slider = document.createElement("input");

  row.style.cssText =
    "display:grid;grid-template-columns:1fr 44px;gap:2px 8px;margin-bottom:8px";
  name.textContent = each.label;
  shown.style.textAlign = "right";
  slider.type = "range";
  slider.min = String(each.min);
  slider.max = String(each.max);
  slider.step = String(each.step);
  slider.style.gridColumn = "1 / -1";

  const show = () => {
    slider.value = String(each.get());
    shown.textContent = String(each.get());
    shown.style.color = each.get() === defaults.get(each) ? "" : "#ffb36b";
  };

  slider.addEventListener("input", () => {
    each.set(Number(slider.value));
    save();
    show();
  });

  row.append(name, shown, slider);

  return { row, show };
});

const showAll = () => {
  for (const { show } of rows) {
    show();
  }
};

const button = (label: string, onClick: () => void) => {
  const element = document.createElement("button");

  element.textContent = label;
  element.style.cssText = "margin-right:8px;padding:4px 10px;font:inherit";
  element.addEventListener("click", onClick);

  return element;
};

const copy = button("Copiar", () => {
  const lines = changes().map((each) => `${each.path}: ${String(each.get())}`);

  void navigator.clipboard.writeText(
    lines.length > 0 ? lines.join("\n") : "(sin cambios)"
  );
  copy.textContent = "¡Copiado!";
  setTimeout(() => {
    copy.textContent = "Copiar";
  }, 1200);
});

const reset = button("Restablecer", () => {
  for (const [each, value] of defaults) {
    each.set(value);
  }

  save();
  showAll();
});

const title = document.createElement("div");

title.textContent = "Ajustes de movimiento (P oculta)";

title.style.cssText = "font-weight:bold;margin-bottom:10px";

panel.append(title, ...rows.map(({ row }) => row), copy, reset);

document.body.append(panel);

restore();

showAll();

window.addEventListener("keydown", (event) => {
  if (event.key.toLowerCase() === "p") {
    panel.toggleAttribute("hidden");
  }
});
