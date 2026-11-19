"""Read-only, reproducible inventory for the supplied Sango2 1.05+ package.

Run with the bundled Python (Pillow installed). Does not execute the game.
Original bytes remain in the supplied package; outputs are local research assets.
"""
from __future__ import annotations
import argparse
import collections
import csv
import hashlib
import io
import json
import pathlib
import re
import struct
import sys
import time
import wave

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKSPACE = ROOT.parent
sys.path.insert(0, str(WORKSPACE / 'sango2-english-patch' / 'tools'))
import shp


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')


def write_csv(path, rows, fields):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction='ignore')
        writer.writeheader()
        writer.writerows(rows)


def parse_ini(text):
    """Keep repeated sections/keys and line locations; this is not ConfigParser INI."""
    sections, stray, section = [], [], None
    for number, line in enumerate(text.splitlines(), 1):
        clean = line.strip()
        if not clean or clean.startswith((';', '//')):
            continue
        match = re.match(r'^\[([^]]+)\]', clean)
        if match:
            name = match.group(1)
            section = {'name': name, 'kind': re.sub(r'\d+$', '', name).upper(),
                       'line': number, 'entries': []}
            sections.append(section)
        elif '=' in clean and section is not None:
            key, value = clean.split('=', 1)
            section['entries'].append({'key': key.strip(), 'value': value.strip(), 'line': number})
        else:
            stray.append({'line': number, 'text': line})
    return {'sections': sections, 'unparsed_lines': stray}


def values(section):
    return {e['key'].upper(): e['value'] for e in section['entries']}


def kind_records(parsed, kind):
    return [dict(values(s), _line=s['line'], _section=s['name'])
            for s in parsed['sections'] if s['kind'] == kind]


def sprite_image(sprite):
    image = Image.new('RGBA', (sprite.width, sprite.height))
    image.putdata([(0, 0, 0, 0) if v is None else (*shp.to_rgb(v), 255)
                   for row in sprite.rows for v in row])
    return image


