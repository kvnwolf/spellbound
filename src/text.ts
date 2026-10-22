/** Every player-facing string in Spellbound, in Spanish, so translation stays in one place. */
export const text = {
  connectDualSense: "Conecta tu DualSense y pulsa cualquier botón",
  hud: {
    defeat: "Derrota",
    draw: "Empate",
    /** Shown as control is given, after the countdown. */
    duel: "¡Duelo!",
    knockout: "K.O.",
    local: "Tú",
    rival: "Rival",
    round: (number: number) => `Ronda ${number}`,
    roundLost: "Ronda para el rival",
    roundWon: "Ronda para ti",
    victory: "¡Victoria!",
  },
  requiresDualSense: "Spellbound requiere un mando DualSense",
  title: "Spellbound",
  unsupportedBrowser: {
    body: "Spellbound necesita WebGPU. Ábrelo en una versión reciente de Chrome.",
    heading: "Navegador no compatible",
  },
} as const;
