# PokéSurvivor · Mystery Dungeon

A Pokémon bullet-heaven game in the style of Survivor.io and Megabonk, using
*Pokémon Mystery Dungeon* sprites, roguelike progression, **966 Pokémon from all
9 generations**, shinies, and regional gacha banners. Original music and sound
effects composed for the game.

Vanilla HTML + CSS + JavaScript on Canvas 2D. No build step or dependencies;
**everything is local** and the game does not need an internet connection.

> **Authorship**
>
> PokéSurvivor (its code and original music) was written by and belongs to
> **Jonathan Piera Torregrosa**, owner of this account (JPTER78) and
> pokesurvivor.com. The source code and original music of PokéSurvivor are
> written and owned by **Jonathan Piera Torregrosa**, owner of this GitHub
> account (JPTER78) and pokesurvivor.com. Google copyright removal request
> **4-2352000042234** (against pokesurvivor.co) was submitted by me.

> **Crypto disclaimer**
>
> PokéSurvivor has **no official cryptocurrency, token, or NFT**, and I have not
> created any. Any token using the game's name was created by third parties.
> **I take no responsibility for any purchase, sale, or investment** you make
> with them, and nothing here is investment advice. The game is free and will
> stay free.

## Play

Double-click `index.html`. Create an account or continue as a guest, take the
personality test, and head into the dungeon.

| Key | Action |
|---|---|
| `W` `A` `S` `D` / arrow keys | Move |
| `1` `2` `3` `4` | Select the active move |
| `Q` / `E` | Cycle through moves |
| `Esc` / `P` | Pause |

**On a mobile phone or tablet** (in landscape): touch and drag anywhere to move
(the joystick appears where you touch), tap an attack at the bottom to switch
it, and tap the top-right button to pause. The game can be installed as an app
("Add to Home Screen"). **Settings** include sound, graphics quality (with an
automatic mode), damage numbers, reduced screen shake, FPS, and account options.

Your Pokémon attacks automatically with the active move (or with all moves in
a **link**: each defeated legendary lets you fuse moves and fire them together
from one slot, up to 4). Rocks, chests, and tall grass can be broken; walls and
trees block enemy projectiles; water slows you and lava burns (including enemies).

The map contains **power altars**, healing **springs**, **locked chests** (stay
beside one for a few seconds), and **traps** that can also hurt enemies. A
**rift** sometimes opens: enter it to fight a **legendary** in a separate arena.

There is a **type chart** (Bubble Beam deals more damage to Charmander, for
example) and occasional **weather** (sun, rain, sand, snow, fog) that boosts
some types and weakens others.

Daily and weekly **missions** award tickets and coins; **achievements** award
medals and titles, and your **profile** shows your three favorite Pokémon,
records, and medals. Runs contain **items** (Leftovers, Choice Band, and more),
and moves **evolve** at their maximum level. Enemies have different behaviors:
some heal, shield, call their pack, or attack with a warning marker on the ground.

**Upgrades** are specific to each Pokémon. The **gacha** uses **tickets** earned
by playing (×1 from some Pokémon, ×10 from bosses and legendaries), with a
pixel-art slot machine.

Each enemy has a 1/4096 chance to appear **shiny**: it sparkles, an edge-of-screen
arrow shows its location, and defeating it adds it to your collection. The
gacha has a 1-in-100 shiny chance. In the collection, choose a normal or shiny
version as your companion.

Music starts after the first click (browsers do not allow audio before user
interaction). Adjust the volume or mute with the speaker button at the top right
or in the pause menu.

Saves are stored in the browser's `localStorage`: clearing site data deletes them.

The `videos/` directory contains gameplay recordings (with music): a boss fight,
a wild shiny capture, and a shiny from the gacha.

## Cloud saves and publishing

- **Database (Firebase):** accounts with a username and password or Google
  sign-in, with saves available on any computer. Setup steps are in
  [docs/FIREBASE.md](docs/FIREBASE.md). Without configuration, the game saves
  only in the browser, as before.
- **Play with friends (up to 4) and leaderboard:** with a cloud account, use
  the **Friends** menu (add by nickname, invite to your room) and **Leaderboard**
  (survival time: solo or group, today through all-time, friends, by Pokémon).
- **Publish for free on GitHub Pages:** [docs/PUBLICAR.md](docs/PUBLICAR.md).
- If you play on two computers at once or offline, saves are **merged**:
  collections are combined (a Pokémon or shiny is never lost), upgrades and
  statistics keep their maximum values, and coins and companion use the latest
  version. Changes from another computer arrive in real time.

