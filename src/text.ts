/** Every player-facing string in Spellbound, in Spanish, so translation stays in one place. */
export const text = {
  /** On the connect prompt and the Difficulty select, naming what the first click still turns on: the sound, the DualSense's WebHID effects, or both. */
  activationHint: {
    both: "Haz clic en la página para activar el sonido y los efectos del DualSense",
    effects: "Haz clic en la página para activar los efectos del DualSense",
    sound: "Haz clic en la página para activar el sonido",
  },
  /** While the local Duelist is locked in a Clash. */
  clash: {
    /** Punched onto the screen as the Clash starts. */
    callout: "¡Clash!",
    /** Under the pulsing button, telling the player to pump. */
    pump: "¡Pulsa △!",
    /** The button glyph. */
    trigger: "△",
  },
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
  hud: {
    defeat: "Derrota",
    /** Called out when the local Duelist Disarms an opponent or is Disarmed. */
    disarmed: "¡Desarmado!",
    /** Under "¡Desarmado!" when it is the local Duelist who lost their Wand. */
    disarmedHint: "Recoge tu varita",
    draw: "Empate",
    /** Shown as control is given, after the countdown. */
    duel: "¡Duelo!",
    knockout: "K.O.",
    /** Called out when the local Duelist Parries a Spell. */
    parry: "¡Parry!",
    /** Over the Round-start countdown only: the HUD keeps no permanent Round label. */
    round: (number: number) => `Ronda ${number}`,
    roundLost: "Ronda para el rival",
    roundWon: "Ronda para ti",
    victory: "¡Victoria!",
  },
  menu: { hint: "✕ Confirmar     ○ Atrás" },
  pause: {
    continue: "Continuar",
    heading: "Pausa",
    quit: "Salir",
    restart: "Reiniciar",
  },
  /** Accessible label of the Potion Slots, bottom-left. */
  potions: "Pociones",
  requiresDualSense: "Spellbound requiere un mando DualSense",
  result: {
    changeDifficulty: "Cambiar dificultad",
    rematch: "Revancha",
  },
  /** The Special Spells, as the Spell Slots in the HUD (and over an opponent's Health bar) name them. */
  specials: {
    depulso: "Depulso",
    expelliarmus: "Expelliarmus",
    /** Accessible label of the Focus orbs. */
    focus: "Concentración",
    incendio: "Incendio",
    petrificus: "Petrificus Totalus",
  },
  /**
   * Punched onto the screen under the reticle when the local Duelist casts a
   * Special Spell, or lands a Perfect Release with Confringo.
   */
  spellCallouts: {
    confringo: "¡Confringo!",
    depulso: "¡Depulso!",
    expelliarmus: "¡Expelliarmus!",
    incendio: "¡Incendio!",
    petrificus: "¡Petrificus Totalus!",
  },
  title: "Spellbound",
  unsupportedBrowser: {
    body: "Spellbound necesita WebGPU. Ábrelo en una versión reciente de Chrome.",
    heading: "Navegador no compatible",
  },
} as const;
