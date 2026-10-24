/**
 * The English dictionary, in the same order and shape as the Spanish one in
 * `text.ts` (whose comments say where each string shows). Spell names stay
 * in Latin; the Potions take their canonical English names, and Focus is
 * shown as Determination.
 */
import type { Dictionary } from "./text";

export const en: Dictionary = {
  activationHint: {
    both: "Click the page to turn on sound and DualSense effects",
    effects: "Click the page to turn on DualSense effects",
    sound: "Click the page to turn on sound",
  },
  buttons: {
    circle: "circle",
    cross: "cross",
    down: "down arrow",
    left: "left arrow",
    right: "right arrow",
    square: "square",
    triangle: "triangle",
    up: "up arrow",
  },
  clash: {
    callout: "Clash!",
    pump: "Mash △!",
    trigger: "△",
  },
  connectDualSense: "Connect your DualSense and press ✕",
  controls: {
    actions: {
      dodge: "Dodge",
      heavySpell: "Heavy spell",
      jump: "Jump",
      lightSpell: "Light spell",
      lockOn: "Lock on",
      look: "Camera",
      move: "Move",
      pause: "Pause",
      potionSlots: "Potions",
      shield: "Shield",
      spellSlots: "Special spells",
      sprint: "Run",
    },
    details: {
      heavySpell: "Hold to charge · Mash in a Clash",
      look: "Flick it sideways: switch target",
      potionSlots: "Hold and press ↑ ← → ↓",
      shield: "Just before impact: Parry",
      spellSlots: "Hold and press △ □ ○ ✕",
    },
    heading: "Controls",
    hold: (trigger: string) => `Hold ${trigger}`,
    mechanics: [
      {
        body: "Holds the camera and your aim on your rival. It lets go if they fall, or stay hidden behind cover for too long.",
        title: "Lock on",
      },
      {
        body: "Hold the heavy spell to charge it. Let go right as the charge fills and it flies out stronger.",
        title: "Charge and Perfect Release",
      },
      {
        body: "Keep holding a full charge and it overloads: the spell blows up in your hand and leaves you staggered.",
        title: "Overcharge and Backfire",
      },
      {
        body: "The Shield stops spells coming from the front and drains stamina. Raise it just before impact to send the spell back at its caster.",
        title: "Shield and Parry",
      },
      {
        body: "Dodge just before a spell hits you: it misses, and you gain Determination.",
        title: "Perfect Dodge",
      },
      {
        body: "Two fully charged heavy spells meeting head-on lock into a beam. Mash △ faster than your rival to push it into them.",
        title: "Clash",
      },
      {
        body: "Three segments you fill by landing light spells, Parrying, Perfect Dodging and winning Clashes. They pay for special spells and start empty every round.",
        title: "Determination",
      },
      {
        body: "Incendio's blast sets whoever it catches on fire, and they keep losing health for a few seconds.",
        title: "Burn",
      },
      {
        body: "Petrificus Totalus freezes whoever it hits on the spot for a moment, unable to move or act.",
        title: "Petrified",
      },
      {
        body: "Expelliarmus knocks the wand away: without it you can't cast or Shield. Walk over it to pick it up, or it flies back on its own in a few seconds.",
        title: "Disarm and wand",
      },
      {
        body: "Hold L2 and press a D-pad arrow to drink. You're vulnerable while drinking, and a hit spills the potion. Doses refill every round.",
        title: "Potions",
      },
    ],
    tabs: { controls: "Controls", mechanics: "Mechanics" },
    triggers: { l1: "L1", l2: "L2", r1: "R1", r2: "R2", r3: "R3" },
  },
  difficulty: {
    duelista: "Duellist",
    heading: "Choose your difficulty",
    maestro: "Master",
    novato: "Novice",
  },
  disconnected: {
    heading: "Reconnect your controller",
    reconnected: "Press any button to continue",
    waiting: "Connect your DualSense to continue",
  },
  hud: {
    defeat: "Defeat",
    disarmed: "Disarmed!",
    disarmedHint: "Grab your wand",
    draw: "Draw",
    duel: "Duel!",
    knockout: "K.O.",
    parry: "Parry!",
    round: (number: number) => `Round ${String(number)}`,
    roundLost: "Round to your rival",
    roundWon: "Round to you",
    victory: "Victory!",
  },
  legal:
    "Spellbound is a free, non-profit fan game, not affiliated with, endorsed or sponsored by Warner Bros. Entertainment Inc., J.K. Rowling or Wizarding World. The names of spells and potions from the Harry Potter universe are trademarks and property of their respective owners, used here as a tribute.",
  loading: "Loading",
  mainMenu: {
    controls: "Controls",
    duel: "Duel",
    options: "Options",
    practice: "Practice",
    training: "Training",
  },
  options: {
    effects: "Effects",
    heading: "Options",
    language: "Language",
    languages: { en: "English", es: "Español" },
    music: "Music",
    volume: (percent: number) => `${String(percent)}%`,
  },
  pause: {
    changeRival: "Change rival",
    continue: "Continue",
    controls: "Controls",
    heading: "Paused",
    quit: "Quit",
    quitToMenu: "Quit to menu",
    quitTraining: "Quit training",
    restart: "Restart",
  },
  potionCallouts: {
    felix: "Felix Felicis!",
    interrupted: "Potion spilled!",
    strength: "Maxima Potion!",
    swiftness: "Invigoration Draught!",
    wiggenweld: "Wiggenweld!",
  },
  potions: {
    felix: "Felix Felicis",
    label: "Potions",
    strength: "Maxima Potion",
    swiftness: "Invigoration Draught",
    wiggenweld: "Wiggenweld Potion",
  },
  practice: {
    ai: "Real opponent",
    casts: "Casting dummy",
    clash: "Clash dummy",
    disarms: "Disarming dummy",
    heading: "Practice",
    idle: "Standing dummy",
    rivals: "Choose your rival",
  },
  requiresDualSense: "Spellbound needs a DualSense controller",
  result: {
    changeDifficulty: "Change difficulty",
    rematch: "Rematch",
  },
  specials: {
    depulso: "Depulso",
    expelliarmus: "Expelliarmus",
    focus: "Determination",
    incendio: "Incendio",
    petrificus: "Petrificus Totalus",
  },
  spellCallouts: {
    confringo: "Confringo!",
    depulso: "Depulso!",
    expelliarmus: "Expelliarmus!",
    incendio: "Incendio!",
    petrificus: "Petrificus Totalus!",
  },
  start: "Click to begin",
  title: "Spellbound",
  training: {
    certificate: {
      continue: "Continue",
      heading: "Duelling Club",
      lines: [
        "Your training is complete: every spell, every defence and every potion is yours to command.",
        "Welcome to the Duelling Club. Duel and Practice await.",
      ],
    },
    completed: "Completed",
    counter: (count: number, target: number, unit = "") =>
      `(${String(count)}/${String(target)}${unit})`,
    done: "✓",
    goals: {
      block: "Block spells by holding L1",
      clash: "Win a Clash: release △ at full charge, then mash △",
      confringo: "Hold △ to charge Confringo and hit the dummy",
      depulso:
        "Get close to the dummy and cast Depulso: hold R2 and press {depulso}",
      disarmed: "Let the dummy disarm you",
      dodge: "Dodge roll with ○",
      expelliarmus:
        "Disarm the dummy with Expelliarmus: hold R2 and press {expelliarmus}",
      felix: "Drink Felix Felicis: hold L2 and press {felix}",
      focusSegment:
        "Earn a Determination segment: land □, Parry or Perfect Dodge",
      incendio: "Set the dummy ablaze: hold R2 and press {incendio}",
      lockOff: "Release the lock with R3",
      lockOn: "Lock on to the dummy with R3",
      look: "Look around with the right stick",
      parry: "Parry: press L1 just before the spell hits",
      perfectDodge: "Perfect Dodge: ○ just before the spell hits",
      perfectRelease: "Perfect Release: let go of △ right as the charge fills",
      petrificus: "Petrify the dummy: hold R2 and press {petrificus}",
      pickup: "Walk over your wand to pick it up",
      run: "Run by holding R1",
      special:
        "Spend that Determination on Depulso: hold R2 and press {depulso} near the dummy",
      strength: "Drink the Maxima Potion: hold L2 and press {strength}",
      strongHit: "Hit the dummy while it lasts",
      stupefy: "Land Stupefy with □",
      swiftRun: "Run while it lasts",
      swiftness:
        "Drink the Invigoration Draught: hold L2 and press {swiftness}",
      walk: "Walk with the left stick",
      wiggenweld: "Drink the Wiggenweld Potion: hold L2 and press {wiggenweld}",
    },
    heading: "Training",
    lessonCount: (number: number, total: number) =>
      `Lesson ${String(number)} of ${String(total)}`,
    lessonDone: "Lesson complete!",
    lessons: {
      clash: "Win a Clash",
      depulso: "Depulso",
      disarmed: "Disarmed: get your wand back",
      dodge: "Dodge",
      expelliarmus: "Expelliarmus",
      felix: "Felix Felicis",
      focus: "Determination",
      heavy: "Charged Confringo",
      incendio: "Incendio",
      light: "Stupefy",
      lockOn: "Lock on",
      move: "Move and look",
      petrificus: "Petrificus Totalus",
      shield: "Shield and Parry",
      strength: "Maxima Potion",
      swiftness: "Invigoration Draught",
      wiggenweld: "Wiggenweld Potion",
    },
    locked: "Complete Training to unlock Duel and Practice",
    previews: {
      clash:
        "Two charged Confringos meeting head-on lock into a beam: mash △ faster than your rival to push it home.",
      depulso:
        "A short cone of force that shoves your rival back and cuts off their charge or potion.",
      disarmed:
        "No wand, no spells, no Shield: run and grab it the moment it lands.",
      dodge:
        "Roll and no spell can touch you; just before impact, it's a Perfect Dodge.",
      expelliarmus:
        "Rips the wand from your rival's hand: no spells and no Shield until they get it back.",
      felix:
        "Liquid luck: one Determination segment, instantly, for your special.",
      focus:
        "Hits, Parries and Perfect Dodges fill the three segments your specials spend.",
      heavy:
        "Charge Confringo and let it fly: let go right as it fills for a Perfect Release.",
      incendio:
        "Explodes on impact and sets your rival ablaze, Shield or no Shield.",
      light: "A quick spell you can chain: every third in a row staggers.",
      lockOn:
        "Lock the camera and your aim on your rival and never lose sight of them.",
      move: "Walk, turn the camera and run: a duellist standing still is an easy target.",
      petrificus:
        "Freezes your rival on the spot for a moment: no moving, no defending.",
      shield:
        "Protego stops spells from the front; raise it just in time to Parry.",
      strength: "For a few seconds, every spell you cast hits harder.",
      swiftness: "More speed and unlimited stamina for a few seconds.",
      wiggenweld: "Restores part of your health in an instant.",
    },
    progress: (done: number, total: number) =>
      `${String(done)} of ${String(total)} complete`,
    scrollOptions: {
      finish: "Finish",
      next: "Next lesson",
      repeat: "Repeat",
      start: "Begin",
    },
    scrolls: {
      clash: {
        controls: "Release △ at full charge · Mash △",
        what: "When two fully charged Confringos meet head-on, they lock into a beam between the two wands.",
        when: "Mash △, faster than your rival, to drive the beam into them. Winning it fills your Determination.",
      },
      depulso: {
        controls: "Hold R2 and press {depulso}",
        what: "Depulso blasts a short cone of force that shoves your rival back and cuts off their charge or potion. It costs one Determination segment.",
        when: "Use it when your rival closes in: it gets them off you. It won't reach from afar.",
      },
      disarmed: {
        controls: "Left stick: go get your wand",
        what: "When an Expelliarmus hits you, your wand goes flying: without it you can't cast or Shield.",
        when: "Run over it to grab it as soon as it lands; otherwise it flies back on its own in a few seconds.",
      },
      dodge: {
        controls: "○ (steer it with the left stick)",
        what: "○ makes you roll, and while you roll no spell can touch you. It costs stamina.",
        when: "Dodge just before a spell hits you: that's a Perfect Dodge, and it earns Determination.",
      },
      expelliarmus: {
        controls: "Hold R2 and press {expelliarmus}",
        what: "Expelliarmus deals no damage: it rips the wand from your rival, who can't cast or Shield until they pick it up. It costs all your Determination.",
        when: "Cast it when your rival can't Parry: a Parried Expelliarmus disarms you instead.",
      },
      felix: {
        controls: "Hold L2 and press {felix}, then R2 and {depulso}",
        what: "Felix Felicis, liquid luck, grants you one Determination segment on the spot.",
        when: "Drink it when you're one segment short of a special and your rival is far away: you're vulnerable while drinking.",
      },
      focus: {
        controls: "□: land hits · L1 in time: Parry · ○ in time: Perfect Dodge",
        what: "Determination is the three segments beside your special spells: powerful magic demands determination. You earn it by landing Stupefy, Parrying and Perfect Dodging.",
        when: "Spend it on special spells. It starts empty every round and is never lost.",
      },
      heavy: {
        controls: "Hold △ to charge · Release △ to cast",
        what: "Hold △ to charge Confringo and release it to cast. Letting go right as the charge fills is a Perfect Release: it flies out stronger.",
        when: "Charge it when your rival can't punish you. Hold a full charge too long and it blows up in your hand.",
      },
      incendio: {
        controls: "Hold R2 and press {incendio}",
        what: "Incendio explodes on impact and sets whoever it catches ablaze, losing health for a few seconds.",
        when: "Use it on a rival hiding behind their Shield or a pillar: the blast reaches them anyway.",
      },
      light: {
        controls: "□: Stupefy",
        what: "□ casts Stupefy, a quick spell you can fire again and again. Every third in a row hits harder and staggers.",
        when: "Use it to keep your rival under pressure and to fill your Determination: every hit counts.",
      },
      lockOn: {
        controls: "R3: lock on and off",
        what: "R3 locks the camera and your aim on your rival, and your spells curve after them a little.",
        when: "Lock on so you never lose sight of them mid-duel; press R3 again to aim by hand.",
      },
      move: {
        controls: "Left stick: move · Right stick: camera · R1: run",
        what: "Walk with the left stick and turn the camera with the right. Hold R1 to run, which costs stamina.",
        when: "Keep moving: a duellist standing still is an easy target.",
      },
      petrificus: {
        controls: "Hold R2 and press {petrificus}",
        what: "Petrificus Totalus freezes your rival on the spot for a moment, unable to move or act.",
        when: "Cast it to open a window: petrified, they can't dodge or Shield against your charged Confringo.",
      },
      shield: {
        controls: "Hold L1: Shield · L1 just in time: Parry",
        what: "Hold L1 to raise Protego: it stops spells coming from the front and drains stamina.",
        when: "Raise it just before impact to Parry: the spell flies back at whoever cast it.",
      },
      strength: {
        controls: "Hold L2 and press {strength}",
        what: "The Maxima Potion makes every spell you cast hit harder for a few seconds.",
        when: "Drink it right before you go all in: with Determination for a special, or with your rival disarmed.",
      },
      swiftness: {
        controls: "Hold L2 and press {swiftness}",
        what: "The Invigoration Draught makes you faster and gives you unlimited stamina for a few seconds.",
        when: "Drink it to reach your wand sooner, to escape on low health, or to dodge and Shield without tiring.",
      },
      wiggenweld: {
        controls: "Hold L2 and press {wiggenweld}",
        what: "The Wiggenweld Potion restores part of your health in an instant.",
        when: "Drink it on low health and away from your rival: you're vulnerable while drinking, and a hit spills it.",
      },
    },
    sections: {
      combat: "Combat",
      defence: "Defence",
      movement: "Movement",
      potions: "Potions",
      specials: "Determination and specials",
      spells: "Spells",
    },
    units: { look: "°", run: " m", swiftRun: " m", walk: " m" },
  },
  unsupported: {
    browser: {
      body: "Spellbound needs WebGPU: play it on a computer with an up-to-date Chrome or Edge and a DualSense controller.",
      heading: "Browser not supported",
    },
    device: {
      body: "Spellbound is played on a computer, in Chrome or Edge, with a DualSense controller.",
      heading: "Play on your computer",
    },
    needs: ["Computer", "Chrome or Edge", "DualSense controller"],
  },
};
