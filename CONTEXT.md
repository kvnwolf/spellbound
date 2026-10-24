# Spellbound

A browser wizard-dueling game: Duelists face off in an Arena, aiming, charging and casting Spells while dodging and shielding, played with a DualSense controller.

## Language

### Match structure

**Duel**:
The whole contest between Duelists in one Arena, decided over several Rounds.
_Avoid_: Game, fight, match

**Round**:
One segment of a Duel that ends when all Duelists but one Team are knocked out; the Duel goes to the first Team to win two.
_Avoid_: Set, life

**Knockout**:
A Duelist reaching zero Health, which ends their participation in the current Round.
_Avoid_: Death, kill

**Practice**:
A Duel with nothing at stake, for learning: no Knockout and no Round end, the practising Duelist's Health, Stamina, Focus and Potions are refilled, and the rival's Health comes back a moment after reaching zero, the rival down meanwhile (unable to act or be hit) until it has got back up; Cooldowns and Spell costs still apply.
_Avoid_: Sandbox, free play

**Training**:
Seventeen Lessons played in order that teach the Duel one thing each, each a Practice against the Training Dummy that fits it; what has been completed is remembered in the browser. It is required: Duel and Practice open once every Lesson has been completed once, and the player is then welcomed to the Club de Duelo.
_Avoid_: Tutorial

**Lesson**:
One step of Training: a scroll first, with the game paused, saying what it teaches and when to use it; then one goal after another on screen, each met from what the Duel reports (a Spell landing, a Shield blocking, a Potion down, a Wand picked up), never from the buttons pressed; then a scroll to play it again or go on.
_Avoid_: Level, mission

**Club de Duelo**:
What Training welcomes the player to once every Lesson is completed, after the Duelling Club of _Chamber of Secrets_ (its name in English); from then on Duel and Practice are open.
_Avoid_: Graduation, unlock

### Participants

**Duelist**:
A wizard taking part in a Duel, belonging to a Team and driven by exactly one Controller.
_Avoid_: Player, character, wizard, enemy

**Team**:
A side in a Duel; in a 1v1 each Team has one Duelist.
_Avoid_: Faction, side

**Controller**:
The source of a Duelist's intent: either a human holding a gamepad or the AI.
_Avoid_: Input, brain, agent

**Training Dummy**:
A scripted Controller a Practice can be fought against, each built to practise one thing: standing still, casting Light Spells on a beat, meeting a Charge in a Clash, or Disarming.
_Avoid_: Bot, target, debug rival

**Difficulty**:
The tuning profile of an AI Controller (reaction time, accuracy, aggression), chosen before the Duel.
_Avoid_: Level, skill

**Target**:
The opposing Duelist a Duelist is Locked On to.
_Avoid_: Enemy, lock

**Lock-on**:
The state in which a Duelist's camera and aim hold on their Target and they cast at it; their body still faces where they walk, turning to the aim only to cast, Charge or Shield. The player toggles it, and it breaks when the Target is Knocked Out or stays out of sight behind Cover.
_Avoid_: Target lock, Z-targeting, soft lock

**Aim Assist**:
The gentle pull a free-aiming Duelist's aim and casts get toward an opponent whose body reaches into the crosshair's circle, whose radius marks the boundary.
_Avoid_: Auto-aim, magnetism

### Combat

**Health**:
How much damage a Duelist can still take in the current Round before a Knockout.
_Avoid_: HP, life

**Stamina**:
A regenerating pool spent by Shielding, Dodging, jumping and sprinting, and by casting Light and Heavy Spells; whatever it cannot pay for is refused.
_Avoid_: Energy, mana

