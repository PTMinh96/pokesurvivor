# GDD — PokéSurvivor · Mystery Dungeon

> Living design document. Describes the game's **current** state; a dated
> decision log appears at the end.

## 1. Concept

- **Platform:** browser. Open `index.html` with a double-click; no server required.
- **Genre:** bullet-heaven / horde survival + **roguelike** + **character gacha**.
- **References:** Survivor.io, Megabonk, Vampire Survivors.
- **Style:** **Pokémon Mystery Dungeon** (PMD sprites, blue dialogue boxes,
  pixel-art icons, village music).
- **The player is a Pokémon.** There are **966 Pokémon** from all 9 generations.
- **Everything is local:** sprites, data, font, music, and saves. The game makes
  no internet requests.

## 2. Screen flow

```
Login / Create account / Guest
        │
        ├─ (first time) Personality test ─> Assigned companion
        │                                    ├─ Let's go together!
        │                                    └─ Choose another (29 starters)
        ▼
Main menu (background world, with wild Pokémon wandering around)
   ├─ Play        → run → summary (+ Pokécoins, shinies caught) → menu
   ├─ Pokémon     → collection by region; choose normal or shiny companion
   ├─ Upgrades    → permanent upgrades
   ├─ Gacha       → 9 banners, one per region
   ├─ Friends     → add by nickname, see online status, invite → lobby (up to 4) → group run
   └─ Leaderboard → survival time: Solo / Group × day, week, month, year, all-time
```

### 2.1 Accounts

- Sign in, create an account, or **play as a guest** (nothing is saved).
- Temporary local implementation behind `js/core/db.js` using `localStorage`.
  Passwords use salt + SHA-256, but this is local and is not real security.
- The session is remembered when the game is reopened.

### 2.2 Personality test

- 8 Mystery Dungeon-style questions; each answer adds trait points.
- The dominant trait selects a companion from the **29 starters**: starters
  from all 9 generations plus Psyduck and Slowpoke. The player can decline and
  choose another.

### 2.3 Cooperative multiplayer (up to 4)

- **Friends by nickname.** Username/password accounts use their username;
  Google accounts choose a unique nickname (their real name is never shown).
- **Lobby:** the inviter is the host; online friends receive an invitation in
  the menu. The host starts the run for everyone.
- **Connection:** direct between browsers (WebRTC, star topology with the host);
  if the network prevents this, use Realtime Database (slower, but works).
- **Authority:** the host controls enemies, objects, experience, and the timer;
  each player controls their Pokémon (position, health, attacks). Hits on
  enemies are sent to the host; teammates' attacks appear as "ghosts."
- **Shared experience**; each player chooses a card on level-up, and the game
  **does not continue until everyone has chosen**.
- **Downed:** you stay on the ground; a teammate standing beside you for 3 s
  revives you with half health. The run ends when everyone is down.
- **Arrows** at the screen edge point to off-screen teammates (name and distance;
  red if downed).
- Difficulty: ×(1 + 0.75·(n−1)) enemies and ×(1 + 0.3·(n−1)) health; team
  experience is divided by (1 + 0.6·(n−1)).
- Pausing does not stop the game; if the host leaves, the run ends for everyone.

### 2.4 Leaderboard

- Survival time. **Solo / Group** tabs; **daily, weekly, monthly, yearly, and
  all-time** periods (Spain time); **everyone or friends only**; **Pokémon
  filter**; your rank is shown below even if you are outside the top 50.
- One entry per player (or team) and table, only when a record improves. In
  group mode, the entire team appears in one row (submitted by the host).
- Basic anti-cheat: server time is recorded at the start; rules reject a time
  longer than the elapsed real time.

## 3. Combat

- The Pokémon **automatically attacks** with the **active move** (1 of up to 4).
- Change the active move with `1`–`4` or `Q`/`E`. Move with `WASD` / arrow keys.
  Pause with `Esc`.
- Each attack plays the appropriate **PMD animation**: `Attack`, `Shoot`, or `Charge`.
- **Target priority:** something touching you > boss in range > nearest enemy >
  (if there are no enemies) nearest rock or chest.
