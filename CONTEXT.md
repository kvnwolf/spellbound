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

**Difficulty**:
The tuning profile of an AI Controller (reaction time, accuracy, aggression), chosen before the Duel.
_Avoid_: Level, skill

**Target**:
The opposing Duelist a Duelist is locked onto; aim is expressed as an offset around the Target.
_Avoid_: Enemy, lock

### Combat

**Health**:
How much damage a Duelist can still take in the current Round before a Knockout.
_Avoid_: HP, life

**Stamina**:
A regenerating pool spent by Shielding, Dodging, jumping and sprinting.
_Avoid_: Energy, mana

**Focus**:
A three-segment meter a Duelist builds through skilful play and spends on Special Spells; it starts empty each Round and never decays.
_Avoid_: Special meter, super, rage

**Spell**:
An offensive magic a Duelist casts from their Wand: a Light Spell, a Heavy Spell or a Special Spell.
_Avoid_: Ability, attack, skill

**Light Spell**:
The quick, repeatable Spell whose hits build Focus; every third consecutive cast is stronger.
_Avoid_: Basic attack, light attack

**Heavy Spell**:
The Spell a Duelist Charges before releasing it.
_Avoid_: Heavy attack, strong spell

**Special Spell**:
A Spell chosen from the Spell Wheel that costs Focus and has its own Cooldown.
_Avoid_: Ultimate, skill

**Spell Wheel**:
The radial selection a Duelist holds open to pick and cast a Special Spell.
_Avoid_: Spell menu, selector

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
A limited-use consumable a Duelist drinks from the Potion Wheel, leaving them briefly vulnerable; charges refill each Round.
_Avoid_: Item, consumable, buff

**Potion Wheel**:
The radial selection a Duelist holds open to pick and drink a Potion.
_Avoid_: Item menu, inventory

**Wiggenweld**:
A Potion that restores part of the drinker's Health at once.

**Strength Potion**:
A Potion that raises the drinker's Spell damage for a short time.
_Avoid_: Damage buff

**Swiftness Potion**:
A Potion that gives the drinker unlimited Stamina and extra speed for a short time.
_Avoid_: Speed buff

### Spells

**Stupefy**:
The Light Spell: a fast stunning bolt whose stronger third cast Staggers.

**Confringo**:
The Heavy Spell: a slow, Charged blast that deals heavy damage and knocks the target back.

**Expelliarmus**:
A Special Spell that deals no damage and Disarms the Duelist it hits; a Parried Expelliarmus Disarms its caster instead.

**Incendio**:
A Special Spell that explodes in an area on impact, dealing heavy damage and leaving a Burn.

**Petrificus Totalus**:
A Special Spell that leaves the Duelist it hits Petrified for a moment.

### Place

**Arena**:
The bounded space a Duel takes place in.
_Avoid_: Map, level, stage

**Cover**:
Arena geometry that stops Spells.
_Avoid_: Obstacle, wall