## License

Code has been under [PolyForm Noncommercial 1.0.0](LICENSE-NONCOMMERCIAL.md)
since 2026-10-14: it may be used, studied, and modified, but **not for
commercial purposes** (including selling the game or charging for anything
inside it). Versions through commit `b297089` were released under MIT. Sprites
(CC BY-NC 4.0), the font (OFL), and Pokémon trademarks have their own terms:
see [LICENSE](LICENSE) and [CREDITS.md](CREDITS.md). This is a non-profit fan project.

**The only official website is [pokesurvivor.com](https://pokesurvivor.com).**
The game is and will remain free: if anyone asks you to pay, it is not us.

## Structure

```
index.html              screens + load order
css/style.css           Mystery Dungeon-style interface
assets/pokemon/{dex}/   PMD sprite sheets (Idle, Walk, Attack, Shoot, Charge, Hurt, Faint)
assets/pokemon/{dex}/s/ the same sprites in shiny form
assets/fonts/           Pixelify Sans (OFL) and its version with redrawn numerals (tools/make_font.py)
js/
  net/      social (nickname, friends, rooms), net (WebRTC + relay),
            coop (group run), leaderboard
  core/     util, db (saves), audio (synthesizer + effects), input,
            sprites (PMD animator), camera
  data/     pokedex*, sprites-meta*, moves, starters (+ test), enemies,
            upgrades, music (scores)
  world/    tiles (pixel art in code), world (terrain, objects, collisions)
  entities/ player, enemy, projectile, pickup, fx
  systems/  combat, spawner, levelup, gacha
  ui/       icons (pixel art), ui, hud, login, test, menu, gacha-ui, run-ui,
            social-ui, ranking-ui
  game.js   main flow and loop
tools/      scripts that regenerate files marked with *
```

`*` = generated. To regenerate them (requires Python 3, Pillow, and internet
access once):

```
python tools/fetch_sprites.py    # normal and shiny sprites + js/data/sprites-meta.js
                                 # (~20 min; can be stopped and resumed: uses tools/cache/)
python tools/fetch_pokedex.py    # js/data/pokedex.js
python tools/fetch_credits.py    # CREDITS.md
```

## Implementation notes

- **PMD sprites.** Columns are frames; rows are 8 directions (Down, DownRight,
  Right, UpRight, Up, UpLeft, Left, DownLeft — verified against `-Offsets.png`).
  Each animation has its own frame size, so animations are aligned by the
  **ground anchor** obtained from `-Shadow.png`; otherwise the sprite would jump
  when attacking.
- **Coordinates.** An entity's `(x, y)` are its **feet**. Collisions take place
  on the ground plane; projectiles travel on that plane and are drawn elevated
  with their shadow underneath.
- **World.** 16×16-tile chunks: *data* (terrain, objects) is cheap and generated
  as needed; the *image* is baked at art resolution into an `ImageData` (~4 ms
  per chunk in Chrome) and only for visible chunks.
- **Performance.** Enemy spatial grid rebuilt every frame. With 420 enemies,
  full simulation + rendering takes about 3 ms per frame in Chrome.
- **Metadata in `.js`, not `.json`**, because `fetch()` is blocked on `file://`.
- **Shinies.** SpriteCollab shinies use the same drawing with a different palette;
  they are in `s/`, and only 30 have different geometry (the `sa` field in
  metadata). Sheets are stored as PNGs with an exact palette: same image, half
  the file size.
- **Audio.** Web Audio synthesizer with look-ahead scheduling (notes are
  scheduled 150 ms ahead) and convolution reverb using a generated impulse.
  Scores are in `js/data/music.js` in a custom text format. Effects have a
  minimum interval between repeats and a voice limit, so 400 enemies being hit
  at once will not overload audio.
- **Icons.** Character maps are converted to canvas and data URLs; always use
  integer multiples of their size so pixels stay crisp.

## Credits and license

Sprites from [SpriteCollab](https://github.com/PMDCollab/SpriteCollab) under
**CC BY-NC 4.0** — **non-commercial use** with attribution; the artist list is
in [`CREDITS.md`](CREDITS.md). Pokémon is owned by Nintendo, Creatures Inc., and
GAME FREAK. This is a non-profit fan project.
