# Generates the spinning-wheel GIFs used by /roulette:  python3 dev/make-roulette-gifs.py
# 36 pockets (odd = red, even = black, no zero: the game is a fair 50/50). One GIF per pocket,
# the wheel spins and slows down until that pocket stops under the gold pointer.
import math, random, os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'roulette')
os.makedirs(OUT, exist_ok=True)
S = 720          # hi-res wheel
V = 240          # output size
POCKETS = 36
RED, BLACK, GOLD, BG, WOOD = (200, 30, 40), (24, 24, 28), (240, 190, 60), (30, 24, 40), (92, 56, 30)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 34)

def wheel():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = S / 2
    d.ellipse([4, 4, S - 4, S - 4], fill=WOOD, outline=GOLD, width=6)
    r_out, r_in = c - 34, c - 150
    for i in range(POCKETS):
        n = i + 1
        col = RED if n % 2 else BLACK
        a0, a1 = i * 10 - 90, (i + 1) * 10 - 90          # pocket i: clockwise from the top
        d.pieslice([c - r_out, c - r_out, c + r_out, c + r_out], a0, a1, fill=col, outline=GOLD, width=2)
    d.ellipse([c - r_in, c - r_in, c + r_in, c + r_in], fill=(40, 30, 44), outline=GOLD, width=5)
    for i in range(POCKETS):
        n = i + 1
        ang = math.radians(i * 10 + 5 - 90)
        rr = (r_out + r_in) / 2 + 6
        x, y = c + rr * math.cos(ang), c + rr * math.sin(ang)
        t = Image.new('RGBA', (70, 50), (0, 0, 0, 0))
        ImageDraw.Draw(t).text((35, 25), str(n), font=font, fill=(255, 255, 255), anchor='mm')
        t = t.rotate(-(i * 10 + 5), expand=True, resample=Image.BICUBIC)
        im.alpha_composite(t, (int(x - t.width / 2), int(y - t.height / 2)))
    d.ellipse([c - 44, c - 44, c + 44, c + 44], fill=GOLD, outline=(120, 80, 20), width=4)
    return im

base = wheel()

def frame(angle_cw):
    w = base.rotate(-angle_cw, resample=Image.BICUBIC)
    bg = Image.new('RGBA', (S, S), BG)
    bg.alpha_composite(w)
    d = ImageDraw.Draw(bg)
    c = S / 2
    d.polygon([(c - 26, 6), (c + 26, 6), (c, 70)], fill=GOLD, outline=(110, 70, 10))   # pointer
    d.ellipse([c - 11, 62, c + 11, 84], fill=(255, 255, 255))                           # ball
    return bg.resize((V, V), Image.LANCZOS).convert('RGB')

N = 26
for k in range(1, POCKETS + 1):
    rnd = random.Random(k * 7919)
    jitter = rnd.uniform(-3.2, 3.2)
    target = (-((k - 1) * 10 + 5) + jitter) % 360
    total = 360 * 3 + target
    frames, durs = [], []
    for f in range(N):
        t = f / (N - 1)
        ang = total * (1 - (1 - t) ** 3)
        frames.append(frame(ang))
        durs.append(int(35 + 150 * t * t))
    durs[-1] = 60000
    pal = [im.quantize(colors=24, method=Image.MEDIANCUT, dither=Image.NONE) for im in frames]
    pal[0].save(os.path.join(OUT, f'wheel_{k}.gif'), save_all=True, append_images=pal[1:],
                duration=durs, loop=0, optimize=True, disposal=1)
print('done')
