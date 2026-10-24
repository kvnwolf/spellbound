# Human, fluid locomotion from a few in-place clips

Research notes for Spellbound (three.js `AnimationMixer` plus post-mixer IK, code-driven movement in a fixed 60 Hz simulation, clips: idle, walk, jog, sprint, roll, jump start/loop/land, a few casts and hits; no strafe, start, stop or turn clips).

## How to read this

- Each claim is followed by its source URL. **[heuristic]** marks a starting value I suggest where no source gives a number. **[recalled]** marks talk content I am quoting from memory because the primary page could not be fetched. Check those before relying on them.
- GDC Vault was down for maintenance during this research (every `gdcvault.com/play/...` link redirected to `gdconf.com/gdc-vault-maintenance/`). Talk content therefore comes from secondary write-ups, the speakers' own blogs, or recall.
- **No primary technical sources exist** (that I could find) for the locomotion of Black Myth: Wukong, Sparking Zero / Budokai Tenkaichi, Hogwarts Legacy or Ghost of Tsushima. Section 5 says what little is citable. The strongest, most numeric sources are Daniel Holden's articles and his open-source Motion Matching demo, Epic's Paragon/Lyra material, and Ubisoft's motion-matching talks.
- Unit conversion used throughout: a first-order exponential "sharpness" `k` (as in `x += (goal - x) * (1 - exp(-k dt))`) has halflife `ln2 / k`. Holden's critically damped spring with "halflife" `h` has `y = 2·ln2 / h`. It reaches about 60% of a step at `t = h`, 90% at about `2.8·h`, and its peak rate is `Δ·y/e` at `t = 1/y`.

### Where Spellbound stands today (from `src/tuning.ts`, `src/duel/duel.ts`)

| Thing | Current | Equivalent |
|---|---|---|
| Velocity | first-order exponential, `acceleration: 9`, `deceleration: 12` per second | halflife 0.077 s / 0.058 s; 90% in 0.26 s / 0.19 s; **acceleration jumps from 0 to 45 m/s² on the first tick** at a 5 m/s run (infinite jerk) |
| Facing | constant `moveTurnRate: 12` rad/s (688°/s); aim turns finish within 0.1 s | 180° in 0.26 s at a constant rate, so it starts and stops abruptly |
| Clip weights | exponential ease, `sharpness: 12` | crossfade with a 0.058 s halflife (95% in 0.25 s) |
| Gait | cadence `base + perSpeed·v` (run 2.3 + 0.12·v steps/s), stride IK 0.4 to 1.3× clip, bob 0.3, lean share 0.35 capped at 0.16 rad (9.2°), counter-twist, head lead 0.18 s, pivot stepping | Already close to Paragon-style stride warping plus Overgrowth-style distance-driven cycles (see sections 2 and 6) |
| Stick | scaled radial dead zone 0.12 | Matches Sutphin's recommendation (section 1) |

