/**
 * A Health bar as DOM, shared by the local Duelist's bar (bottom-left) and
 * each opponent's floating bar: the fill, a pale trailing segment for damage
 * just taken that lingers and then drains, and a brief flash and jolt on
 * every hit. It only writes the fill's width when the Health changes.
 */
export interface HealthBarSettings {
  readonly maxHealth: number;
  /** How long the pale "damage taken" part lingers before draining. */
  readonly healthLagDelay: number;
  /** How fast the lingering part drains, in Health per second. */
  readonly healthLagRate: number;
}

export interface HealthBar {
  readonly element: HTMLElement;
  /** Shows `health` after `seconds` of real time. */
  readonly show: (health: number, seconds: number) => void;
}

const create = (className: string, parent: HTMLElement) => {
  const element = document.createElement("div");
  element.className = className;
  parent.append(element);

  return element;
};

export const createHealthBar = (
  parent: HTMLElement,
  className: string,
  settings: HealthBarSettings
): HealthBar => {
  const bar = create(`health-bar ${className}`, parent);
  const lag = create("health-bar-lag", bar);
  const fill = create("health-bar-fill", bar);
  let shown = settings.maxHealth;
  let lagging = settings.maxHealth;
  let holdLag = 0;

  return {
    element: bar,
    show: (health, seconds) => {
      if (health < shown) {
        holdLag = settings.healthLagDelay;
        bar.animate(
          [
            { filter: "brightness(2.2)", translate: "-3px 0" },
            { filter: "brightness(1)", translate: "0 0" },
          ],
          { duration: 220, easing: "ease-out" }
        );
      }

      if (health > lagging) {
        // Health refilled (a new Round): no trailing damage to show.
        lagging = health;
      } else if (holdLag > 0) {
        holdLag -= seconds;
      } else {
        lagging = Math.max(lagging - settings.healthLagRate * seconds, health);
      }

      if (health !== shown) {
        shown = health;
        fill.style.width = `${(health / settings.maxHealth) * 100}%`;
      }

      lag.style.width = `${(lagging / settings.maxHealth) * 100}%`;
    },
  };
};
