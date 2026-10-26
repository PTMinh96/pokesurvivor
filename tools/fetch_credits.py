#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Genera CREDITS.md con los artistas de cada sprite descargado.

    python tools/fetch_credits.py

Cada carpeta de SpriteCollab tiene un credits.txt (sin cabecera) con lineas
    fecha <TAB> autor <TAB> ...
donde el autor es un nombre o un ID de Discord ("<@!123...>"). Los IDs se
traducen con el credit_names.txt de la raiz del repo.
"""
import io
import os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RAW = 'https://raw.githubusercontent.com/PMDCollab/SpriteCollab/master'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'assets', 'pokemon')
OUT = os.path.join(ROOT, 'CREDITS.md')


def fetch(url):
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'pokesurvivor/1.0'})
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.read().decode('utf-8', 'replace')
    except Exception:
        return ''


def main():
    # Discord ID / alias -> (display name, contact)
    names = {}
    for line in fetch(f'{RAW}/credit_names.txt').splitlines()[1:]:
        parts = line.split('\t')
        if len(parts) >= 2:
            display = parts[0].strip()
            contact = parts[2].strip() if len(parts) > 2 else ''
            names[parts[1].strip()] = (display, contact)
            names[display] = (display, contact)

    dexes = sorted(int(d) for d in os.listdir(ASSETS) if d.isdigit())

    def one(dex):
        # Credits for the normal sprite and shiny sprite (which may have a different artist).
        txt = fetch(f'{RAW}/sprite/{dex:04d}/credits.txt')
        if os.path.isdir(os.path.join(ASSETS, str(dex), 's')):
            txt += '\n' + fetch(f'{RAW}/sprite/{dex:04d}/0000/0001/credits.txt')
        authors = []
        for line in txt.splitlines():
            parts = line.split('\t')
            a = parts[1].strip() if len(parts) > 1 else ''
            if a and names.get(a, (a, ''))[0]:
                authors.append(a)
        return dex, authors

    per_artist = {}
    with ThreadPoolExecutor(max_workers=12) as ex:
        for dex, authors in ex.map(one, dexes):
            for a in set(authors):
                display, contact = names.get(a, (a, ''))
                per_artist.setdefault((display, contact), set()).add(dex)

    with io.open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('# Credits\n\n')
        f.write('## Sprites\n\n')
        f.write('The *Pokémon Mystery Dungeon*-style sprites come from\n')
        f.write('[SpriteCollab](https://github.com/PMDCollab/SpriteCollab), under the\n')
        f.write('[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) license:\n')
        f.write('**non-commercial use** with attribution to the artists.\n\n')
        f.write('| Artist | Contact | Sprites (Pokédex numbers) |\n|---|---|---|\n')
        for (display, contact), dx in sorted(per_artist.items(), key=lambda kv: kv[0][0].lower()):
            nums = ', '.join(str(d) for d in sorted(dx))
            f.write(f'| {display} | {contact} | {nums} |\n')
        f.write('\n## Data\n\n')
        f.write('Base stats and Spanish names: [PokeAPI](https://pokeapi.co/),\n')
        f.write('downloaded once and stored in `js/data/pokedex.js`.\n\n')
        f.write('## Trademark\n\n')
        f.write('Pokémon is owned by Nintendo, Creatures Inc., and GAME FREAK.\n')
        f.write('This is a non-profit fan project.\n')

    print(f'{len(per_artist)} artistas para {len(dexes)} Pokemon -> CREDITS.md')


if __name__ == '__main__':
    main()
