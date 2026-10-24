/** Every player-facing string in Spellbound, in Spanish, so translation stays in one place. */
export const text = {
  /** On the connect prompt and the Difficulty select, naming what the first click still turns on: the sound, the DualSense's WebHID effects, or both. */
  activationHint: {
    both: "Haz clic en la página para activar el sonido y los efectos del DualSense",
    effects: "Haz clic en la página para activar los efectos del DualSense",
    sound: "Haz clic en la página para activar el sonido",
  },
  /** The face buttons' and D-pad arrows' names, for screen readers, where their icons stand in the text. */
  buttons: {
    circle: "círculo",
    cross: "equis",
    down: "flecha abajo",
    left: "flecha izquierda",
    right: "flecha derecha",
    square: "cuadrado",
    triangle: "triángulo",
    up: "flecha arriba",
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
      potionSlots: "Mantén y pulsa ↑ ← → ↓",
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
        body: "Esquiva justo antes de que un hechizo te alcance: no te toca y ganas Determinación.",
        title: "Esquiva perfecta",
      },
      {
        body: "Dos Hechizos pesados cargados del todo que chocan de frente se traban en un rayo. Pulsa △ más rápido que tu rival para empujárselo encima.",
        title: "Clash",
      },
      {
        body: "Tres segmentos que llenas acertando Hechizos ligeros, con Parrys, Esquivas perfectas y Clashes ganados. Pagan los Hechizos especiales y empiezan vacíos cada ronda.",
        title: "Determinación",
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
        body: "Mantén L2 y pulsa una flecha de la cruceta para beber. Mientras bebes eres vulnerable, y un golpe te hace perder la poción. Sus dosis se recargan cada ronda.",
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
  },
  /**
   * Punched onto the screen under the reticle, like a Spell's name, when the
   * local Duelist's Potion is down, or lost to a hit.
   */
  potionCallouts: {
    felix: "¡Felix Felicis!",
    interrupted: "¡Poción perdida!",
    strength: "¡Poción Máxima!",
    swiftness: "¡Poción Vigorizante!",
    wiggenweld: "¡Wiggenweld!",
  },
  /** The Potions, as the Potion Slots and the active effects in the HUD name them. */
  potions: {
    felix: "Felix Felicis",
    /** Accessible label of the Potion Slots, bottom-left. */
    label: "Pociones",
    /** The Strength Potion. */
    strength: "Poción Máxima",
    /** The Swiftness Potion. */
    swiftness: "Poción Vigorizante",
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
    /** Accessible label of the Focus orbs: Focus is shown as Determinación. */
    focus: "Determinación",
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
  /**
   * Entrenamiento: its lessons, each goal as it shows top-centre in the
   * lesson, and the parchment scrolls before and after each lesson. Face
   * buttons and D-pad arrows are drawn as their icons; `{kind}` stands for
   * the button of the slot that Special Spell or Potion is bound to.
   */
  training: {
    /** The Club de Duelo's welcome, once every lesson is completed. */
    certificate: {
      continue: "Continuar",
      heading: "Club de Duelo",
      lines: [
        "Has completado el entrenamiento: dominas cada hechizo, cada defensa y cada poción.",
        "Bienvenido al Club de Duelo. El Duelo y la Práctica ya te esperan.",
      ],
    },
    /** A goal's count against what it asks for, after the goal. */
    counter: (count: number, target: number, unit = "") =>
      `(${String(count)}/${String(target)}${unit})`,
    /** Ticks a completed lesson, and Entrenamiento once all are completed. */
    done: "✓",
    /** Each goal, with its button. */
    goals: {
      block: "Bloquea hechizos manteniendo L1",
      clash: "Gana un Clash: suelta △ con la carga llena y pulsa △ sin parar",
      confringo: "Mantén △ para cargar Confringo y acierta al maniquí",
      depulso:
        "Acércate al maniquí y lanza Depulso: mantén R2 y pulsa {depulso}",
      disarmed: "Deja que el maniquí te desarme",
      dodge: "Esquiva rodando con ○",
      expelliarmus:
        "Desarma al maniquí con Expelliarmus: mantén R2 y pulsa {expelliarmus}",
      felix: "Bebe Felix Felicis: mantén L2 y pulsa {felix}",
      focusSegment:
        "Gana un segmento de Determinación: acierta con □, haz Parry o Esquiva perfecta",
      incendio: "Haz arder al maniquí: mantén R2 y pulsa {incendio}",
      lockOff: "Suelta la fijación con R3",
      lockOn: "Fija al maniquí con R3",
      look: "Mira alrededor con el stick derecho",
      parry: "Haz un Parry: pulsa L1 justo antes de que te alcance",
      perfectDodge: "Esquiva perfecta: ○ justo antes de que te alcance",
      perfectRelease:
        "Liberación perfecta: suelta △ justo cuando la carga se llena",
      petrificus: "Petrifica al maniquí: mantén R2 y pulsa {petrificus}",
      pickup: "Recoge tu varita caminando sobre ella",
      run: "Corre manteniendo R1",
      special:
        "Gasta esa Determinación en Depulso: mantén R2 y pulsa {depulso} cerca del maniquí",
      strength: "Bebe la Poción Máxima: mantén L2 y pulsa {strength}",
      strongHit: "Acierta al maniquí mientras dura su efecto",
      stupefy: "Acierta Stupefy con □",
      swiftRun: "Corre mientras dura su efecto",
      swiftness: "Bebe la Poción Vigorizante: mantén L2 y pulsa {swiftness}",
      walk: "Camina con el stick izquierdo",
      wiggenweld: "Bebe Wiggenweld: mantén L2 y pulsa {wiggenweld}",
    },
    heading: "Entrenamiento",
    /** Above a scroll's title: which lesson of how many. */
    lessonCount: (number: number, total: number) =>
      `Lección ${String(number)} de ${String(total)}`,
    /** Over the goal once the lesson is completed, and over its success scroll. */
    lessonDone: "¡Lección completada!",
    lessons: {
      clash: "Ganar un Clash",
      depulso: "Depulso",
      disarmed: "Desarme y recoger la varita",
      dodge: "Esquiva",
      expelliarmus: "Expelliarmus",
      felix: "Felix Felicis",
      focus: "La Determinación",
      heavy: "Confringo con carga",
      incendio: "Incendio",
      light: "Stupefy",
      lockOn: "Fijar objetivo",
      move: "Moverse y mirar",
      petrificus: "Petrificus Totalus",
      shield: "Escudo y Parry",
      strength: "Poción Máxima",
      swiftness: "Poción Vigorizante",
      wiggenweld: "Wiggenweld",
    },
    /** Under Entrenamiento on the main menu while Duelo and Práctica are closed. */
    locked: "Completa el entrenamiento para desbloquear Duelo y Práctica",
    /** Over the lesson list. */
    pick: "Elige una lección",
    /** The success scroll's choices, and the scroll before a lesson's. */
    scrollOptions: {
      finish: "Terminar",
      next: "Siguiente lección",
      repeat: "Repetir",
      start: "Empezar",
    },
    /**
     * Each lesson's scroll, before it starts: what it teaches, when to use
     * it, and the buttons involved.
     */
    scrolls: {
      clash: {
        controls: "Suelta △ con la carga llena · Pulsa △ sin parar",
        what: "Si dos Confringos cargados del todo chocan de frente, se traban en un rayo entre las dos varitas.",
        when: "Pulsa △ sin parar, más rápido que tu rival, para empujarle el rayo encima. Ganarlo llena tu Determinación.",
      },
      depulso: {
        controls: "Mantén R2 y pulsa {depulso}",
        what: "Depulso lanza un cono corto de fuerza que empuja al rival y le corta la carga o la poción. Cuesta un segmento de Determinación.",
        when: "Úsalo cuando el rival se te echa encima: te lo quitas de en medio. De lejos no llega.",
      },
      disarmed: {
        controls: "Stick izquierdo: ve a por tu varita",
        what: "Si un Expelliarmus te alcanza, tu varita sale volando: sin ella no puedes lanzar hechizos ni usar el Escudo.",
        when: "Corre a recogerla pasando por encima en cuanto caiga; si no, vuelve sola en unos segundos.",
      },
      dodge: {
        controls: "○ (con el stick izquierdo para elegir hacia dónde)",
        what: "○ te hace rodar; mientras ruedas, ningún hechizo te toca. Gasta resistencia.",
        when: "Esquiva justo antes de que un hechizo te alcance: es una Esquiva perfecta y suma Determinación.",
      },
      expelliarmus: {
        controls: "Mantén R2 y pulsa {expelliarmus}",
        what: "Expelliarmus no hace daño: le arranca la varita al rival, que no puede atacar ni cubrirse hasta recogerla. Cuesta toda tu Determinación.",
        when: "Lánzalo cuando el rival no pueda hacer Parry, porque un Expelliarmus devuelto te desarma a ti.",
      },
      felix: {
        controls: "Mantén L2 y pulsa {felix}, luego R2 y {depulso}",
        what: "Felix Felicis, la suerte líquida, te da al instante un segmento de Determinación.",
        when: "Bébela cuando te falte poco para un hechizo especial y el rival esté lejos: mientras bebes eres vulnerable.",
      },
      focus: {
        controls:
          "□: acierta · L1 a tiempo: Parry · ○ a tiempo: Esquiva perfecta",
        what: "La Determinación son los tres segmentos junto a tus hechizos especiales: la magia poderosa exige determinación. Se gana acertando Stupefy, con Parrys y con Esquivas perfectas.",
        when: "Gástala en los hechizos especiales. Empieza vacía cada ronda y nunca se pierde.",
      },
      heavy: {
        controls: "Mantén △ para cargar · Suelta △ para lanzar",
        what: "Mantén △ para cargar Confringo y suéltalo para lanzarlo. Soltarlo justo cuando la carga se llena es una Liberación perfecta: sale más potente.",
        when: "Cárgalo cuando el rival no pueda castigarte. Si mantienes la carga llena demasiado, te estalla en la mano.",
      },
      incendio: {
        controls: "Mantén R2 y pulsa {incendio}",
        what: "Incendio explota al impactar y deja ardiendo a quien alcanza, que sigue perdiendo salud unos segundos.",
        when: "Úsalo contra un rival que se esconde tras el Escudo o una columna: la explosión lo alcanza igual.",
      },
      light: {
        controls: "□: Stupefy",
        what: "□ lanza Stupefy, un hechizo rápido que puedes repetir sin parar. El tercero seguido es más fuerte y aturde.",
        when: "Úsalo para presionar al rival y para llenar tu Determinación: cada acierto suma.",
      },
      lockOn: {
        controls:
          "R3: fijar y soltar · Stick derecho rápido a un lado: cambiar de objetivo",
        what: "R3 fija la cámara y la puntería en el rival, y tus hechizos lo siguen un poco.",
        when: "Fíjalo para no perderlo de vista en pleno duelo; suéltalo con R3 para apuntar a mano.",
      },
      move: {
        controls:
          "Stick izquierdo: moverse · Stick derecho: cámara · R1: correr",
        what: "Camina con el stick izquierdo y gira la cámara con el derecho. Mantén R1 para correr, que gasta resistencia.",
        when: "Muévete siempre: un duelista quieto es un blanco fácil.",
      },
      petrificus: {
        controls: "Mantén R2 y pulsa {petrificus}",
        what: "Petrificus Totalus deja al rival congelado en el sitio un momento, sin poder moverse ni actuar.",
        when: "Lánzalo para abrir una ventana: petrificado, no puede esquivar ni cubrirse de tu Confringo cargado.",
      },
      shield: {
        controls: "Mantén L1: escudo · L1 justo a tiempo: Parry",
        what: "Mantén L1 para levantar Protego: para los hechizos que llegan de frente y gasta resistencia.",
        when: "Levántalo justo antes del impacto y harás un Parry: devuelves el hechizo a quien lo lanzó.",
      },
      strength: {
        controls: "Mantén L2 y pulsa {strength}",
        what: "La Poción Máxima hace más daño a todos tus hechizos durante unos segundos.",
        when: "Bébela justo antes de atacar fuerte: con Determinación para un especial o con el rival desarmado.",
      },
      swiftness: {
        controls: "Mantén L2 y pulsa {swiftness}",
        what: "La Poción Vigorizante te hace más rápido y te da resistencia sin límite durante unos segundos.",
        when: "Bébela para llegar antes a tu varita, para escapar con poca salud o para esquivar y cubrirte sin cansarte.",
      },
      wiggenweld: {
        controls: "Mantén L2 y pulsa {wiggenweld}",
        what: "Wiggenweld te devuelve parte de la salud al instante.",
        when: "Bébela con poca salud y lejos del rival: mientras bebes eres vulnerable y un golpe te la hace perder.",
      },
    },
    /** The units of the goals counted in metres or degrees. */
    units: { look: "°", run: " m", swiftRun: " m", walk: " m" },
  },
  unsupportedBrowser: {
    body: "Spellbound necesita WebGPU. Ábrelo en una versión reciente de Chrome.",
    heading: "Navegador no compatible",
  },
} as const;
