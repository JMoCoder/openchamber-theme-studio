#!/usr/bin/env python3
"""Blind-test sheets for the 17 styles, from raw 1160x760 whole-window captures. Never recolours a tile.

usage: blind-sheets.py RAW_DIR OUT_DIR KEY_JSON [seed]
RAW_DIR holds <palette>-<mode>-<style>.jpg; keep KEY_JSON away from OUT_DIR.
"""
import json, sys
from pathlib import Path
from random import Random
from PIL import Image, ImageDraw, ImageFont

raw, out, keyfile = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
rng = Random(int(sys.argv[4]) if len(sys.argv) > 4 else 20261125)
out.mkdir(parents=True, exist_ok=True)
RECIPES = ['brutalism', 'fauvism', 'terminal-retro', 'editorial-paper', 'swiss-minimal', 'eink', 'cyber-vapor',
           'pixel-palette', 'soft-glass', 'constructivist', 'art-deco', 'mineral-landscape', 'retro-desktop',
           'thermal-ramp', 'chalkboard', 'stained-glass', 'kraft-label']
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 17)
BG = (110, 113, 120)


def tile(family, mode, recipe, width):
    with Image.open(raw / f'{family}-{mode}-{recipe}.jpg') as im:
        im = im.convert('RGB')
        return im.resize((width, round(width * im.height / im.width)), Image.Resampling.LANCZOS)


def sheet(entries, width, columns, labels):
    h = round(width * 760 / 1160)
    sx, sy = width + 14, h + 32
    rows = -(-len(entries) // columns)
    im = Image.new('RGB', (columns * sx + 10, rows * sy + 8), BG)
    d = ImageDraw.Draw(im)
    for i, (e, label) in enumerate(zip(entries, labels)):
        x, y = 10 + (i % columns) * sx, 24 + (i // columns) * sy
        im.paste(tile(*e, width), (x, y))
        d.text((x, y - 21), label, font=font, fill='white')
    return im


key = {}
for mode, n in (('light', 1), ('dark', 2)):
    # Test A: names only, no reference picture, one palette.
    order = RECIPES[:]
    rng.shuffle(order)
    palette = 'blue' if mode == 'light' else 'warm'
    sheet([(palette, mode, r) for r in order], 120, 6, [str(i + 1) for i in range(17)]).save(out / f'a{n}.png')
    key[f'a{n}'] = {'mode': mode, 'palette': palette, 'order': order}
    # Test B: reference in one palette, two other palettes to recognise.
    ref = RECIPES[:]
    rng.shuffle(ref)
    letters = [chr(65 + i) for i in range(17)]
    sheet([('neutral', mode, r) for r in ref], 200, 6, letters).save(out / f'b{n}-ref.png')
    probes = [(p, mode, r) for p in ('green', 'zero') for r in RECIPES]
    rng.shuffle(probes)
    sheet(probes, 120, 6, [str(i + 1) for i in range(len(probes))]).save(out / f'b{n}.png')
    key[f'b{n}'] = {'mode': mode, 'reference': dict(zip(letters, ref)), 'order': [[p, r] for p, _, r in probes]}
keyfile.parent.mkdir(parents=True, exist_ok=True)
keyfile.write_text(json.dumps(key, ensure_ascii=False, indent=1))
print('ok')
