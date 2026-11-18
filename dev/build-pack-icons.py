# Builds assets/icons/src/<name>.png (32x32) from the free pixel-art packs the owner supplied.
# usage: python3 dev/build-pack-icons.py /tmp/packs
import sys, os, json, base64
from PIL import Image
P = sys.argv[1] if len(sys.argv) > 1 else '/tmp/packs'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'icons', 'src')
os.makedirs(OUT, exist_ok=True)
FI = Image.open(f'{P}/3d48a00f-FantasyInventory/FantasyInventory/FantasyInventorySpritesheet.png').convert('RGBA')
def fi(r, c): return FI.crop((c * 32, r * 32, c * 32 + 32, r * 32 + 32))
def ic(n): return Image.open(f'{P}/Icons/icon{n}.png').convert('RGBA')
MAP = {
  'leafwalk': fi(2, 0),   'harvest': fi(1, 7),    'emberkeep': fi(3, 1),  'sovereign': fi(4, 5),
  'st_spark': fi(1, 9),   'st_flame': fi(4, 6),   'st_comet': fi(2, 7),   'st_moon': fi(4, 1),
  'st_bolt': fi(2, 2),    'st_ring': fi(0, 8),    'st_wings': fi(2, 5),   'st_sun': ic(20),
  'g_medal': fi(0, 9),    'g_star': ic(6),     'g_arena': fi(4, 2),    'g_trophy': fi(4, 0),
  'g_party': fi(4, 8),    'g_flag': fi(4, 5),     'g_compass': fi(2, 9),  'g_quill': fi(1, 2),
  'g_wheel': fi(3, 4),    'g_masks': fi(3, 5),    'g_bolt': ic(7),     'g_chain': fi(1, 4),
  'g_beads': fi(4, 7),    'g_target': ic(28),
  's_copper': ic(25),     's_ink': fi(3, 0),      's_slick': fi(3, 9),    's_lantern': fi(2, 3),
  's_veins': ic(21),      's_glass': fi(2, 8),    's_topo': fi(2, 7),     's_eclipse': fi(4, 9),
  's_season': ic(31),
  'x_skull': fi(1, 6),    'x_cauldron': fi(4, 4), 'x_potion': fi(0, 0),   'x_orb': fi(0, 7),
  'x_candle': fi(1, 3),   'x_shroom': ic(32),     'x_eye': ic(29),        'x_book': fi(0, 4),
}
RAW = {}
for name, im in MAP.items():
    assert im.size == (32, 32), name
    im.save(os.path.join(OUT, name + '.png'))
    RAW[name] = base64.b64encode(im.tobytes()).decode()   # raw RGBA, so the bot can paint it synchronously
print(len(MAP), 'icons written')
json.dump(RAW, open(os.path.join(OUT, 'pack.json'), 'w'))
