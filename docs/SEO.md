# SEO and the pokesurvivor.com domain

All technical work is already prepared in the code. The remaining tasks require
your action (buying the domain, configuring DNS, and registering the site with Google).

## What is already prepared

| File | Purpose |
|---|---|
| `index.html` | Search-oriented title and description ("free online Pokémon game", "Survivor.io style"), canonical URL, social cards (Open Graph / Twitter), structured `VideoGame` data (free, 1–4 players, browser/Android/iOS), and real content displayed while the game loads (with an `<h1>`). |
| `guia/` | Game guide with instructions, features, tips, and **frequently asked questions** (`FAQPage` data that Google may show as expandable search results). |
| `pokedex/` | The 966 playable Pokémon with their types and sprites: attracts searches such as "free game with Pikachu." |
| `404.html` | Not-found page with links to the game (GitHub Pages uses it automatically). |
| `robots.txt` | Allows crawling everything except `tools/` and `docs/`, and points to the sitemap. |
| `sitemap.xml` | Lists the pages to be indexed. |
| `assets/og-image.jpg` | The image shown when the link is shared (1200×630). |
| `manifest.webmanifest`, icons | Installable app, browser icon, and mobile icon. |

Regenerate the pages with `python tools/make_seo_pages.py` (for example, when
the Pokémon or features change).

> **Important:** canonical URLs already point to `https://pokesurvivor.com/`.
> Do not publish these changes until the domain works, or Google will try to
> index a domain that does not exist yet.

## 1. Domain

Steps for setting up pokesurvivor.com (Cloudflare DNS, GitHub Pages, Firebase,
and the final step) are in [DOMINIO.md](DOMINIO.md).

## 2. Google Search Console (most important)

1. Go to <https://search.google.com/search-console> using your Google account.
2. **Add property → Domain** → `pokesurvivor.com`.
3. Google provides a **TXT** record: add it to DNS (name `@`) and click Verify
   (it may take a few minutes).
4. **Sitemaps** → submit `sitemap.xml`.
5. **URL Inspection** → `https://pokesurvivor.com/` → **Request indexing**.
   Repeat for `/guia/` and `/pokedex/`.

Bing (and with it DuckDuckGo and Ecosia): go to
<https://www.bing.com/webmasters> → **Import from Google Search Console**.

## 3. What helps rankings most (off-site)

Google promotes sites that are linked to by other sites and that people search for by name:

- **YouTube trailer** with the link on the first line of the description and the
  title "PokéSurvivor – Free Pokémon game in your browser."
- **itch.io**: create a free game page in the HTML5 category and link to the site.
- **Reddit**: r/PokemonROMhacks, r/incremental_games, r/WebGames, r/survivorslikes
  (read their rules; many users like free fan games without ads).
- **Discord**: Pokémon fan-game and "survivors-like" servers.
- **TikTok / Shorts** with 15-second clips (shinies, legendaries, co-op).
- Ask players to link to or share the game: every link helps.

## 4. Over time

- Review the **searches** bringing visits in Search Console and add answers to
  those questions to the guide.
- For every major update, add a new post (for example in `novedades/`) and add
  it to the sitemap.
- Pages load quickly (Lighthouse: guide and Pokédex 100/100/100/100).

## Notice

"Pokémon" is a registered trademark. The PokéSurvivor name and domain may
attract notices from The Pokémon Company; the legal notice and non-commercial,
non-profit nature of the project help, but do not remove that risk.

## Current development workflow (important)

- **Edit `dev.html`** (and the `js/` files), not `index.html`. `dev.html` loads
  each script separately for development; `index.html` is the release version,
  with everything in a single `js/app.min.js` (the homepage loads much faster).
- Before testing the final version or publishing:

```
node tools/build.js            # dev.html -> index.html + js/app.min.js
node tools/export_data.js      # game data for the pages
python tools/make_seo_pages.py # Spanish and English pages, en/index.html, sitemap
```

## Languages

- The game opens in **English or Spanish** according to the browser language;
  change it in Settings → Graphics → Language. `/en/` opens the game in English.
- English text: `js/data/lang-en.js` (keys are the Spanish source text). When
  adding a new in-game text, add its translation there too.
- Pages: guide, Pokédex, legendaries, shinies, types, moves, items, achievements,
  and news; each is available in both languages and linked with hreflang.