def make_sheet(items, path, cell=(220, 170), cols=4):
    rows = (len(items) + cols - 1) // cols
    out = Image.new('RGB', (cols * cell[0], max(1, rows) * cell[1]), '#222c35')
    draw = ImageDraw.Draw(out)
    font = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 11)
    for i, (name, image) in enumerate(items):
        x, y = i % cols * cell[0], i // cols * cell[1]
        thumb = image.copy()
        thumb.thumbnail((cell[0] - 10, cell[1] - 32), Image.Resampling.NEAREST)
        at = (x + (cell[0] - thumb.width) // 2, y + 4)
        out.paste(thumb, at, thumb if thumb.mode == 'RGBA' else None)
        draw.text((x + 5, y + cell[1] - 27), name[:32], font=font, fill='white')
        draw.text((x + 5, y + cell[1] - 14), f'{image.width} x {image.height}', font=font, fill='#b7cbdc')
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--game', type=pathlib.Path,
                    default=WORKSPACE / 'game-original-105plus' / '三国群英传2 修正版 1.05+')
    args = ap.parse_args()
    game = args.game
    data_dir, preview_dir = ROOT / 'data', ROOT / 'previews'
    raw_dir = ROOT / 'evidence' / 'config-utf8'
    for p in (data_dir, preview_dir, raw_dir):
        p.mkdir(parents=True, exist_ok=True)

    raw = (game / 'Sango2.PAK').read_bytes()
    magic, count, directory, unknown = struct.unpack_from('<4sIII', raw)
    assert magic == b'PAKS' and directory + count * 64 <= len(raw)
    records, errors, parsed, binary_headers = [], [], {}, {}
    groups, extensions, signatures = collections.Counter(), collections.Counter(), collections.Counter()
    shp_stats = collections.Counter()
    texture_stats, audio_stats = [], []
    samples = collections.defaultdict(list)
    seen_names, seen_payload = set(), collections.Counter()
    shape_dimensions = collections.Counter()
    start = time.monotonic()
    for idx in range(count):
        entry = raw[directory + idx * 64:directory + (idx + 1) * 64]
        size, off = struct.unpack_from('<II', entry)
        name = entry[24:64].split(b'\0', 1)[0].decode('ascii')
        assert off >= 24 and off + size <= directory, (name, off, size, directory)
        assert name.upper() not in seen_names, name
        seen_names.add(name.upper())
        payload = raw[off:off + size]
        ext = pathlib.PureWindowsPath(name).suffix.upper()
        parts = name.split('\\')
        group = '\\'.join(parts[:2]) if len(parts) > 2 else (parts[0] if len(parts) > 1 else '(root)')
        digest = sha(payload)
        rec = {'index': idx, 'path': name, 'group': group, 'extension': ext,
               'offset': off, 'size': size, 'sha256': digest,
               'signature_hex': payload[:16].hex(), 'status': 'inventoried'}
        groups[group] += 1
        extensions[ext] += 1
        signatures[(ext, payload[:4].hex())] += 1
        seen_payload[digest] += 1
        try:
            if ext == '.INI':
                text = payload.decode('cp950')
                (raw_dir / (name.replace('\\', '__') + '.txt')).write_text(text, encoding='utf-8')
                parsed[name] = parse_ini(text)
                rec.update(status='decoded-cp950', sections=len(parsed[name]['sections']))
            elif ext == '.SHP':
                s = shp.decode(payload)
                encoded = shp.encode(s)
                if encoded != payload:
                    shp_stats['roundtrip_different'] += 1
                    errors.append({'path': name, 'stage': 'byte_roundtrip', 'error': 'decoded and re-encoded bytes differ'})
                else:
                    shp_stats['roundtrip_exact'] += 1
                shp_stats['decoded'] += 1
                shp_stats['bounding_pixels'] += s.width * s.height
                shape_dimensions[(s.width, s.height)] += 1
                rec.update(status='decoded-shp', width=s.width, height=s.height,
                           header_fields=s.fields, roundtrip_exact=(encoded == payload))
                if len(samples[group]) < 4 or name.upper().endswith(('TITLEBG.SHP', 'CHINAMAP.SHP', 'WAR0D.SHP', 'WARPREP01.SHP', 'D12A.SHP', 'C3_A.SHP')):
                    image = sprite_image(s)
                    samples[group].append((name, image))
                    if s.width >= 600 or name.upper().endswith('D12A.SHP'):
                        image.save(preview_dir / (name.replace('\\', '__') + '.png'))
            elif ext in ('.TGA', '.TEX', '.MSK'):
                image = Image.open(io.BytesIO(payload))
                image.load()
                rec.update(status='decoded-' + image.format.lower(), width=image.width,
                           height=image.height, image_format=image.format, mode=image.mode)
                texture_stats.append({k: rec[k] for k in ('path', 'size', 'image_format', 'mode', 'width', 'height')})
                if ext == '.MSK':
                    hist = collections.Counter(image.getdata())
                    rec['palette_values'] = sorted(hist.items())
                    rec['palette_entries'] = len(hist)
                preview = image.convert('RGBA')
                samples[group].append((name, preview))
                preview.save(preview_dir / (name.replace('\\', '__') + '.png'))
            elif ext == '.WAV':
                with wave.open(io.BytesIO(payload), 'rb') as w:
                    info = {'path': name, 'channels': w.getnchannels(), 'rate': w.getframerate(),
                            'sample_width': w.getsampwidth(), 'frames': w.getnframes(),
                            'seconds': round(w.getnframes() / w.getframerate(), 4)}
                    assert len(w.readframes(w.getnframes())) == info['frames'] * info['channels'] * info['sample_width']
                    audio_stats.append(info)
                    rec.update(status='decoded-pcm-wav', **{k: v for k, v in info.items() if k != 'path'})
            else:
                binary_headers[name] = {'size': size, 'first_64_hex': payload[:64].hex(' '),
                                        'u32_first_16': list(struct.unpack_from('<16I', payload)) if size >= 64 else []}
        except Exception as ex:
            rec['status'] = 'decode-failed'
            errors.append({'path': name, 'stage': 'decode', 'error': str(ex), 'type': type(ex).__name__})
        records.append(rec)
        if (idx + 1) % 2500 == 0:
            print(f'Checked {idx + 1}/{count}; errors={len(errors)}', flush=True)

    package_records = []
    for path in sorted(game.rglob('*')):
        if path.is_file():
            content = path.read_bytes()
            package_records.append({'path': path.relative_to(game).as_posix(), 'size': len(content),
                                    'extension': path.suffix.lower(), 'sha256': sha(content)})
    schema = {}
    for name, config in parsed.items():
        classes = {}
        for s in config['sections']:
            cl = classes.setdefault(s['kind'], {'sections': 0, 'fields': collections.Counter(), 'first_line': s['line']})
            cl['sections'] += 1
            cl['fields'].update(e['key'].upper() for e in s['entries'])
        schema[name] = {'groups': classes, 'unparsed_line_count': len(config['unparsed_lines']),
                        'unparsed_examples': config['unparsed_lines'][:8]}

    scenarios, scenario_rows = {}, []
    for n in range(1, 6):
        name = f'TIMES{n}.INI'
        p = parsed[name]
        categories = {kind: kind_records(p, kind) for kind in ('SYSTEM', 'KING', 'CITY', 'PATH', 'GENERAL')}
        scenarios[name] = categories
        system = categories['SYSTEM'][0]
        scenario_rows.append({'file': name, 'title': system.get('TIME'), 'year': system.get('YEAR'),
                              **{k.lower(): len(v) for k, v in categories.items() if k != 'SYSTEM'},
                              'declared_generals': system.get('TOTALGENERAL'), 'declared_cities': system.get('TOTALCITY'),
                              'declared_kings': system.get('TOTALKING')})
    catalog = {'scenarios': scenarios,
               'items': kind_records(parsed['SANGO.INI'], 'ITEM'),
               'terrain': kind_records(parsed['SANGO.INI'], 'TERRAIN'),
               'units': kind_records(parsed['SANGO.INI'], 'FORCE'),
               'formations': kind_records(parsed['SANGO.INI'], 'BATTLEARRAY'),
               'magic': kind_records(parsed['MAGIC.INI'], 'MAGIC'),
               'strategies': kind_records(parsed['MAGIC.INI'], 'WISE')}
    sheets = []
    for group, images in sorted(samples.items()):
        sheet_path = preview_dir / ('sheet-' + group.replace('\\', '-').replace('(', '').replace(')', '') + '.png')
        make_sheet(images, sheet_path)
        sheets.append({'group': group, 'preview': str(sheet_path.relative_to(ROOT)), 'samples': len(images)})
    summary = {'source': str(game), 'pak_sha256': sha(raw), 'exe_sha256': sha((game / 'Sango2.exe').read_bytes()),
               'pak_size': len(raw), 'pak_header': {'count': count, 'directory_offset': directory, 'unknown': unknown},
               'package_files': len(package_records), 'package_bytes': sum(x['size'] for x in package_records),
               'package_extensions': dict(collections.Counter(x['extension'] for x in package_records)),
               'extensions': dict(extensions), 'groups': dict(groups), 'shp': dict(shp_stats),
               'shp_dimensions': [{'width': w, 'height': h, 'count': c} for (w, h), c in shape_dimensions.most_common()],
               'image_formats': dict(collections.Counter(t['image_format'] for t in texture_stats)),
               'wav_count': len(audio_stats), 'wav_seconds': sum(x['seconds'] for x in audio_stats),
               'wav_formats': dict(collections.Counter(f"{x['channels']}ch/{x['rate']}Hz/{x['sample_width']*8}bit" for x in audio_stats)),
               'duplicate_content_groups': sum(v > 1 for v in seen_payload.values()),
               'duplicate_content_extra_entries': sum(v - 1 for v in seen_payload.values()),
               'scenarios': scenario_rows,
               'catalog_counts': {k: len(v) for k,v in catalog.items() if k != 'scenarios'},
               'errors': errors, 'sheet_previews': sheets,
               'elapsed_seconds': round(time.monotonic() - start, 2)}
    for name, obj in [('pak-manifest.json', records), ('package-manifest.json', package_records),
                      ('config-records.json', parsed), ('config-schema.json', schema), ('game-catalog.json', catalog),
                      ('image-formats.json', texture_stats), ('audio-wav.json', audio_stats),
                      ('binary-headers.json', binary_headers), ('summary.json', summary)]:
        write_json(data_dir / name, obj)
    write_csv(data_dir / 'pak-manifest.csv', records,
              ['index','path','group','extension','offset','size','sha256','status','width','height'])
    write_csv(data_dir / 'package-manifest.csv', package_records, ['path','size','extension','sha256'])
    write_csv(data_dir / 'scenarios.csv', scenario_rows, list(scenario_rows[0]))
    print(json.dumps({k: summary[k] for k in ('pak_header','extensions','shp','image_formats','scenarios','catalog_counts','errors','elapsed_seconds')}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
