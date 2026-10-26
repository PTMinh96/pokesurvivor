#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mark which Pokémon ACTUALLY HOVER in their sprites (and can therefore pass
over rocks and water) and which ones walk despite being Flying types.

    python tools/hover_flags.py

Check each Pokémon's first Idle frame (facing down): if its lowest opaque pixel
is clearly above the ground anchor (the shadow), it hovers. Add "hv":1 to those
Pokémon in js/data/sprites-meta.js.
"""
import io
import json
import os
import re

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
META = os.path.join(ROOT, 'js', 'data', 'sprites-meta.js')
ASSETS = os.path.join(ROOT, 'assets', 'pokemon')
GAP = 1          # art pixels between the feet and ground (walkers return <= -0.5)

LINE = re.compile(r'^(\s*)(\d+): (\{.*\}),\s*$')


def gap_of(dex, idle):
    path = os.path.join(ASSETS, str(dex), 'Idle.png')
    if not os.path.exists(path):
        return 0
    im = Image.open(path).convert('RGBA')
    w, h = idle['w'], idle['h']
    frame = im.crop((0, 0, w, h))
    alpha = frame.getchannel('A')
    bbox = alpha.point(lambda a: 255 if a > 40 else 0).getbbox()
    if not bbox:
        return 0
    bottom = bbox[3] - 1                     # row of the lowest opaque pixel
    return idle['ay'] - bottom


def main():
    with io.open(META, encoding='utf-8') as f:
        lines = f.read().split('\n')
    out, hovering = [], []
    for ln in lines:
        m = LINE.match(ln)
        if not m:
            out.append(ln)
            continue
        dex = int(m.group(2))
        data = json.loads(m.group(3))
        data.pop('hv', None)
        idle = data['a'].get('Idle') or data['a'].get('Walk')
        if idle and gap_of(dex, idle) >= GAP:
            data['hv'] = 1
            hovering.append(dex)
        out.append(f"{m.group(1)}{dex}: {json.dumps(data, separators=(',', ':'))},")
    text = '\n'.join(out)
    if ' *                 hv=1 if its sprite hovers' not in text:
        text = text.replace(' *                 sm animations missing from the shiny version',
                            ' *                 sm animations missing from the shiny version\n'
                            ' *                 hv=1 if its sprite hovers (tools/hover_flags.py):\n'
                            ' *                 can pass over rocks and water')
    with io.open(META, 'w', encoding='utf-8', newline='\n') as f:
        f.write(text)
    print(f'{len(hovering)} Pokémon flotan')
    return hovering


if __name__ == '__main__':
    h = main()
    for d in [6, 12, 16, 41, 81, 92, 93, 94, 109, 151, 722, 18, 142, 249, 384]:
        print(d, 'flota' if d in h else 'camina')
