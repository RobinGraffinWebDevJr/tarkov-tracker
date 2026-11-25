"""Planches de contrôle d'une analyse : vérifier à l'œil que les cases classées « fiables » sont justes.

Usage :
    python tools/audit_sheet.py <dossier d'un scan> [dossier de sortie]

Le dossier du scan (Documents/Tarkov Tracker/scans/<date>) doit contenir les pages (page-*.png) et le
fichier analysis.json, écrit automatiquement par l'application en mode développement (npm run dev)
à la fin de « Analyser le dernier scan ». Les planches sont écrites par défaut dans <scan>/audit.

Trois familles de planches, de la plus risquée à la plus sûre :
    A_nom_seul       cases acceptées parce qu'un seul objet porte le nom lu (icône différente)
    B_icone_seule    cases acceptées sur l'icône seule (nom illisible ou court)
    C_nom_et_icone   cases où le nom lu et l'icône concordent
Chaque vignette montre la case, l'objet retenu (→), le nom lu par l'OCR et la raison. Les cases
identiques sont regroupées (×N). Un nom écrit dans la vignette qui diffère de l'objet retenu = erreur.

Nécessite Pillow (pip install pillow) et les polices Segoe UI de Windows.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

if len(sys.argv) < 2:
    sys.exit(__doc__)
SESSION = sys.argv[1]
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(SESSION, 'audit')
analysis = json.load(open(os.path.join(SESSION, 'analysis.json'), encoding='utf-8'))

FONT = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 14)
BOLD = ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 14)
COLS, ROWS, TILE_W, TILE_H = 4, 9, 350, 118
pages = {}
os.makedirs(OUT, exist_ok=True)
for f in os.listdir(OUT):
    os.remove(os.path.join(OUT, f))

FAMILIES = {
    'A_nom_seul': lambda c: c['reliable'] and c['verdict'] == 'found',
    'B_icone_seule': lambda c: c['reliable'] and c['verdict'] == 'unknown',
    'C_nom_et_icone': lambda c: c['reliable'] and c['verdict'] == 'match',
}


def groups(pred):
    g = {}
    for c in analysis['cells']:
        if pred(c):
            g.setdefault((c['chosen'], c['w'], c['h']), []).append(c)
    return sorted(g.values(), key=lambda l: (-len(l), l[0]['chosen']))


def draw_tile(d, sheet, x0, y0, group):
    c = group[0]
    if c['file'] not in pages:
        pages[c['file']] = Image.open(os.path.join(SESSION, c['file'])).convert('RGB')
    box = (c['gx'] + c['col'] * 63, c['gy'] + c['row'] * 63,
           c['gx'] + (c['col'] + c['w']) * 63, c['gy'] + (c['row'] + c['h']) * 63)
    im = pages[c['file']].crop(box)
    scale = min(1.6, 150 / im.width, 100 / im.height)
    sheet.paste(im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS), (x0 + 6, y0 + 6))
    d.rectangle((x0 + 3, y0 + 3, x0 + TILE_W - 3, y0 + TILE_H - 3), outline=(60, 64, 72))
    chosen = next((k for k in c['candidates'] if k['id'] == c['chosen']), c['candidates'][0])
    tx = x0 + 166
    d.text((tx, y0 + 6), f"×{len(group)}  {c['w']}x{c['h']}", font=BOLD, fill=(230, 200, 110))
    d.text((tx, y0 + 26), '→ ' + chosen['shortName'][:22], font=BOLD, fill=(120, 220, 140))
    d.text((tx, y0 + 46), chosen['name'][:26], font=FONT, fill=(190, 190, 190))
    reads = ' '.join('«' + r + '»' for r in dict.fromkeys(r for r in c['reads'] if r))[:28] or 'nom illisible'
    d.text((tx, y0 + 66), 'lu : ' + reads, font=FONT, fill=(160, 200, 255))
    d.text((tx, y0 + 86), f"{c['why']} · icône {round(c['iconScore'] * 100)}"[:30], font=FONT, fill=(120, 126, 140))


summary = {}
for name, pred in FAMILIES.items():
    gs = groups(pred)
    summary[name] = {'groupes': len(gs), 'cases': sum(len(g) for g in gs)}
    per = COLS * ROWS
    for s in range((len(gs) + per - 1) // per):
        sheet = Image.new('RGB', (COLS * TILE_W, ROWS * TILE_H), (24, 26, 30))
        d = ImageDraw.Draw(sheet)
        for k, g in enumerate(gs[s * per:(s + 1) * per]):
            draw_tile(d, sheet, (k % COLS) * TILE_W, (k // COLS) * TILE_H, g)
        sheet.save(os.path.join(OUT, f'{name}_{s + 1}.png'))
print(json.dumps(summary, ensure_ascii=False))
print('planches dans', OUT)