- **52 moves** across 7 families (projectile, melee, beam, orbs, nova, aura,
  buff), each with 5 levels. They cover all **18 types**.
- Each Pokémon's move pool comes from its types plus the shared normal-type pool.
- Buffs do no damage: take one, build it up, then return to an attack move.
  No more than 2 buffs are offered.
- On level-up: **1 of 3 cards**.

## 4. World

An open, infinite arena generated with deterministic noise and rendered in
pixel art in code (16 px per tile, ×2).

| Element | Effect |
|---|---|
| Rock formations | Block walkers and projectiles |
| Water | Slows movement (×0.6 player, ×0.55 enemies) |
| Lava (volcanic biome) | Burns anything that steps on it; enemies can be lured onto it |
| Trees / crystals | Block movement and provide cover from enemy shots |
| Rocks | Breakable; drop XP, coins, or berries |
| Chests | Breakable; good coin drops |
| Tall grass | Cut by any attack; may drop an item |
| **Power altar** | On contact, grants 25 s of Fury (damage ×2), Lightning (+45% speed), Magnet (×4), or Haste (−40% cooldown), then deactivates |
| **Spring** | Heals while standing on it; depletes and recharges in about 45 s |
| **Locked chest** | Stay beside it for 3.5 s (even while attacked): coins, 1–3 tickets (15% chance of ×10), and enough experience for a level |
| **Traps** | Poison, sticky (slows you), or explosive; trigger when stepped on by players or enemies |
| **Rift** | Rare (every 30 s, 14% chance starting at 1:15; lasts 45 s). Takes you to a legendary arena |

- **Flying enemies, ghosts, and bosses** ignore terrain.
- **3 biomes** rotate every 4 minutes, each with its own music:
  Shadow Forest, Crystal Cave, Ashen Volcano. Transitions use a **2.6 s fade**
  between old and new palettes (ground and objects).
- **Rift → arena:** a closed circular area in the *Distortion Rift* biome,
  against a **legendary** (2 min). Win: extra ×10 ticket, 3 tickets, and coins;
  return to where you were. Lose (everyone falls or time runs out): return
  without a reward at 30% health. Map enemies wait during the fight.

### 4.1 Rift arenas (one per type)

The legendary waits in an arena matching **one of its two types, chosen at
random**. Each arena has its own palette, decorations, terrain, weather, and
"rift" music. The legendary collides with walls and pillars like the player and
cannot leave the circle.

| Type | Arena | Terrain | Weather |
|---|---|---|---|
| Normal | Eternal Meadow | pillars | — |
| Fire | Igneous Volcano | lava rivers (burning) | sun |
| Water | Sea Grotto | puddles (slow) | rain |
| Grass | Emerald Jungle | deep swamp, trees | — |
| Electric | Volt Station | charged puddles | rain |
| Ice | Eternal Glacier | ice sheets (slippery) | snow |
| Fighting | Ancestral Dojo | many pillars | — |
| Poison | Toxic Swamp | poison pools | — |
| Ground | Red Desert | quicksand | sand |
| Flying | Sky Peak | cloud trees | — |
| Psychic | Mind Temple | pink crystals, pillars | — |
| Bug | Hive Forest | swamp, lots of grass | — |
| Rock | Ancient Quarry | many pillars and rocks | sand |
| Ghost | Shadow Cemetery | dead trees | fog |
| Dragon | Dragon Shrine | dragon flames (burning) | — |
| Dark | Dark Alley | pillars | — |
| Steel | Steel Fortress | many pillars | — |
| Fairy | Enchanted Forest | pink trees, fountains | — |

Terrain immunities: Fire to lava; Poison/Steel to poison; Electric/Ground to
electric discharges; Ice to ice. The legendary is immune to its arena.

### 4.2 Weather (rare event)

Starting at minute 2, there is an 18% chance of weather each minute (lasts about 1 minute):

