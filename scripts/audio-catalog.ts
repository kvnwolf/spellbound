/**
 * Every sound and piece of music Spellbound uses, as prompts for the
 * ElevenLabs generators (`scripts/generate-audio.ts`). Each entry becomes
 * `public/audio/<id>.mp3`; `label` is what the listening catalog shows.
 */

export type AudioKind = "music" | "sfx";

export interface AudioEntry {
  readonly id: string;
  readonly group: string;
  /** Spanish name for the listening catalog. */
  readonly label: string;
  readonly kind: AudioKind;
  readonly prompt: string;
  readonly seconds: number;
  /** Seamless loop (sound effects only; music loops are cut in the engine). */
  readonly loop?: boolean;
}

/** Shared style so every sound belongs to the same game. */
const style =
  "dark fantasy wizard duel game sound effect, cinematic, high quality, realistic, not cartoony, no music, no voice";

const sfx = (
  id: string,
  group: string,
  label: string,
  prompt: string,
  seconds: number,
  loop = false
): AudioEntry => ({
  group,
  id,
  kind: "sfx",
  label,
  loop,
  prompt: `${prompt}. ${style}`,
  // The Sound Effects API takes 0.5–30 s; shorter sounds are trimmed in play.
  seconds: Math.max(seconds, 0.5),
});

const music = (
  id: string,
  group: string,
  label: string,
  prompt: string,
  seconds: number
): AudioEntry => ({ group, id, kind: "music", label, prompt, seconds });

