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
  connectDualSense: "Conecta tu DualSense y pulsa ✕",
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
  /** The fan-game disclaimer at the foot of the menus. */
  legal:
    "Spellbound es un fan game gratuito y sin fines de lucro, no afiliado, respaldado ni patrocinado por Warner Bros. Entertainment Inc., J.K. Rowling ni Wizarding World. Los nombres de hechizos y pociones del universo de Harry Potter son marcas y propiedad de sus respectivos dueños y se usan como homenaje.",
  /** The loading bar's name for screen readers; nothing is shown. */
  loading: "Cargando",
  /** The main menu, the root once a DualSense is connected. */
  mainMenu: {
    controls: "Controles",
    duel: "Duelo",
    practice: "Práctica",
    training: "Entrenamiento",
  },
  menu: { hint: "✕ Confirmar     ○ Atrás" },
  pause: {
    /** In a Practice: back to the rival picker. */
    changeRival: "Cambiar rival",
    continue: "Continuar",
    heading: "Pausa",
    quit: "Salir",
    /** In a Practice, Salir names where it goes. */
    quitToMenu: "Salir al menú",
    restart: "Reiniciar",
  },
  /**
   * Punched onto the screen under the reticle, like a Spell's name, when the
   * local Duelist's Potion is down, or lost to a hit.
   */
  potionCallouts: {
    interrupted: "¡Poción perdida!",
    strength: "¡Poción de Fuerza!",
    swiftness: "¡Poción de Celeridad!",
    wiggenweld: "¡Wiggenweld!",
  },
  /** The Potions, as the Potion Slots and the active effects in the HUD name them. */
  potions: {
    /** Accessible label of the Potion Slots, bottom-left. */
    label: "Pociones",
    strength: "Fuerza",
    swiftness: "Celeridad",
    wiggenweld: "Wiggenweld",
  },
  /** The Practice rival picker: the Training Dummies and the AI. */
  practice: {
    ai: "Rival real",
    casts: "Maniquí que lanza hechizos",
    clash: "Maniquí de Clash",
    disarms: "Maniquí desarmador",
    heading: "Práctica",
    idle: "Maniquí quieto",
    rivals: "Elige tu rival",
  },
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
  /** Over the title: one click anywhere starts, turning on the sound and the DualSense's effects too. */
  start: "Haz clic para comenzar",
  title: "Spellbound",
  unsupportedBrowser: {
    body: "Spellbound necesita WebGPU. Ábrelo en una versión reciente de Chrome.",
    heading: "Navegador no compatible",
  },
} as const;