At 5 m/s the run cadence works out to 2.9 steps/s (174 steps/min). Measured recreational runners do 169 to 178 steps/min at 2.7 to 3.8 m/s, about 7.9 steps/min per m/s (0.13 steps/s per m/s), so `perSpeed: 0.12` is well chosen (https://ijspt.scholasticahq.com/article/140544-the-effect-of-running-speed-on-cadence-and-running-kinetics).

---

## 1. Shaping the player's velocity

### Desired vs. actual velocity
- The standard architecture maps the stick to a **desired velocity** and lets a **critically damped spring** move the actual velocity toward it. The spring's "position" is the character's velocity and its "velocity" is the character's acceleration. The same closed form also gives the position integral and an exact future trajectory, so a predicted path costs nothing (https://theorangeduck.com/page/spring-roll-call). The function is `spring_character_update(x, v, a, v_goal, halflife, dt)`, with `j0 = v - v_goal`, `j1 = a + j0·y`, `v' = e^(-y dt)(j0 + j1 dt) + v_goal`, `a' = e^(-y dt)(a - j1·y·dt)`.
- Holden's open-source demo values (https://github.com/orangeduck/Motion-Matching/blob/main/controller.cpp):
  - `simulation_velocity_halflife = 0.27`, `simulation_rotation_halflife = 0.27` s
  - run speeds: forward 4.0, sideways 3.0, backward 2.5 m/s; walk: 1.75, 1.5, 1.25 m/s
  - `gait_change_halflife = 0.1` s (walk/run switch smoothed as a 0 to 1 spring)
  - stick dead zone 0.2, with magnitude **squared** above it for finer low-speed control
  - the direction-dependent speed scales the stick by forward, side or back speed depending on the local stick direction
- The same speeds come out of mocap analysis: running about 4 m/s forward, 3 sideways, 2 backward; walking about 1.75, 1.5, 1.25 (https://theorangeduck.com/page/code-vs-data-driven-displacement).
- **Real humans are slower than games.** Fitted to mocap, a stand-to-run has a critical-spring halflife of **0.63 s** (peak acceleration 3.94 m/s², top speed 4.86 m/s). A 180° plant-and-turn has a facing halflife of **0.60 s** (peak 154.68°/s) (https://theorangeduck.com/page/fitting-code-driven-displacement). Games shorten this a lot for responsiveness: 0.27 s in the demo, 0.1/0.05 s in UE's new model. That gap is what procedural lean, stride warping and inertialization have to cover visually.
- Stopping distance of a critical spring from speed `v0` with zero initial acceleration is `2·v0 / y` (https://theorangeduck.com/page/fitting-code-driven-displacement-revisited). This is what you use to predict where a stop will end.

### Holden's "New Movement Model" (UE Mover's Smooth Walking mode)
Source: https://theorangeduck.com/page/new-movement-model
- It keeps a constant-rate (acceleration-capped) intermediate velocity `vel_imm`, then a spring tracks that with a small lookahead (`dt + compensation·halflife_to_lag(halflife)`). The result is clamped to no more than max(previous speed, desired speed). This gives S-shaped ramps like mocap, without the instant acceleration spike of a pure exponential.
- Defaults: `acceleration 800`, `deceleration 1400` (demo units are px/s², so **deceleration about 1.75× acceleration**), `acceleration_halflife 0.1 s`, `deceleration_halflife 0.05 s`, `acceleration_compensation 1.0`, `deceleration_compensation 0.0`, `directional_acceleration 0.0`, `turn_strength 1.0`.
- **Turn strength** rotates the velocity direction toward the desired direction while keeping its magnitude, so a direction change does not need to brake through zero.
- **Facing:** mocap turns are S-shaped and take **about the same time whatever the angle**. It is modelled with a double spring (two springs in series, each at half the halflife), `rotation_halflife = 0.15 s`.
- Caveats: it is not dt-invariant (sub-step if dt is large), it snaps to the target within an epsilon, and external pushes must write both the actual and the intermediate velocity.

### Rotation / reconciliation (when animation and simulation disagree)
From the demo constants (https://github.com/orangeduck/Motion-Matching/blob/main/controller.cpp) and the article (https://theorangeduck.com/page/code-vs-data-driven-displacement):
- `adjustment_position_halflife 0.1 s`, `adjustment_rotation_halflife 0.2 s`. Rotation corrections should be **slower** than position corrections because fast rotation correction looks bad.
- `adjustment_*_max_ratio 0.5`: corrections are limited to 50% of the character's current speed (or angular speed). Rotation is fixed mostly *during* turns and position mostly *during* fast movement, which hides foot slide at plants and stops.
- `clamping_max_distance 0.15 m`, `clamping_max_angle 90°`.
- A procedural head look toward the travel direction increases perceived responsiveness.

### Input filtering
- Use a **scaled radial dead zone**: zero inside `d`, otherwise `dir · (|s| - d)/(1 - d)`. Typical `d` is 0.1 to 0.2 (worn pads up to 0.25). Axial dead zones snap input to cardinal directions (https://www.gamedeveloper.com/business/doing-thumbstick-dead-zones-right).
- Response curve: Holden squares the magnitude above the dead zone (https://github.com/orangeduck/Motion-Matching/blob/main/controller.cpp). This gives slow, precise walks at half tilt, which also gives the walk clip more stick range.
- Response budget: Swink's "real-time" threshold is feedback under about 100 ms (https://lizengland.com/blog/review-game-feel-by-steve-swink/). Whatever spring you choose, the *first visible change* (lean, head, first foot lift) should start on the first frame, even while speed ramps.

### Sharp reversals and pivots
- Paragon authored starts, stops and pivots and drove them by **distance to world markers** ("reverse root motion"), so a pivot's plant happens exactly where the simulation turns (https://gamedeveloper.com/programming/most-inspiring-game-animation-tech-talks-of-2016).
- Without pivot clips: turn strength (above) preserves speed through moderate turns. For near-180° reversals the spring naturally decelerates along the old direction and re-accelerates. The facing must not snap. Let a facing spring (halflife about 0.1 to 0.15 s) carry the body through, and let the legs step round. Spellbound already has pivot stepping.
- Lyra turns in place by accumulating a **root yaw offset** that counter-rotates the root while standing, then plays a turn when a threshold is crossed. Epic's tech blog suggests widening the range to about −179° to 179° (search-result excerpt of https://www.unrealengine.com/tech-blog/adapting-lyra-animation-to-your-ue5-game; the page returned 403 to the fetcher). Modes are Accumulate (idle), Hold (starts) and Blend Out (entering the cycle) (https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-in-lyra-sample-game-in-unreal-engine).

---

## 2. Making animation follow motion without start/stop/turn clips

### Drive cycles by distance, not time (the core trick)
- **Distance matching**: play an animation by the distance travelled rather than by time. UE drives stops, starts and pivots from a baked root-distance curve (XY for locomotion, Z for landings; sample rate 30 "covers most use cases") (https://dev.epicgames.com/documentation/en-us/unreal-engine/distance-matching-in-unreal-engine). With only cycles, the equivalent is to **advance cycle phase by `distance / stride_length`**, so planted feet never slide whatever the speed. Overgrowth works this way **[recalled]** (https://www.gamedeveloper.com/design/video-an-indie-approach-to-procedural-animation).
- Lyra uses distance matching during starts to keep the pose, then blends toward stride warping as the character reaches the jog (https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-in-lyra-sample-game-in-unreal-engine).

### Stride warping vs. playback-rate warping (limits)
- Paragon matched speed mainly by **stride warping**: feet are placed farther from or nearer to the root along the motion axis. That gave **up to 60%** of the speed range, with only **15% more from playback rate**. When the feet could not reach their IK targets, the hips dropped slightly, smoothed with springs (https://gamedeveloper.com/programming/most-inspiring-game-animation-tech-talks-of-2016).
- Epic's Lyra blog cites an industry rule of thumb that **play rate or stride warp adjustments should stay within 15 to 20%** of the authored values. Beyond that, too much play rate looks sped up, too much warping stretches the pose, and allowing slight foot slide is the better trade (search-result excerpt of https://www.unrealengine.com/tech-blog/adapting-lyra-animation-to-your-ue5-game).
- Clavet (For Honor): time-scaling rarely looks good. Prefer warping the trajectory slightly and **sliding the character over the error** (https://gamedeveloper.com/programming/most-inspiring-game-animation-tech-talks-of-2016).
- UE Stride Warping computes stride scale as `LocomotionSpeed / RootMotionSpeed`, with optional clamp and interp on the result, and a pelvis-adjustment spring (stiffness and damping) (https://dev.epicgames.com/documentation/en-us/unreal-engine/pose-warping-in-unreal-engine).
- Holden scaled root motion to 1.25× and 0.75× and found it makes the **whole character** slide, not just the feet (https://theorangeduck.com/page/inverse-kinematics-foot-locking). Put the correction in cadence (phase rate) plus stride length together, as Spellbound does, rather than in either one alone.

### Orientation warping (moving off the facing with no strafe clips)
- It twists the lower body toward the movement direction and counter-twists the spine so the upper body keeps facing (https://dev.epicgames.com/documentation/en-us/unreal-engine/pose-warping-in-unreal-engine). Settings:
  - rotate about Z (up)
  - **Distributed Bone Orientation Alpha**: how the counter-twist spreads over the spine bones (1 puts it all on spine index 0, 0 on the highest index)
  - `Rotation Interp Speed` (0 means instant)
  - `Location Angle Delta Threshold` default **90°** (beyond it the node stops warping)
- Lyra uses it in starts because it has only four cardinal-direction clips (https://dev.epicgames.com/documentation/en-us/unreal-engine/animation-in-lyra-sample-game-in-unreal-engine). Epic recommends disabling it for a forward-facing character's starts, since that character should just face its motion (search-result excerpt of https://www.unrealengine.com/tech-blog/adapting-lyra-animation-to-your-ue5-game).
- Practical limit **[heuristic]**: up to ±60 to 90° of leg twist reads as strafing. Past about 110 to 120° it reads as "running away" unless you either turn the whole body or play the cycle backwards. Spellbound turns the legs fully (`maxTwist = π`), which is the "running away" choice: deliberate and readable.

### Procedural lean
- Physical lean angle is `atan2(a_horizontal, g)`, where turning contributes centripetal `a = v·ω` (= v²/r). 5 m/s² gives about 27°. For games, use **30 to 70% of the physical angle** (`lean_strength 0.3 to 0.7`), cap it, low-pass the acceleration, and **distribute it over the spine, with lower joints taking a larger share** (https://docs.vulkan.org/tutorial/latest/Advanced_glTF/Procedural_Animation_IK/06_physics_driven_lean.html).
- Art practice: heavily damp turn input to avoid "body lurch", and scale turn lean by speed, since at low speed it is negligible (summary of a locomotion slide deck, https://www.scribd.com/presentation/374070839/HowToWalk; author not identified, so low weight).
- Starting values **[heuristic]**:
  - acceleration lean capped at 8 to 10°, turn lean at 10 to 14° at sprint, about 0 at walk
  - pivot the tilt about the feet (rotate the root around the ground contact), not about the hips
  - level the head back by 60 to 80% (see section 4)
  - smooth the lean with a critically damped spring of halflife 0.08 to 0.12 s, or an under-damped one (damping ratio 0.6 to 0.7) to get a small settle overshoot on stops

### Foot locking / IK
Source: https://theorangeduck.com/page/inverse-kinematics-foot-locking, with values from https://github.com/orangeduck/Motion-Matching/blob/main/controller.cpp
- **Contact detection:** toe global speed below **0.1 to 0.5 m/s** and toe height below about **0.1 m**. Median-filter over about 5 frames at 60 Hz. Contacts at 30 Hz are too short; at 60 Hz they are fine.
- **Lock** when contact begins and the output is within a lock distance. **Unlock** when contact ends or the drift exceeds the unlock radius (demo: `ik_unlock_radius 0.2 m`).
- **Blend lock/unlock with inertialization**, not snapping (demo `ik_blending_halflife 0.1 s`, `ik_foot_height 0.02 m`, `ik_toe_length 0.15 m`).
- **Lock the toe, not the heel.** Derive the heel from the toe-to-heel offset.
- **Limit leg extension** to the input hip-to-heel length minus a buffer (demo `ik_max_length_buffer 0.015 m`; article soft-clamp about 0.005 m).
- **Don't lower the pelvis** to make leg slack. It produces the "t-rex" bent-knee look.
- "A little bit of sliding is a lot better than breaking the source animation." Foot slide is a *velocity* error.
- Clavet's runtime heuristic: lock the toe when foot speed and height are both low, and don't lock if the foot is too far from its animated position (https://gamedeveloper.com/programming/most-inspiring-game-animation-tech-talks-of-2016).

### Pelvis bob and height
- The whole-body centre of mass follows a smooth path with **about 5 cm peak-to-peak** vertical and mediolateral motion at natural walking speed. Pelvic rotation and list contribute little to the vertical part (https://www.doi.org/10.1016/j.jbiomech.2014.02.002).
- Paragon dropped the hips slightly, through springs, when feet could not reach (https://gamedeveloper.com/programming/most-inspiring-game-animation-tech-talks-of-2016). Holden warns against lowering them for slack (above). Use small adjustments, smoothed.
- **[heuristic]** Running bob of about 6 to 9 cm, with the lowest point just after each foot strike. Stopping adds a short spring "settle" dip of 2 to 3 cm with about a 0.25 s period.

---

## 3. Blending: inertialization vs. crossfades

- **Why crossfades look floaty:**
  - The result is always between the two poses, so it **damps the destination's detail** and can look "mushy". It also causes foot sliding (https://theorangeduck.com/page/dead-blending).
  - A linear weight fade also ignores the source's velocity at the switch, giving a visible velocity discontinuity at the start and a slow drift at the end.
  - Both poses must be evaluated for the whole fade. Gears of War 4 dropped blended transitions entirely in favour of inertialization as a post-process, for quality and performance (session description, https://www.gdcvault.com/play/1025331/Inertialization).
- **Inertialization (offset decay):** at the transition, switch instantly to the new animation and record `offset = (src + old_offset) - dst` for position, and the same for velocity. Each frame, decay the offset to zero with a spring and output `in + offset` (https://theorangeduck.com/page/spring-roll-call):

  ```c
  void inertialize_transition(float& off_x, float& off_v, float src_x, float src_v, float dst_x, float dst_v) {
      off_x = (src_x + off_x) - dst_x;
      off_v = (src_v + off_v) - dst_v;
  }
  // each frame: decay_spring_damper_exact(off_x, off_v, halflife, dt); out = in + off_x;
  ```

  - Holden's demo uses `inertialize_blending_halflife = 0.1 s` (https://github.com/orangeduck/Motion-Matching/blob/main/controller.cpp).
  - For quaternions, store the offset as a scaled angle-axis vector: `offset = log(q_src_out · q_dst⁻¹)`, decay it like a vec3, and output `exp(offset) · q_in`.
  - Downsides: it needs the source and destination velocities on the transition frame. It can produce knee pops and "floaty, swimming" motion when poses differ a lot (https://theorangeduck.com/page/dead-blending).
- **Dead blending** (cheaper to integrate into an existing system) (https://theorangeduck.com/page/dead-blending):
  - On transition, record the current output pose and per-joint velocity (finite difference of the last two frames).
  - Each frame, decay that velocity (`v *= 2^(-dt/halflife)`), integrate it to extrapolate the old pose, and **smoothstep-crossfade from the extrapolation to the live new pose** over the blend time (example 0.2 s). Use a sign-stable slerp so quaternions do not flip side mid-blend.
  - In Holden's UE 5.3 node the extrapolation halflife is set per joint axis from (difference / velocity), scaled by `halflife_scale 0.3` and clamped to `[0.1, 1.0]` s. He found it gave better blends than UE's inertialization for very different poses and frequent transitions, though it "tends to damp out the motion a bit more" (https://theorangeduck.com/page/dead-blending-node-unreal-engine).
- **Getting velocities cheaply:** finite differences of the previous output pose work. They break on teleports and resets, and IK pops can spike them. For procedural layers, evaluate twice (input and input extrapolated by a small delta) and difference the results (https://theorangeduck.com/page/propagating-velocities-through-animation-systems).
- **Inertial easing** is an alternative for scalar weights that must arrive exactly at a target. It re-fits a smoothstep through the current value and velocity whenever the target changes, so it arrives within at most about 1.5× the blend time, with `overshoot 0.05` (https://theorangeduck.com/page/inertial-easing). It is good for blend-space weights (speed band, stance amount) that change often.
- **Typical times:** inertialization halflife 0.05 to 0.1 s (0.1 s is the demo default). Dead-blend durations about 0.15 to 0.25 s (0.2 s is the article's example). TLOU2's motion matching kept blending "to a minimum" at every foot plant and turn (Anthony Newman, via https://www.naughtydog.com/blog/naughty_dog_at_gdc_2021 and press coverage). **[heuristic]** For a continuous speed blend between phase-synced cycles (walk↔jog↔sprint), a weight blend is fine, because the poses are similar and phase-aligned. Use inertialization for **discrete events**: cast in/out, roll in/out, land, flinch, stop→idle, idle→move.
- three.js notes: `AnimationAction.crossFadeTo(action, duration, warp)` is a plain weight crossfade (`warp` also ramps time scales). `setEffectiveTimeScale` and `setEffectiveWeight` set the raw controls (https://github.com/mrdoob/three.js/blob/r186/docs/pages/AnimationAction.html.md). An inertialization layer has to run **after `mixer.update()` and before IK**, on the bones' local quaternions.

---

## 4. Procedural secondary motion that reads as "human"

- **Head stabilization:** during walking, running in place and hopping, head pitch in the Frankfort plane stays **within 20°** and head angular velocity **below 140°/s** (Pozzo et al., https://www.doi.org/10.1007/BF00230842). In running, head pitch is about **180° out of phase with vertical head translation**, so the head nods to counter the bob (https://pmc.ncbi.nlm.nih.gov/articles/PMC2768006). Humans also use the arm swing as a tuned-mass damper to stabilize the head while running (https://sicb.org/?p=30307). **[heuristic]** After all procedural layers, rotate the head to cancel 60 to 80% of the chest's pitch and roll change, and keep its world pitch rate under about 140°/s.
- **Look-at limits:** measured adult cervical rotation is about **70 to 75° per side**, flexion about 45 to 58°, extension about 59°, lateral flexion about 40 to 45° (https://openaccess.iku.edu.tr/entities/publication/1d43fa73-7df0-4c7f-b388-43469591b92b/full and https://help.neckcare.com/range-of-motion-test). For game use, spread the yaw: about 30 to 40% in the spine and chest, the rest in the neck and head, and the head alone at most about 60 to 70° (Spellbound's `headTurn 1.1 rad` = 63° is right). **Lead turns with the head** (Spellbound's `headLead 0.18 s`). Holden notes a head look toward the travel direction makes control feel more responsive (https://theorangeduck.com/page/code-vs-data-driven-displacement).
- **Breathing:** resting adults take 12 to 20 breaths per minute (https://www.lung.org/blog/respiratory-rate-vital-signs). **[heuristic]** Additive chest pitch of 1 to 2° with 0.5 to 1 cm clavicle lift at about 0.25 Hz in idle. Couple it to stamina: after a sprint or roll, go to about 0.6 Hz with double the amplitude, decaying back over 3 to 5 s. It is cheap and players read it as effort.
- **Idle weight shift [heuristic]:** lateral pelvis sway of 1 to 2 cm and ±1 to 2° pelvis roll with a 4 to 7 s period, using two incommensurate sines or smoothed noise. Counter-roll the chest by about half. Desynchronize the two Duelists' phases.
- **Arm swing coupling:** arm swing reduces vertical centre-of-mass excursion while walking (https://experts.unthsc.edu/en/publications/effects-of-constrained-arm-swing-on-vertical-center-of-mass-displ/). When the wand arm is IK-raised, keep the free arm's counter-swing from the clip (a dead-still free arm reads as robotic).
- **Anticipation / follow-through / settle:** Cooper's game-animation fundamentals list **Feel** (response, inertia and momentum, visual feedback) and **Fluidity** (blending and transitions, seamless cycles, settling) (https://www.gameanim.com/?p=52801). In practice: a 2 to 4 frame wind-up that does not delay the gameplay event, an overshoot spring on the spine after the release, and a settle on stops.
- **Additive hit reactions:** layer a single-pose directional hit clip additively on the upper body so locomotion continues. Pick from 8 directions plus a centre one by dot products (https://www.moddb.com/features/direction-based-hit-reaction). Or apply procedural spring kicks to the bones near the impact, with per-bone rotation limits, after the main pose (https://forums.unrealengine.com/t/kettunen-easy-procedural-hit-reactions/2741781). three.js supports additive clips through `AnimationUtils.makeClipAdditive` and `AdditiveAnimationBlendMode`. **[heuristic]** Spring kick: an angular-velocity impulse of 3 to 6 rad/s on spine_02 / spine_03 / neck about the axis `cross(up, hitDir)`, under-damped (frequency about 4 Hz, damping ratio about 0.5), decaying in about 0.4 s.
- **Small randomization [heuristic]:** ±3% cadence per Duelist, ±10% idle breathing rate, random idle phase offsets, and occasional micro-glances (head 5 to 15°) every 3 to 8 s when no target is in view.

---

## 5. What the reference games do (only what is citable)

- **Black Myth: Wukong:** I found no Game Science talk on locomotion or motion matching. Citable facts: it moved to UE5 in August 2021 (https://m.21jingji.com/article/20240908/herald/ef6d0bc54aa528204297d7bd0ec91d88.html), it relies on heavy motion capture with a dedicated actor for the protagonist, and Digital Foundry pointed out its "secondary animation" detail (https://www.ithome.com/0/509/844.htm). Its fluidity is plausibly mocap density plus UE5's inertialization and warping tools, but that is an inference, not a sourced fact.
- **Elden Ring / Dark Souls:** roll i-frames are **14 frames at 30 fps (about 0.47 s) at light or medium load and 13 (about 0.43 s) at heavy load**. Quickstep gives 15, Bloodhound's Step 16 (https://eldenring.wiki.gg/wiki/Invincibility_Frames). DS1's lock-on restricted movement to sideways walking or charging, and DS3 loosened it (players' accounts, https://steamcommunity.com/app/570940/discussions/0/1642041886389906296). No datamined turn rates were found. Root-motion strafing fights character rotation under lock-on, a known UE pitfall (https://forums.unrealengine.com/t/using-root-motion-animations-while-strafing/417057).
- **Sparking Zero:** base movement was raised to roughly the old dash speed, and the old dash button became a new short dash for quick repositioning and attacking on the move (https://www.gamespark.jp/article/2024/03/21/139601.html). No technical locomotion sources found.
- **The Last of Us Part II:** motion matching for locomotion, traversal, melee and cover (Mach's reel, https://vimeo.com/433024043). The GDC 2021 slides are linked from https://www.naughtydog.com/blog/naughty_dog_at_gdc_2021 (a 3.8 GB pptx, not downloaded). Newman: blending is kept "to a minimum" at every foot plant and turn.
- **For Honor (Ubisoft):** motion matching matches only a few bones (feet positions and velocities, plus weapon), and its cost weights trade responsiveness (trajectory) against smoothness (pose and velocity). Fixes: warp the trajectory slightly to the requested speed, avoid time-scaling, and lock toes with simple heuristics (https://gamedeveloper.com/programming/most-inspiring-game-animation-tech-talks-of-2016). Clavet's talk: https://gdcvault.com/play/1023280/Motion-Matching-and-The-Road.
- **Paragon (Epic):** stride warping up to 60% plus 15% play rate, distance-driven starts, stops and pivots, sync markers where a foot crosses the root, slope IK by rotating foot targets by the ground normal, and spring-smoothed hips (same source).
- **Overgrowth (David Rosen, GDC 2014):** "We really need animation and code to work more closely together" (https://www.gamedeveloper.com/design/video-an-indie-approach-to-procedural-animation). About 13 keyframes in total for the whole character (forum claim, https://discussions.unity.com/t/an-indie-approach-to-procedural-animation-gdc-video-talk/538228). Walk and run were reproduced with **4 key poses each** (pass and reach per side) (https://people.engr.tamu.edu/sueda/courses/CSC474/2016W/demos/ismithgr/index.html). **[recalled]** From the talk itself:
  - responsiveness lives in the physics (a simple body with a fast velocity response) and animation is layered on top
  - the cycle phase advances with distance travelled, like a wheel, so feet never slide
  - key poses are interpolated with eased or spring curves, not linearly
  - the whole body leans into acceleration
  - jump poses are chosen from vertical velocity, and landings compress with a spring
  - IK on the feet, and physics on secondary parts and for hit reactions (ragdoll blending)
- **Hogwarts Legacy, Ghost of Tsushima:** no animation or locomotion technical sources found (Sucker Punch's GDC talks cover combat balance, the guiding wind and the open world).

---

## 6. Prioritized techniques for Spellbound

Ordered by visible impact per unit of work, given what is already built (cadence-driven cycles, stride IK, lean, counter-twist, head lead, pivot steps).

1. **Post-mixer inertialization for discrete transitions.** It removes the "pose snaps, then floats" look of 0.25 s weight fades.
   - Run it after `mixer.update`, before IK. Per bone, keep the last output local quaternion and angular velocity (finite difference).
   - On any discrete state change (idle↔move start, cast in/out, roll in/out, land, flinch, knockback end), set the new clip weights **instantly**, then compute `o = log(q_prevOut · q_newIn⁻¹)` (vec3) and `ov = ω_prevOut − ω_newIn`.
   - Each frame, `decay_spring_damper_exact(o, ov, h, dt)` and output `exp(o) · q_in`. Do the same for hips position.
   - Start with `h = 0.08 s` for locomotion events and 0.05 s for fast casts and hits, so 90% of the offset is gone in 0.14 to 0.22 s. Use dead blending (blend 0.2 s, extrapolation halflife clamped to [0.1, 1.0], scale 0.3) only if very different poses (roll exit, knockback) still pop.
   - Keep the weight blend only between phase-synced walk/jog/sprint.
2. **Second-order (critically damped) velocity in the simulation, replacing the first-order exponential.** It removes the infinite-jerk start that makes the first tick look mechanical, and gives the lean a smooth signal.
   - Use `spring_character_update` per axis with separate `h_accel = 0.10 s` and `h_decel = 0.07 s`, chosen when |desired| is at least or below |current|.
   - Results: 90% speed in about 0.28 s / 0.20 s (close to today's 0.26 / 0.19 s), but peak acceleration about 25 m/s² instead of an instant 45, and stop distance `2v/y` of about 0.5 m from 5 m/s.
   - Optional upgrade: Holden's New Movement Model (acceleration cap, deceleration about 1.75× acceleration, spring 0.1/0.05 s, `turn_strength 1`) so speed survives turns.
   - Keep it deterministic: it is closed-form per tick.
3. **Facing on a spring, not a constant rate.** A constant 688°/s starts and stops instantly. A spring gives the S-shaped, angle-independent turn time seen in mocap.
   - Use a critically damped spring on wrapped yaw (or Holden's double spring) with `h = 0.10 s` while moving (90% in about 0.28 s for any angle), 0.06 s for aim turns (keeps `aimTurnSeconds` intent), and 0.15 s standing.
   - Optionally cap at about 15 rad/s. Scale `h` up about 1.3× at sprint so fast running carves.
   - For reversals over about 135° at above 3 m/s, let the velocity spring brake along the old direction while the facing spring swings, and fire a 0.08 s inertialization pulse plus a pivot-step burst.
4. **Distance-matched stop and start out of the cycle clips.** No stop clip is needed.
   - On release, predict the stop distance (`2v/y`) and keep advancing cycle phase by distance until the **next foot contact** (phase 0 or 0.5). If the predicted distance ends mid-step, shorten that last step's stride (≥0.4× clip) rather than speeding the clip.
   - When speed is under about 0.3 m/s and a foot is planted, inertialize (h 0.1 s) into idle and play a pelvis settle (2 to 3 cm dip, under-damped, about 4 Hz).
   - Starts: begin the cycle at the contact pose of the foot opposite the move direction so the first lift is on the correct leg. Lean comes from the acceleration (item 5).
   - Keep play-rate deviation within ±15 to 20%. Put the rest into stride, as Paragon did (60% stride / 15% rate).
5. **Physically derived lean, smoothed by a spring and pivoted about the feet.**
   - `lean = share · atan2(|a_h|, g)`, where `a_h` is the sim acceleration plus centripetal `v·ω_yaw` (with the spring sim from item 2, `a` is available exactly).
   - share 0.35 to 0.5. Caps: 8° for acceleration and braking, 12° for turns at sprint, scaled by speed/sprintSpeed.
   - Rotate the whole root about the ground contact, put about 30% extra in the spine (lower bones heavier), and smooth with a critical spring `h = 0.1 s` (or ζ = 0.65 for a small overshoot on stops).
   - Level the head back by 70%.
6. **Toe foot-locking with inertialized lock/unlock** on top of the existing stride IK.
   - Contact when toe speed < 0.3 m/s and height < 0.05 m (median over 5 ticks). `unlock_radius 0.2 m`, lock and unlock blends `h 0.1 s`, foot height 0.02 m, leg-extension buffer 0.015 m with soft clamp 0.005 m.
   - Never drop the pelvis for slack. Accept about 2 to 3 cm of slide over a bad pose.
7. **Head stabilization plus limited look-at.**
   - After lean and bob, counter 60 to 80% of the chest's pitch and roll on neck and head.
   - Limit look yaw to about 65° on the head and pitch to +45/−35°, spread over spine and neck as today, and keep the head's angular speed ≤140°/s outside aim snaps.
   - This sells weight more than any amount of body motion.
8. **Spring-based additive hit reactions and cast follow-through.**
   - Flinch and knockback become an angular impulse (3 to 6 rad/s) on the spine and neck about `cross(up, hitDir)`, under-damped (4 Hz, ζ 0.5), plus an upper-body additive hit pose picked from 8 directions. Locomotion keeps running underneath.
   - Casts: a 2 to 3 tick anticipation pose, then a spine overshoot spring after release (about 3 to 5°).
9. **Effort-coupled idle life.** Breathing additive at 0.25 Hz (1 to 2° chest, 0.5 to 1 cm shoulders), rising to 0.6 Hz with double amplitude after stamina spend, plus 4 to 7 s weight-shift sway (1 to 2 cm, ±1.5°). Randomize phases and ±3% cadence per Duelist.
10. **Input shaping check.** Keep the scaled radial dead zone (0.12 is within the 0.1 to 0.2 norm) and add a response curve (`m²` as in Holden's demo, or `m^1.5`) so half tilt walks slowly. This gives the walk clip a real stick range and makes walk→jog crossovers less frequent at mid tilt.

### Most important numbers
- Inertialization halflife 0.1 s (Holden demo). Dead-blend 0.2 s, extrapolation halflife [0.1, 1.0] × 0.3.
- Velocity spring 0.27 s in a realistic demo; UE Mover 0.1 s accel / 0.05 s decel; real mocap 0.63 s (run) and 0.60 s (180° turn, peak 155°/s); facing double spring 0.15 s.
- Speeds (mocap): run 4 / 3 / 2 to 2.5 m/s (forward / side / back), walk 1.75 / 1.5 / 1.25.
- Play-rate or stride warp within ±15 to 20% (Epic rule of thumb); Paragon stride warp up to 60% plus 15% rate; Clavet: avoid time-scaling, slide instead.
- Orientation warping angle threshold default 90°.
- Foot contact: toe < 0.1 to 0.5 m/s, height < 0.1 m; unlock radius 0.2 m; IK blend 0.1 s; extension buffer 0.015 m.
- Physical lean `atan(a/g)`, use 30 to 70% of it.
- Centre-of-mass bob about 5 cm peak-to-peak walking.
- Head pitch < 20°, < 140°/s; neck rotation about 70° per side.
- Dead zone 0.1 to 0.2, scaled radial.
- Elden Ring roll 13 to 14 i-frames at 30 fps (0.43 to 0.47 s).
- Running cadence about 170 to 178 steps/min at 2.7 to 3.8 m/s (+7.9 steps/min per m/s).