export const audioCatalog: readonly AudioEntry[] = [
  // Spells
  sfx(
    "stupefy-cast",
    "Hechizos",
    "Stupefy: lanzar",
    "A quick crackling red magic bolt fired from a wand, sharp electric zap with a short whoosh",
    0.8
  ),
  sfx(
    "stupefy-hit",
    "Hechizos",
    "Stupefy: impacto",
    "A red stunning spell bolt striking a person, a crisp magical crack with a dull body thud",
    0.8
  ),
  sfx(
    "stupefy-hit-strong",
    "Hechizos",
    "Stupefy: impacto fuerte",
    "A powerful stunning spell slamming into a person, heavy magical crack, deep sub bass punch, crackling sparks",
    1.2
  ),
  sfx(
    "confringo-charge",
    "Hechizos",
    "Confringo: carga (loop)",
    "A wand gathering fire magic, steady rising roaring flame energy with crackling embers and a low hum",
    3,
    true
  ),
  sfx(
    "confringo-ready",
    "Hechizos",
    "Confringo: aviso de banda dorada",
    "A bright short magical chime, a golden shimmer ping signalling perfect timing",
    0.6
  ),
  sfx(
    "confringo-perfect",
    "Hechizos",
    "Confringo: Perfect Release",
    "A satisfying powerful magical release, golden flare burst with a bright resonant sting",
    1.2
  ),
  sfx(
    "overcharge-warning",
    "Hechizos",
    "Confringo: aviso de Overcharge",
    "Unstable magic about to blow, a tense fizzing crackle rising fast with a warning pulse",
    0.6
  ),
  sfx(
    "backfire",
    "Hechizos",
    "Confringo: Backfire",
    "A spell backfiring in the caster's hand, a violent sputtering fiery crack and pop with sizzling sparks",
    1.2
  ),
  sfx(
    "confringo-cast",
    "Hechizos",
    "Confringo: lanzar",
    "A fireball spell launched from a wand, a deep roaring whoosh of flame",
    1.2
  ),
  sfx(
    "confringo-blast",
    "Hechizos",
    "Confringo: explosión",
    "A fireball exploding on impact, a punchy fiery blast with a deep boom and crackling debris",
    2
  ),
  sfx(
    "incendio-cast",
    "Hechizos",
    "Incendio: lanzar",
    "A large fire spell cast, a surging roar of flames bursting from a wand",
    1.2
  ),
  sfx(
    "incendio-explosion",
    "Hechizos",
    "Incendio: explosión",
    "A big fire explosion spreading across stone ground, a massive whoomp, rolling flames and a long crackling tail",
    2.8
  ),
  sfx(
    "burn-loop",
    "Hechizos",
    "Incendio: quemadura (loop)",
    "Steady close-up fire crackle, burning cloth and sizzling embers, continuous flames only, no speech, no human sounds",
    3,
    true
  ),
  sfx(
    "petrificus-cast",
    "Hechizos",
    "Petrificus: lanzar",
    "An icy pale-blue paralysing spell bolt, a cold crystalline whoosh with a frosty shimmer",
    1
  ),
  sfx(
    "petrify",
    "Hechizos",
    "Petrificus: volverse piedra",
    "A body turning to stone, grinding crackling rock and a cold ringing tone",
    1.5
  ),
  sfx(
    "petrify-break",
    "Hechizos",
    "Petrificus: romper la piedra",
    "A thin stone shell cracking and crumbling away, small rocks and dust falling",
    1
  ),
  sfx(
    "expelliarmus-cast",
    "Hechizos",
    "Expelliarmus: lanzar",
    "A bright scarlet disarming spell, a sharp forceful magical whip crack",
    1
  ),
  sfx(
    "disarm",
    "Hechizos",
    "Expelliarmus: desarme",
    "A wooden wand knocked out of a hand and spinning through the air, a magical snap and a whirring whoosh",
    1.2
  ),
  sfx(
    "wand-land",
    "Hechizos",
    "Varita cae al suelo",
    "A wooden wand clattering onto a stone floor",
    0.6
  ),
  sfx(
    "wand-pickup",
    "Hechizos",
    "Recoger la varita",
    "Grabbing a wooden wand off the floor, a quick grab with a soft magical shimmer",
    0.6
  ),
  sfx(
    "wand-return",
    "Hechizos",
    "La varita regresa sola",
    "A wand flying back into its owner's hand by magic, a rising whoosh ending in a soft catch",
    1
  ),
  sfx(
    "depulso-blast",
    "Hechizos",
    "Depulso: onda de empuje",
    "A powerful short-range force push spell, a deep concussive gust of wind and air pressure wave",
    1.2
  ),
  sfx(
    "spells-cancel",
    "Hechizos",
    "Dos hechizos se anulan",
    "Two magic bolts colliding in mid air and cancelling out, a bright crackling pop with scattering sparks",
    0.8
  ),
  sfx(
    "spell-fizzle",
    "Hechizos",
    "Hechizo choca con pared",
    "A small magic bolt hitting a stone pillar and dissipating, a short fizzle and spark crackle",
    0.6
  ),
  // Defence and movement
  sfx(
    "shield-raise",
    "Defensa y movimiento",
    "Escudo: levantar",
    "A magical protective barrier snapping into existence, a bright glassy shimmer rising",
    0.7
  ),
  sfx(
    "shield-hum",
    "Defensa y movimiento",
    "Escudo: zumbido (loop)",
    "A steady magical energy shield humming, soft resonant glassy drone",
    3,
    true
  ),
  sfx(
    "shield-block",
    "Defensa y movimiento",
    "Escudo: bloqueo",
    "A spell hitting a magical shield and being blocked, a resonant glassy impact thud",
    0.8
  ),
  sfx(
    "parry",
    "Defensa y movimiento",
    "Parry",
    "A perfectly timed magical parry deflecting a spell, a bright ringing metallic shimmer and a reflected whoosh",
    1.2
  ),
  sfx(
    "dodge-roll",
    "Defensa y movimiento",
    "Rodar (esquiva)",
    "A quick combat roll on stone, cloth rustle and a fast whoosh",
    0.6
  ),
  sfx(
    "perfect-dodge",
    "Defensa y movimiento",
    "Perfect Dodge",
    "A last-instant evasion, a fast whoosh with a subtle magical time-slow shimmer",
    0.8
  ),
  sfx(
    "jump",
    "Defensa y movimiento",
    "Salto",
    "A light jump, robe fabric flutter and a short exhale of effort without voice",
    0.5
  ),
  sfx(
    "land",
    "Defensa y movimiento",
    "Aterrizaje",
    "Landing on stone after a jump, a soft boot thud with fabric settling",
    0.5
  ),
  sfx(
    "stamina-short",
    "Defensa y movimiento",
    "Sin Stamina",
    "A dull muted failed action, a soft low thump signalling exhaustion",
    0.5
  ),
  sfx(
    "lock-on",
    "Defensa y movimiento",
    "Fijar objetivo",
    "A subtle crisp magical targeting lock, a short golden click",
    0.4
  ),
  sfx(
    "lock-off",
    "Defensa y movimiento",
    "Soltar objetivo",
    "A subtle soft magical release, a short descending click",
    0.4
  ),
  // Potions
  sfx(
    "potion-drink",
    "Pociones",
    "Beber poción",
    "Uncorking a glass vial and drinking a magic potion, gulps and liquid swirl",
    1.2
  ),
  sfx(
    "potion-heal",
    "Pociones",
    "Efecto: Wiggenweld (curación)",
    "A warm healing magic aura, gentle rising shimmer and soft glow",
    1.2
  ),
  sfx(
    "potion-strength",
    "Pociones",
    "Efecto: Fuerza",
    "A surge of raw magical power, a deep empowering whoosh with a heavy pulse",
    1.2
  ),
  sfx(
    "potion-swiftness",
    "Pociones",
    "Efecto: Celeridad",
    "A burst of magical speed, a quick airy rising whoosh with sparkles",
    1.2
  ),
  sfx(
    "potion-interrupted",
    "Pociones",
    "Poción interrumpida",
    "A glass potion vial shattering on stone and liquid splashing",
    0.8
  ),
  // Clash
  sfx(
    "clash-start",
    "Clash",
    "Inicio del Clash",
    "Two powerful spell beams locking together in mid air, a huge crackling energy collision",
    1.5
  ),
  sfx(
    "clash-beam",
    "Clash",
    "Rayo del Clash (loop)",
    "Two magical energy beams locked in a struggle, intense roaring electric crackle and hum",
    3,
    true
  ),
  sfx(
    "clash-pump",
    "Clash",
    "Bombeo del Clash",
    "A sharp surge pushing a magical energy beam forward, a short powerful pulse",
    0.4
  ),
  sfx(
    "clash-win",
    "Clash",
    "Ganar el Clash",
    "A magical beam struggle breaking through, an overwhelming energy blast and impact",
    2
  ),
  sfx(
    "clash-explode",
    "Clash",
    "Clash: explosión por empate",
    "Two locked magic beams overloading and exploding, a massive blast throwing both sides back",
    2.5
  ),
  // Rounds and duel
  sfx(
    "countdown-beat",
    "Rondas y duelo",
    "Golpe de cuenta atrás",
    "A single deep cinematic drum hit with a magical resonance tail",
    0.8
  ),
  sfx(
    "duel-start",
    "Rondas y duelo",
    "¡Duelo!",
    "An epic cinematic magical impact starting a duel, a big boom with a bright shimmering swell",
    1.5
  ),
  sfx(
    "knockout",
    "Rondas y duelo",
    "Knockout",
    "A decisive final hit knocking a wizard down, a heavy slow-motion impact boom with a long reverb tail",
    2.2
  ),
  sfx(
    "round-won",
    "Rondas y duelo",
    "Ronda ganada",
    "A short triumphant magical stinger, rising bright shimmer and a resolving chord swell",
    2.5
  ),
  sfx(
    "round-lost",
    "Rondas y duelo",
    "Ronda perdida",
    "A short somber magical stinger, a falling dark swell",
    2.5
  ),
  music(
    "victory",
    "Rondas y duelo",
    "Victoria (fanfarria)",
    "Short triumphant orchestral victory fanfare for a dark fantasy wizard duel, brass and choir swell, heroic and magical, instrumental",
    8
  ),
  music(
    "defeat",
    "Rondas y duelo",
    "Derrota",
    "Short somber orchestral defeat cue for a dark fantasy wizard duel, low strings and a fading choir, melancholic, instrumental",
    8
  ),
  // Menus
  sfx(
    "menu-move",
    "Menús",
    "Mover en el menú",
    "A soft subtle magical UI tick, like a tiny chime on parchment",
    0.3
  ),
  sfx(
    "menu-confirm",
    "Menús",
    "Confirmar",
    "A satisfying magical UI confirm, a warm bright chime",
    0.5
  ),
  sfx(
    "menu-back",
    "Menús",
    "Volver",
    "A soft magical UI back sound, a gentle descending chime",
    0.5
  ),
  // Ambience
  sfx(
    "courtyard-night",
    "Ambiente",
    "Patio del castillo de noche (loop)",
    "A castle courtyard at night, soft wind, distant crickets and gently crackling torches",
    30,
    true
  ),
  // Music
  music(
    "menu-theme",
    "Música",
    "Tema del menú",
    "Mysterious calm orchestral dark fantasy theme for a wizard dueling game menu, soft strings, celesta, distant choir, magical and atmospheric, seamless loop feel, instrumental, no vocals",
    90
  ),
  music(
    "duel-theme",
    "Música",
    "Tema del duelo",
    "Tense epic orchestral battle music for a one versus one wizard duel in a castle courtyard at night, driving percussion, staccato strings, dark choir, magical and cinematic, steady intensity, seamless loop feel, instrumental, no vocals",
    120
  ),
];
