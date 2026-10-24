/** Every player-facing string in Spellbound, in Spanish, so translation stays in one place. */
export const text = {
  /** On the connect prompt and the Difficulty select, naming what the first click still turns on: the sound, the DualSense's WebHID effects, or both. */
  activationHint: {
    both: "Haz clic en la página para activar el sonido y los efectos del DualSense",
    effects: "Haz clic en la página para activar los efectos del DualSense",
    sound: "Haz clic en la página para activar el sonido",
  },
  /** The face buttons' names, for screen readers, where their icons stand in the text. */
  buttons: {
    circle: "círculo",
    cross: "equis",
    square: "cuadrado",
    triangle: "triángulo",
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
  /**
   * The Controls: what every button does, on a DualSense drawn by us, and
   * what the less obvious mechanics mean, on two tabs.
   */
  controls: {
    /** What each control does, as labelled on the drawn DualSense. */
    actions: {
      dodge: "Esquivar",
      heavySpell: "Hechizo pesado",
      jump: "Saltar",
      lightSpell: "Hechizo ligero",
      lockOn: "Fijar objetivo",
      look: "Cámara",
      move: "Moverse",
      pause: "Pausa",
      potionSlots: "Pociones",
      shield: "Escudo",
      spellSlots: "Hechizos especiales",
      sprint: "Correr",
    },
    /** A second line under some labels. */
    details: {
      heavySpell: "Mantén para cargar\u00A0· Pulsa en un Clash",
      look: "Muévelo rápido a un lado: cambiar de objetivo",
      potionSlots: "Mantén y pulsa △ □ ○ ✕",
      shield: "Justo antes del impacto: Parry",
      spellSlots: "Mantén y pulsa △ □ ○ ✕",
    },
    heading: "Controles",
    /** Over each trigger's slot diamond. */
    hold: (trigger: string) => `Mantén ${trigger}`,
    /** The cards on Mecánicas, one or two sentences each. */
    mechanics: [
      {
        body: "Fija la cámara y la puntería en tu rival. Se suelta si cae o si pasa demasiado tiempo oculto tras una cobertura.",
        title: "Fijar objetivo",
      },
      {
        body: "Mantén el Hechizo pesado para cargarlo. Suéltalo justo cuando la carga se llena y saldrá más potente.",
        title: "Carga y Lanzamiento perfecto",
      },
      {
        body: "Si sigues manteniendo la carga llena, se sobrecarga: el hechizo te estalla en la mano y te deja aturdido.",
        title: "Sobrecarga y Fallo",
      },
      {
        body: "El Escudo para los hechizos que llegan de frente y gasta resistencia. Levántalo justo antes del impacto y devolverás el hechizo a quien lo lanzó.",
        title: "Escudo y Parry",
      },
      {
        body: "Esquiva justo antes de que un hechizo te alcance: no te toca y ganas Concentración.",
        title: "Esquiva perfecta",
      },
      {
        body: "Dos Hechizos pesados cargados del todo que chocan de frente se traban en un rayo. Pulsa △ más rápido que tu rival para empujárselo encima.",
        title: "Clash",
      },
      {
        body: "Tres segmentos que llenas acertando Hechizos ligeros, con Parrys, Esquivas perfectas y Clashes ganados. Pagan los Hechizos especiales y empiezan vacíos cada ronda.",
        title: "Concentración",
      },
      {
        body: "La explosión de Incendio deja ardiendo a quien alcanza, que sigue perdiendo salud unos segundos.",
        title: "Quemadura",
      },
      {
        body: "Petrificus Totalus deja a quien alcanza congelado en el sitio un momento, sin poder moverse ni actuar.",
        title: "Petrificado",
      },
      {
        body: "Expelliarmus hace saltar la varita: sin ella no puedes lanzar hechizos ni usar el Escudo. Pasa por encima para recogerla, o vuelve sola en unos segundos.",
        title: "Desarme y varita",
      },
      {
        body: "Mientras bebes eres vulnerable, y un golpe te hace perder la poción. Sus dosis se recargan cada ronda.",
        title: "Pociones",
      },
    ],
    tabs: { controls: "Controles", mechanics: "Mecánicas" },
    /** The buttons printed on the drawn DualSense, by their own names. */
    triggers: { l1: "L1", l2: "L2", r1: "R1", r2: "R2", r3: "R3" },
  },
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
  pause: {
    /** In a Practice: back to the rival picker. */
    changeRival: "Cambiar rival",
    continue: "Continuar",
    controls: "Controles",
    heading: "Pausa",
    quit: "Salir",
    /** In a Practice, Salir names where it goes. */
    quitToMenu: "Salir al menú",
    /** In a Training lesson: out to the main menu. */
    quitTraining: "Salir del entrenamiento",
    restart: "Reiniciar",
    /** In a Training lesson: on to the next one, this one left undone. */
    skipLesson: "Saltar lección",
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
  /** Entrenamiento: its lessons, and each goal as it shows top-centre in the lesson. */
  training: {
    /** A goal's count against what it asks for, after the goal. */
    counter: (count: number, target: number, unit = "") =>
      `(${String(count)}/${String(target)}${unit})`,
    /** Ticks a completed lesson, and Entrenamiento once all are played through. */
    done: "✓",
    /** Under Entrenamiento on the main menu until Training has been played through. */
    firstTime: "¿Primera vez? Empieza aquí",
    /** Each goal, with its button: face buttons are drawn as their icons. */
    goals: {
      block: "Bloquea hechizos manteniendo L1",
      clash: "Gana un Clash: suelta △ con la carga llena y pulsa △ sin parar",
      confringo: "Mantén △ para cargar Confringo y acierta al maniquí",
      disarmed: "Deja que el maniquí te desarme",
      dodge: "Esquiva rodando con ○",
      lockOff: "Suelta la fijación con R3",
      lockOn: "Fija al maniquí con R3",
      look: "Mira alrededor con el stick derecho",
      parry: "Haz un Parry: pulsa L1 justo antes de que te alcance",
      perfectDodge: "Esquiva perfecta: ○ justo antes de que te alcance",
      perfectRelease:
        "Liberación perfecta: suelta △ justo cuando la carga se llena",
      pickup: "Recoge tu varita caminando sobre ella",
      potion: "Bebe pociones: mantén L2 y pulsa un botón",
      run: "Corre manteniendo R1",
      special: "Lanza hechizos especiales: mantén R2 y pulsa un botón",
      stupefy: "Acierta Stupefy con □",
      walk: "Camina con el stick izquierdo",
    },
    heading: "Entrenamiento",
    /** Above the goal: which lesson of how many. */
    lessonCount: (number: number, total: number) =>
      `Lección ${String(number)} de ${String(total)}`,
    /** Over the goal once the lesson is completed. */
    lessonDone: "¡Lección completada!",
    lessons: {
      clash: "Clash",
      disarmed: "Desarmado",
      dodge: "Esquiva",
      heavy: "Hechizo pesado",
      light: "Hechizo ligero",
      lockOn: "Fijar objetivo",
      move: "Moverse y mirar",
      potions: "Pociones",
      shield: "Escudo y Parry",
      specials: "Hechizos especiales",
    },
    /** Over the lesson list. */
    pick: "Elige una lección",
    /** Once the last lesson is completed, before the main menu. */
    trainingDone: "¡Entrenamiento completado!",
    /** The units of the goals counted in metres or degrees. */
    units: { look: "°", run: " m", walk: " m" },
  },
  unsupportedBrowser: {
    body: "Spellbound necesita WebGPU. Ábrelo en una versión reciente de Chrome.",
    heading: "Navegador no compatible",
  },
} as const;
