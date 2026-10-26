# App icons (PWA, favicon, iPhone) in pixel art: Poké Ball on a navy background.
#   python tools/make_icons.py   -> assets/icons/*.png
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons')
os.makedirs(OUT, exist_ok=True)

NAVY, NAVY2, K = (10, 20, 48), (26, 49, 112), (27, 21, 40)
RED, RED2, WHITE, GREY, GOLD = (232, 57, 74), (168, 30, 48), (242, 242, 242), (190, 196, 214), (255, 210, 63)

# 16x16 Poké Ball (k outline, r red, d dark red, w white, g gray, o center)
BALL = [
    '.....kkkkkk.....',
    '...kkrrrrrrkk...',
    '..krrwwrrrrrrk..',
    '.krrwwrrrrrrrdk.',
    '.krwrrrrrrrrrdk.',
    'krrrrrrrrrrrrrdk',
    'krrrrrkkkkrrrrdk',
    'kkkkkkkwwkkkkkkk',
    'kwwwwwkwwkwwwwgk',
    'kwwwwwkkkkwwwwgk',
    '.kwwwwwwwwwwwgk.',
    '.kwwwwwwwwwwwgk.',
    '..kwwwwwwwwwgk..',
    '...kkggggggkk...',
    '.....kkkkkk.....',
    '................',
]
PAL = {'k': K, 'r': RED, 'd': RED2, 'w': WHITE, 'g': GREY}

def icon(size, maskable=False):
    img = Image.new('RGBA', (size, size), NAVY + (255,))
    d = ImageDraw.Draw(img)
    # Pixelated gold frame (omitted from maskable icons: the system crops the corners).
    unit = size // 32
    if not maskable:
        d.rectangle([unit, unit, size - unit - 1, size - unit - 1], outline=GOLD, width=unit)
        d.rectangle([unit * 2, unit * 2, size - unit * 2 - 1, size - unit * 2 - 1], fill=NAVY2)
    # The ball fills the safe area (60% for maskable icons, 70% otherwise).
    frac = 0.56 if maskable else 0.7
    px = max(1, int(size * frac / 16))
    w = px * 16
    ox, oy = (size - w) // 2, (size - w) // 2 + px // 2
    for y, row in enumerate(BALL):
        for x, ch in enumerate(row):
            if ch in PAL:
                d.rectangle([ox + x * px, oy + y * px, ox + (x + 1) * px - 1, oy + (y + 1) * px - 1], fill=PAL[ch])
    # Gold sparkles
    for cx, cy in ((0.2, 0.22), (0.8, 0.78), (0.82, 0.24)):
        x, y = int(size * cx), int(size * cy)
        s = max(1, px // 2)
        d.rectangle([x - s, y - 3 * s, x + s - 1, y + 3 * s - 1], fill=GOLD)
        d.rectangle([x - 3 * s, y - s, x + 3 * s - 1, y + s - 1], fill=GOLD)
    return img

# Google only displays square icons of 48 px or multiples thereof (48, 96, 144...) in results.
for size in (512, 192, 180, 144, 96, 48, 32):
    icon(size).save(os.path.join(OUT, f'icon-{size}.png'))
icon(512, True).save(os.path.join(OUT, 'icon-maskable-512.png'))
# favicon.ico at the website root: the first asset requested by Google and browsers.
icon(48).save(os.path.join(OUT, '..', '..', 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48)])
print('ok', os.listdir(OUT))
