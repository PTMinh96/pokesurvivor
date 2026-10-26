# -*- coding: utf-8 -*-
"""Game font with more easily distinguished numerals.

Pixelify Sans (OFL) draws 2, 5, 8 (and S) nearly alike, all rounded. This
script creates two static instances of the variable font (regular 400 and bold
700) and redraws the numerals with a sharper 5x7 pixel grid: a stepped 2, a
square-cornered 5, and a narrower 8 at the waist. Corners remain clipped like
the rest of the letters so they match.

    python tools/make_font.py   ->  assets/fonts/PixelifyPS-400.ttf and -700.ttf

Requires fontTools (pip install fonttools). The font is renamed to
"Pixelify PS", as required by the OFL for modified versions.
"""
import os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'assets', 'fonts', 'PixelifySans.ttf')
OUT = os.path.join(ROOT, 'assets', 'fonts', 'PixelifyPS-{}.ttf')
FAMILY = 'Pixelify PS'

# 5 columns × 7 rows, top to bottom. '#' = pixel.
DIGITS = {
    'zero':  ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    'two':   ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    'three': ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    'four':  ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    'five':  ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    'six':   ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
    'seven': ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    'eight': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    'nine':  ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
}


def build(weight):
    font = instancer.instantiateVariableFont(TTFont(SRC), {'wght': weight})
    glyf, hmtx = font['glyf'], font['hmtx']
    # Bounding box of the original font's numerals (using 0) and stroke width.
    z = glyf['zero']
    coords = z.getCoordinates(glyf)[0]
    xs = sorted(set(x for x, _ in coords))
    ys = sorted(set(y for _, y in coords))
    x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]
    stroke = xs[2] - xs[0]                    # e.g. 60 -> 161 in the regular font
    cw, ch = (x1 - x0) / 5, (y1 - y0) / 7
    bleed = max(0, (stroke - cw) / 2)        # Bold strokes are wider than one pixel.
    for name, rows in DIGITS.items():
        pen = TTGlyphPen(glyf)
        for r, row in enumerate(rows):
            c = 0
            while c < 5:
                if row[c] != '#':
                    c += 1
                    continue
                c2 = c
                while c2 + 1 < 5 and row[c2 + 1] == '#':
                    c2 += 1
                # Horizontal pixel run (slightly thicker for bold),
                # staying within the original bounding box.
                ax = round(max(x0, x0 + c * cw - bleed))
                bx = round(min(x1, x0 + (c2 + 1) * cw + bleed))
                top = round(min(y1, y1 - r * ch + bleed))
                bot = round(max(y0, y1 - (r + 1) * ch - bleed))
                pen.moveTo((ax, bot)); pen.lineTo((ax, top)); pen.lineTo((bx, top)); pen.lineTo((bx, bot))
                pen.closePath()
                c = c2 + 1
        g = pen.glyph()
        g.recalcBounds(glyf)
        glyf[name] = g
        hmtx[name] = (hmtx[name][0], g.xMin)
    # New name (OFL: a modified version must not use the same name).
    style = 'Regular' if weight == 400 else 'Bold'
    for rec in font['name'].names:
        if rec.nameID in (1, 16):
            rec.string = FAMILY
        elif rec.nameID == 4:
            rec.string = FAMILY + ' ' + style
        elif rec.nameID == 6:
            rec.string = FAMILY.replace(' ', '') + '-' + style
        elif rec.nameID == 17:
            rec.string = style
    font.save(OUT.format(weight))
    print('ok:', os.path.basename(OUT.format(weight)), 'pixel', round(cw), 'x', round(ch), 'extra', round(bleed))


if __name__ == '__main__':
    for w in (400, 700):
        build(w)
