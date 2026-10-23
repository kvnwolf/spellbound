/** Every player-facing string in Spellbound, in Spanish, so translation stays in one place. */
export const text = {
  connectDualSense: "Conecta tu DualSense y pulsa cualquier botón",
  difficulty: {
    duelista: "Duelista",
    heading: "Elige tu dificultad",
    maestro: "Maestro",
    novato: "Novato",
  },
  disconnected: {
    heading: "Reconecta tu mando",
    reconnected: "Pulsa cualquier botón para continuar",
    waiting: "Conecta tu DualSense para continuar",
  },
  /** On the connect prompt and the Difficulty select until the DualSense's WebHID effects are granted: the first click asks for them. */
  effectsHint: "Haz clic en la página para activar los efectos del DualSense",
  hud: {
    defeat: "Derrota",
    draw: "Empate",
    /** Shown as control is given, after the countdown. */
    duel: "¡Duelo!",
    knockout: "K.O.",
    local: "Tú",
    /** Called out when the local Duelist Parries a Spell. */
    parry: "¡Parry!",
    rival: "Rival",
    round: (number: number) => `Ronda ${number}`,
    roundLost: "Ronda para el rival",
    roundWon: "Ronda para ti",
    /** Label of the Stamina bar. */
    stamina: "Aguante",
    victory: "¡Victoria!",
  },
  menu: { hint: "✕ Confirmar     ○ Atrás" },
  pause: {
    continue: "Continuar",
    heading: "Pausa",
    quit: "Salir",
    restart: "Reiniciar",
  },
  requiresDualSense: "Spellbound requiere un mando DualSense",
  result: {
    changeDifficulty: "Cambiar dificultad",
    rematch: "Revancha",
  },
  /** The Special Spells, as the Spell Slots in the HUD name them. */
  specials: {
    expelliarmus: "Expelliarmus",
    /** Accessible label of the Focus orbs. */
    focus: "Concentración",
    incendio: "Incendio",
    /** On a Spell Slot kept for a Special Spell that is not in the game yet. */
    locked: "Próximamente",
    petrificus: "Petrificus Totalus",
  },
  title: "Spellbound",
  unsupportedBrowser: {
    body: "Spellbound necesita WebGPU. Ábrelo en una versión reciente de Chrome.",
    heading: "Navegador no compatible",
  },
} as const;