**Focus**:
A three-segment meter a Duelist builds through skilful play and spends on Special Spells; it starts empty each Round and never decays. Shown to the player as "Determinación", or "Determination" in English (power magic demands determination, as the three D's of Apparition have it).
_Avoid_: Special meter, super, rage

**Spell**:
An offensive magic a Duelist casts from their Wand: a Light Spell, a Heavy Spell or a Special Spell.
_Avoid_: Ability, attack, skill

**Light Spell**:
The quick, repeatable Spell whose hits build Focus; each cast costs a little Stamina, and every third consecutive cast is stronger but followed by a moment in which no Light Spell can be cast.
_Avoid_: Basic attack, light attack

**Heavy Spell**:
The Spell a Duelist Charges before releasing it; releasing it costs Stamina, and a Charge does not start without enough.
_Avoid_: Heavy attack, strong spell

**Special Spell**:
A Spell bound to a Spell Slot that costs Focus and has its own Cooldown.
_Avoid_: Ultimate, skill

**Spell Slot**:
One of the four face-button positions a Special Spell is bound to; holding R2 and pressing that face button casts it.
_Avoid_: Spell Wheel, quick slot, spell menu

**Charge**:
Holding the Heavy Spell to build its power before releasing it.
_Avoid_: Wind-up

**Perfect Release**:
Releasing a Charge in the brief window right as it fills, which empowers the Heavy Spell.
_Avoid_: Perfect cast, sweet spot

**Overcharge**:
Holding a full Charge past its safe window, which makes the Heavy Spell Backfire.
_Avoid_: Overload

**Backfire**:
A failed cast caused by Overcharge that leaves the caster Staggered instead of releasing the Spell.
_Avoid_: Misfire, fizzle

**Clash**:
Two fully Charged Heavy Spells meeting head-on and locking into a beam struggle that the Duelists fight over until one pushes it into the other.
_Avoid_: Beam struggle, Priori Incantatem, duel lock

**Cooldown**:
The time after casting a Special Spell before that same Special Spell can be cast again.

**Shield**:
The Protego barrier a Duelist holds up to block incoming Spells from the front, draining Stamina.
_Avoid_: Block, barrier

**Parry**:
Raising the Shield just before a Spell lands, which reflects that Spell back at its caster.
_Avoid_: Perfect block, deflect, counter

**Dodge**:
A short dash during which the Duelist cannot be hit.
_Avoid_: Roll, dash, evade

**Perfect Dodge**:
A Dodge started just before a Spell would have hit, which builds Focus.
_Avoid_: Near miss, last-second dodge

**Stagger**:
A brief interruption that stops a Duelist from acting, caused by a strong Stupefy hit or a Backfire.
_Avoid_: Stun

**Burn**:
Damage over time left on a Duelist caught in an Incendio explosion.
_Avoid_: DoT, fire damage

**Petrified**:
The state of a Duelist frozen in place by Petrificus Totalus, unable to move or act.
_Avoid_: Immobilized, frozen, stunned

**Disarm**:
The state of a Duelist whose Wand was knocked from their hand by Expelliarmus; they cannot cast or Shield until they recover it.
_Avoid_: Silence

**Wand**:
The Duelist's casting implement; while Disarmed it lies on the Arena floor until picked up or until it returns on its own.

### Potions

**Potion**:
A limited-use consumable a Duelist drinks from a Potion Slot, leaving them briefly vulnerable; charges refill each Round.
_Avoid_: Item, consumable, buff

**Potion Slot**:
One of the four D-pad arrows a Potion is bound to; holding L2 and pressing that arrow drinks it.
_Avoid_: Potion Wheel, item menu, inventory

**Wiggenweld**:
A Potion that restores part of the drinker's Health at once.

**Strength Potion**:
A Potion that raises the drinker's Spell damage for a short time. Shown to the player as "Poción Máxima", or "Maxima Potion" in English.
_Avoid_: Damage buff

**Swiftness Potion**:
A Potion that gives the drinker unlimited Stamina and extra speed for a short time. Shown to the player as "Poción Vigorizante", or "Invigoration Draught" in English.
_Avoid_: Speed buff

**Felix Felicis**:
A Potion that grants the drinker one Focus segment at once, never past the full meter.
_Avoid_: Luck potion, Focus potion

### Spells

**Stupefy**:
The Light Spell: a fast stunning bolt whose stronger third cast Staggers.

**Confringo**:
The Heavy Spell: a slow, Charged blast that deals heavy damage and knocks the target back.

**Expelliarmus**:
A Special Spell that deals no damage and Disarms the Duelist it hits; a Parried Expelliarmus Disarms its caster instead.

**Incendio**:
A Special Spell that explodes in an area on impact, dealing heavy damage and leaving a Burn.

**Depulso**:
A cheap Special Spell that blasts a short cone in front of the caster, knocking opponents back and interrupting their Charge or drinking.

**Petrificus Totalus**:
A Special Spell that leaves the Duelist it hits Petrified for a moment.

### Place

**Arena**:
The bounded space a Duel takes place in.
_Avoid_: Map, level, stage

**Cover**:
Arena geometry that stops both Duelists and Spells: the courtyard's columns. Spells wear it down until it breaks; broken Cover lies as Rubble for the rest of the Duel. The castle walls are the Arena's edge, not Cover, and never break.
_Avoid_: Obstacle, wall

**Obstruction**:
Low Arena geometry that stops Duelists but that Spells fly over, such as the fountain basin. The fountain breaks under Spells too, and stays an Obstruction as rubble.
_Avoid_: Obstacle, blocker

**Rubble**:
What broken Cover leaves: a low Obstruction where the column stood, which no longer stops Spells or hides a Duelist. The Arena is rebuilt for the next Duel.
_Avoid_: Debris, ruins

### The player

**Options**:
What the player chooses from the main menu and the browser remembers: the language played in (Spanish or English, the browser's on a first visit) and the music's and the effects' volumes.
_Avoid_: Settings, preferences

**Can't-play notice**:
What a phone, a tablet or a browser without WebGPU shows instead of the game: Spellbound is played on a computer, in Chrome or Edge, with a DualSense.
_Avoid_: Error page, unsupported screen