| Weather | Effect |
|---|---|
| Harsh sunlight | Fire ×1.5 · Water ×0.5 |
| Rain | Water ×1.5 · Electric ×1.2 · Fire ×0.5 |
| Sandstorm | Rock, Ground, and Steel ×1.3; all others lose 1.2% health every 2 s (never KO) |
| Snow | Ice ×1.5; all others lose health at the same rate and move 10% slower |
| Fog | Ghost, Fairy, and Psychic ×1.3; vignette closes slightly |

Weather affects everyone (player and enemies). Each biome favors certain
weather. Visuals are subtle: slight tint and a few pixel particles. In co-op,
the host chooses the weather.

### 4.3 Type chart (softened)

Based on the games, but uses ×1.6 / ×0.6 / ×0.3 instead of ×2 / ×0.5 / ×0
(with only one active attack, complete immunity could make enemies impossible).
Dual types multiply, capped at ×0.3–×2.4. Player attacks use the move's type;
enemies use their primary type (or their projectile's type). A yellow number
indicates super-effective damage; gray indicates not very effective (no text,
to keep the screen clear).

## 5. Enemies

- **All generations.** 6 tiers by total base stats; each run randomly selects
  7 Pokémon per tier, so every run is different.
- Type-based AI: chase, telegraphed charge (`Charge` → `Attack`), ranged shot,
  or tank.
- **5 bosses** (minutes 3, 6, 9, 12, 15): randomly selected strong
  **non-legendaries** (pseudo-legendaries, Slaking, etc.), growing stronger
  each time; each drops a **×10 ticket**. Legendaries appear only in rifts.
  During a boss fight, waves drop to 25%, there are no tides, and boss music plays.
- Tides every ~45 s. Maximum **280** enemies at once; after the cap, new
  spawns are elite (×1.6 health and experience, ×1.25 damage).
- **Pathfinding:** distance field (BFS) around each player; walkers go around
  rocks, walls, and dangerous puddles. Only Pokémon that **float in their
  sprite** (`hv` in sprites-meta, `tools/hover_flags.py`) fly: Rowlet and Pidgey
  walk despite being Flying types; Gastly and Zubat float.

### 5.1 Personalities

Each enemy tier in a run includes at least 2 enemies with a personality (1 in
the first tier, to help players learn). Telegraphs appear on the ground first.

| Personality | Examples | Behavior |
|---|---|---|
| Healer | Chansey, Blissey, Audino, Clefairy... | Heals nearby allies by 15% every 3.5 s |
| Shield | Shuckle, Bronzong, Mr. Mime, Bastiodon... | Gives 6 allies a shield worth 35% of health |
| Summoner | Nidoqueen, Vespiquen, Golbat, Gyarados... | Calls 2 pack members (Nidoran, Combee...) |
| Kamikaze | Voltorb, Electrode, Koffing, Geodude... | Approaches and explodes (1 s warning) |
| Beam | Electric, Psychic, Dragon, some Ice | Beam with a warning strip |
| Zones | Fire, Ground, some Poison | Circles under the player's feet that explode |
| Fan | Water, Grass, Bug, some Fairy | 3 fan shots (5 later) |
| Jumper | Fighting, Ground, Normal, some Rock | Jumps and lands where the player was |

## 6. Shinies

- **Wild:** every enemy has a **1/4096** chance to be shiny (bosses too).
  It sparkles, has double health, grants ×5 experience, does not disappear if
  you move away, and an edge-of-screen arrow points to it.
  **Defeat it to keep it** (and the normal version if not already owned). If
  the shiny is already owned, receive +300 coins.
- **Gacha:** 1 in 100 pulls is shiny. Duplicate shiny = triple coins.
- **Collection:** a **Normal / Shiny** selector appears on a Pokémon's entry if
  its shiny is owned; choose either form as your companion.
- 958 of the 966 Pokémon have an authentic SpriteCollab shiny sprite.

## 7. Progression

### 7.1 Pokécoins

At the end of a run: `time/5 + defeated/4 + 80 per boss + collected coins`,
multiplied by the Fortune upgrade. New account: 500 coins as a gift.

Coins are used for **upgrades**; gacha uses tickets.

### 7.2 Permanent upgrades — per Pokémon

Vitality, Strength, Stride, Reflexes, Armor, Synthesis, Magnet, Wisdom, Fortune,
and **Move Set (start with 2 moves)**. Each Pokémon has its own upgrades; they
apply only when playing as that Pokémon (choose it in the Upgrades screen).
Upgrades purchased when upgrades were account-wide were assigned to the
companion active at the time.

### 7.2a Equippable items (one per run)

Leftovers, Choice Band, Quick Claw, Focus Sash, Shell Bell, Amulet Coin, Lucky
Egg, Life Orb, Choice Scarf, Rocky Helmet, and Assault Vest. Dropped by **all
bosses**, locked chests (50%), and sometimes regular chests (8%). If already
carrying one, choose which to keep (the game pauses in solo mode).

### 7.2b Gacha tickets

- **Ticket** (×1): each defeated Pokémon has a 1/400 chance to drop one; locked
  chests give 1–3.
- **×10 ticket:** bosses, rift legendary (2), and sometimes locked chests.
- In a group, tickets belong to the team: everyone receives those collected.

### 7.2c Move evolution

A max-level move evolves if its condition upgrade was collected during that
run (Ember + Power → Fire Blast, Bubble + Dash → Surf, etc.): a **gold card**
appears (always, if available). All 47 attack moves can evolve.

### 7.2d Missions, achievements, and profile

- **3 daily + 2 weekly** (ticket and coin rewards); one daily can be rerolled
  per day. Missions are the same on every computer (account-based seed).
- **Achievements** award bronze, silver, or gold medals, rewards, and sometimes
  **titles**; there is one for each **legendary** defeated in a rift.
- **Public profile** (from leaderboard or friends list): 3 favorites, title,
  best records, and the 8 highest medals.

### 7.3 Gacha — one banner per region

Kanto, Johto, Hoenn, Sinnoh, Unova, Kalos, Alola, Galar, and Paldea, each with
**its Pokémon, 3 featured Pokémon, and its own pity counter**.

| Rarity | Chance | Duplicate refund |
|---|---:|---:|
| Common | 45% | 15 |
| Uncommon | 30% | 30 |
| Rare | 17% | 60 |
| Epic | 6.5% | 120 |
| Legendary | 1.5% | 300 |
| *Shiny* | *1% (any rarity)* | *×3* |

- ×1 pull: 1 ticket · ×10: **10 regular tickets or 1 ×10 ticket** (two buttons,
  choose how to pay), with at least one **Epic** guaranteed. Duplicates still
  grant coins.
- **Pixel-art slot-machine animation** (lever, 3 reels, bulbs). Symbols show
  rarity: Poké, Great, Ultra, Luxury, and Master Ball (Legendary), plus a red
  star (shiny). For Epic or better, the last reel waits longer. ×10 is 10 quick
  pulls that drop into the tray. Click to speed it up.
- **Pity:** after 70 pulls without a Legendary on a banner, the next one is Legendary.
- Some regions have almost empty rarities (Galar has only 4 Uncommon Pokémon);
  if a banner has no Pokémon at a rarity, the nearest available rarity is used.

## 8. Music and sound

Composed for the game and played by a Web Audio synthesizer (flute, marimba,
plucked guitar, bass, pad, lead, and drums, with reverb). No audio files.

| Theme | Where | Style |
|---|---|---|
| Village | Menus | F major, 100 bpm with swing, flute and marimba |
| Forest | Run (forest) | Adventurous D minor, 122 bpm |
| Cave | Run (cave) | Mysterious A minor, 92 bpm, bells |
| Volcano | Run (volcano) | Tense E Phrygian, 132 bpm |
| Boss | Boss fight | Intense E minor, 150 bpm |

- Effects for buttons, each attack family (with pitch based on type), hits,
  falls, experience (pitch rises during a streak), coins, levels, bosses,
  shinies, breakage, and gacha (drop, shakes, rarity-based burst).
- Music/effect volume and mute button in the top bar and pause menu; settings
  are remembered in the browser.
- Measured: all 5 themes playing together (RMS 0.075–0.09), without clipping
  even during a boss fight.

## 9. Interface

- **No emoji.** Pixel-art icons drawn in code (`js/ui/icons.js`): each move has
  its **type emblem** (18) plus a **family badge**, along with heart, glove,
  boot, clock, shield, sprout, magnet, book, coin, cards, berry, bomb, star,
  shiny sparkle, crown, Poké Ball, and more.
- Always draw at integer multiples of the source resolution so pixels stay crisp.

## 10. Technology

- Vanilla HTML + CSS + JavaScript on Canvas 2D. No build step or dependencies.
- **Sprites:** [SpriteCollab](https://github.com/PMDCollab/SpriteCollab), 966
  Pokémon × 7 animations × 8 directions, normal and shiny, in `assets/pokemon/`
  (76 MB, lossless palette PNG). **CC BY-NC 4.0: non-commercial use and
  attribution** (114 artists in `CREDITS.md`).
- **Data:** base stats and Spanish names downloaded **once** from PokeAPI.
- **Font:** Pixelify Sans (OFL).
- Generated files are recreated using scripts in `tools/`.

## 11. Planned

- [ ] Type effectiveness in damage calculations
- [ ] Custom projectile graphics (currently colored orbs)
- [ ] Pokémon-specific moves (currently selected by type)
- [ ] Touch / controller controls
- [ ] 59 Pokémon without SpriteCollab sprites (mostly generations 5, 8, and 9)

---

## Decision log

**2026-10-07 · first version**
- Vanilla stack + Canvas. One active move, switched with 1–4. Combat first.

**2026-10-07 · second version**
- Everything local: runtime API removed.
- Mystery Dungeon sprites (SpriteCollab) with attack animations.
- Tiles drawn in code (PMD tiles are only available by ripping the ROM).
- Map: **open arena with obstacles** (not strict PMD rooms and corridors).
- Saves: `localStorage` behind one data layer.

**2026-10-07 · third version**
- **All generations** (966 with sprites). Gacha: **one banner per region**.
- **Shinies:** 1/4096 in the wild, 1/100 in gacha; choose a normal or shiny
  companion from the collection.
- **Music composed in code** (Nintendo music cannot be used) + sound effects.
- **No emoji:** custom pixel-art icons.

**2026-10-07 · combat fix**
- Bug: projectiles spawned at the Pokémon's edge and moved up to 8 units per
  frame, so **enemies next to the player were immune** to every projectile move
  (in a survivor game, something is almost always close). Projectiles now spawn
  at the center and collision is swept across the full frame segment. In a
  10-minute simulation, the result improved from 0 to 1 boss defeated per run.
- Demo videos in `videos/` (boss, wild shiny, shiny from the gacha).

**2026-10-07 · effects and visual polish**
- **Pixel-art attack sprites** (`js/entities/vfx.js`): 23 shapes (flame, drop,
  bubble, leaf, lightning, crystal, rock, mud, sting, star, wind, web, wave,
  crescent, sound, impact, claw, jaws, arrow, orb, shadow ball, heart, etc.)
  painted with each type's palette and outlined like PMD sprites. Beams use
  streams (flames, water, electric zigzag, crystals); hits use pixelated
  crescents with extra details (jaws, claws, impact, leaves/feathers); auras
  and buffs use type particles; trails include embers, drops, poison bubbles,
  and dust. Enemy shots use the enemy's type and have a red ring on the ground.
- **Consistent pixel size across the interface** (×2): large legendaries looked
  out of place when drawn at ×1. Bosses use 0.5 increments.
- **Shiny:** pixel-art gem marker and animated pixel sparkles.
- **Menu companion:** dark panel with a border in its type color.
- **Targeting:** ranged attacks prioritize bosses; melee attacks prioritize
  whatever is closest to the player.

**2026-10-07 · database and publishing**
- **Firebase** (Authentication + Firestore): username/password or Google
  accounts; saves available on any computer. Local copy for offline play,
  real-time updates from other computers, and **merge** on sync (collections
  combined, maximum upgrade/stat values retained, coins and companion from the
  newest version). Rules: each player accesses only `saves/{their uid}`. Old
  local accounts upload on sign-in with the same username and password. Tested
  with the official emulator in two browsers.
- Without configuration or when opened with a double-click, the game stays local.
- **Legal notice and privacy** with a content-removal contact and account-delete
  button. Open-source code (MIT) on GitHub (JPTER78).
- Measures NOT taken on request: rename to remove "Pokémon" and remove sprites
  ripped from the games (CHUNSOFT).

**2026-10-08 · new name**
- Renamed to **PokéSurvivor** (without "Pokémon" in the title, like PokéRogue
  or Showdown). Repository: `pokesurvivor`.
- New Firebase project **`pokesurvivor-jpter`** (Firestore in eur3, email/
  password and Google enabled, domains `jpter78.github.io` and `localhost`).
  Projects `pokemon-survivors-jpter` and `asdaad-9e84f` were deleted (recoverable
  for 30 days in Google Cloud).

**2026-10-09 · mobile and settings**
- **Playable in landscape on phones and tablets** (portrait shows "Rotate your
  phone" and pauses the run). **Floating joystick** appears where the player
  touches. Tap attack icons to switch moves (also clickable on PC); pause button
  added. Switching apps pauses automatically.
- Camera maintains a minimum world height on very wide screens.
- Compact UI on short screens (two-column menu, smaller top bar, credits moved
  to Settings → About).
- **Settings** (PC and mobile): sound; graphics (Auto/High/Medium/Low quality,
  damage numbers, reduced shake and flashes, FPS, fullscreen); controls
  (joystick size, keys); account (fixed nickname, cloud, sign out, delete);
  About (version, credits, legal notice, contact).
- **Automatic quality:** lowers effects below 45 FPS.
- **Installable app** (PWA: icon, fullscreen, works offline).
- Fixes: extra orb on improved orbit moves; mobile audio startup; summoners obey
  the enemy cap; clear notice if a game file fails to load.

**2026-10-09 · minimize Firebase usage (free plan)**
- **Leaderboard summaries:** one `lbs/{table}` document with the top 50 for
  each table (1 read per tab instead of about 52), cached in the browser for
  10 minutes; personal records are remembered to avoid reading before writing.
  Pokémon filter is **all-time only** (half as many writes).
- Approximate **online status** through Firestore (`pres/`, heartbeat every
  10 minutes, read when Friends or the lobby opens) and **invitations through
  Firestore** (`inv/`). Realtime Database connects only inside a room: the free
  plan's 100-connection limit no longer affects regular players.
- **Cloud saves** at most every 30 seconds (and on close), without listening to
  the player's own document in real time; public profile at most every 10 minutes.
- Emulator measurement: viewing all leaderboard data twice went from 1,275
  reads to 20; finishing a run went from 12 to 3.
- Fewer but stronger on-screen Pokémon (×0.45 count, ×2.1 health, ×1.35 damage,
  ×2.6 experience); removed "Super effective!" messages.

**2026-10-08 · multiplayer, friends, and leaderboard**
- **Co-op for up to 4** with a **friends list** (no room codes or public rooms).
  Shared experience and **cards that wait for everyone**; revive a downed
  teammate by staying beside them.
- **Direct WebRTC** connection with signaling over **Realtime Database**
  (new `pokesurvivor-jpter-default-rtdb` instance, europe-west1), with relay
  through that same database if direct connection fails. No custom server or
  paid TURN.
- **Unique nickname** for friends and leaderboard; Google accounts choose one
  on first sign-in (their real name is not shown).
- **Survival-time leaderboard:** Solo / Group, daily through all-time, friends,
  by Pokémon, and your rank. Groups appear as one row.
- Privacy notice: browsers connect directly in group play and may reveal IP
  addresses (as in a video call).

**2026-10-08 · Pokémon upgrades, tickets, rifts, and interactables**
- **Per-Pokémon upgrades**, not account-wide; purchased upgrades transfer to
  the current companion. Coins are used only for upgrades.
- **Gacha tickets** earned through play (no initial gift or coin conversion):
  ×1 from regular Pokémon (1/260), ×10 from legendaries (always) and bosses
  (one in three).
- **Casual non-legendary bosses**; legendaries appear only in **rifts**
  (separate arena; losing gives no reward). In co-op everyone travels together.
- **Altars, springs, locked chests, and traps**, with custom pixel art.
- **Biome fades** replace abrupt transitions.
- Pokédex: PokeAPI `leg` field (legendary or mythical).

**2026-10-08 · weather, type chart, and slot machine**
- **Weather** as a rare event (sun, rain, sand, snow, fog), with subtle visuals.
- **Softened type chart** in both directions.
- Gacha uses a **pixel-art slot machine** instead of a Poké Ball.

**2026-10-08 · type-specific arenas**
- Bug fix: legendaries (bosses are flyers) passed through arena rocks and could
  not be shot (Celebi). They now collide and cannot leave the circle.
- 18 rift arenas, one per type, with affecting terrain and unique weather;
  new rift music.

**2026-10-08 · more Pokémon-like icons**
- Shiny marker changed from a gem to a **red star** with a sparkle (like the
  games' shiny marker).
- Rarity no longer uses stars; each rarity has its own **Poké Ball** — Poké
  (Common), Great (Uncommon), Ultra (Rare), Luxury (Epic), and **Master (Legendary)**.

**2026-10-08 · camera, performance, and AI**
- Camera moved 20% farther back (768 world-width instead of 640).
- Performance: hit flash used `ctx.filter` (×95 more expensive than a
  precalculated white silhouette, now used); cap of 70 damage numbers; internal
  resolution at most ×1.5; less off-screen work; cap of 280 enemies, with elites
  spawning once the cap is reached.
- Enemies go around obstacles; only those that float in their sprites fly.

**2026-10-08 · missions, achievements, items, evolutions, and personalities**
- Missions 3+2, achievements with rewards and titles, public profiles (visible
  to everyone).
- One-use-per-run equippable items (from chests and bosses).
- Move evolution: max level + condition, then a gold card.
- Enemy personalities: healers, shields, summoners, and telegraphed attacks
  (beams, zones, kamikazes, fans, jumps). Tuned with an autoplayer: average
  survival is similar to before (89 s vs. 60 s).

**2026-10-10 · final details before the website**
- Water-type Pokémon are not slowed by water or swamp.
- Leveling is half as fast (experience per level ×2).
- Fewer simultaneous enemies (cap 64), but much tougher. Enemies left behind
  while running fade out and respawn ahead, preventing a trailing queue and
  endless escape. One "runner" per tier (fast and fragile, heads toward where
  the player will be).
- Bosses and legendaries have 4 telegraphed attacks (stomp, charge or jump,
  plus two ranged attacks based on type: zones, fan beams, ring, or fan shots).
  They alternate between chasing and ranged combat and enrage below half health.
  More health (×1.35) and damage (×1.2).
- Rifts: large pulsing arrow with distance and timer, plus a unique opening notice.
- "Tap to start" screen (browsers require a user gesture for audio); music also
  plays on login and during the personality questions.
- 8 new attack shapes using existing graphics: boomerang, chain, mines,
  meteors, turret, charge, trail, and short fan. 7 moves switched to these
  shapes (same IDs) and 12 new moves added (64 total).
- Anti-cheat: server rejects impossible level/defeat counts for elapsed time;
  game monitors clock, health, speed, attacks, level, coins, and test tools. If
  something is inconsistent, the run does not count toward leaderboard or records.
- Mid-run events every 4–5 min (`systems/events.js`): type horde (30 s), golden
  hour (30 s, double experience and coins), and lost Pokémon (take it to the
  marker for healing, coins, a ticket, and a 1-in-5 chance it joins you).
  1–2 treasure sprites per run: Meowth (coins) or Gholdengo (×10 ticket;
  Gimmighoul has no sprite). They flee and escape after 15 s. Shared in co-op.
- Later (2026-10-10): level-ups slowed by half again (experience per level ×4
  relative to the original); ×1 tickets made rarer (1/400 instead of 1/260).
  Mission levels 8/12/15 and achievement levels 15/30 (previously 12/16/20 and
  20/40).
