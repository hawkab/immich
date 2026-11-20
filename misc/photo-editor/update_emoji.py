"""Reproduce the offline Unicode emoji catalog and renderer assets from pinned sources.

Author: Olshansky Grigory
"""
from pathlib import Path
import concurrent.futures
import hashlib
import io
import json
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def read_pinned(source):
    """Read a public upstream resource only when its pinned digest matches."""
    with urllib.request.urlopen(source['url']) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != source['sha256']:
        raise ValueError('Emoji source digest mismatch')
    return data


def archive(source):
    """Read archive members without extracting untrusted paths."""
    return tarfile.open(fileobj=io.BytesIO(read_pinned(source)))


def main():
    """Generate matching client catalog and server allowlist/artwork."""
    lock = json.loads((Path(__file__).parent / 'emoji-sources.json').read_text())
    resources = list(lock['openmoji']['files'].items())
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        openmoji = dict(pool.map(lambda item: (item[0], read_pinned(item[1]).decode()), resources))
    with archive(lock['twemoji']) as art, archive(lock['emojibase']) as metadata:
        svgs = {m.name.rsplit('/', 1)[-1][:-4]: art.extractfile(m).read().decode()
                for m in art.getmembers() if '/assets/svg/' in m.name and m.name.endswith('.svg')}
        locales = {}
        for language in ('en', 'ru'):
            data = json.load(metadata.extractfile(f'package/{language}/data.json'))
            locales[language] = {e['hexcode']: e for row in data for e in (row, *row.get('skins', []))}
        catalog, graphics = [], {}
        for code, item in locales['en'].items():
            normalized = '-'.join(format(int(part, 16), 'x') for part in code.split('-'))
            candidates = (normalized, '-'.join(p for p in normalized.split('-') if p != 'fe0f'))
            key = next((key for key in candidates if key in svgs or key in openmoji), None)
            if key is None:
                raise ValueError(f'Missing artwork for {code}')
            if key in graphics:
                continue
            translated = locales['ru'].get(code, item)
            catalog.append({'id': key, 'emoji': item['emoji'], 'en': item['label'], 'ru': translated['label'],
                            'tags': sorted(set(item.get('tags', []) + translated.get('tags', []))),
                            'group': item.get('group', -1)})
            graphics[key] = svgs.get(key, openmoji.get(key))
        target = ROOT / 'web/static/editor-emoji'
        target.mkdir(exist_ok=True)
        for key, svg in graphics.items():
            (target / f'{key}.svg').write_text(svg)
        (target / 'catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, separators=(',', ':')) + '\n')
        for member in art.getmembers():
            if member.name.rsplit('/', 1)[-1] == 'LICENSE-GRAPHICS':
                (target / 'LICENSE-GRAPHICS').write_bytes(art.extractfile(member).read())
        (target / 'OPENMOJI-LICENSE.txt').write_text(openmoji['license'])
        (target / 'ATTRIBUTION.txt').write_text('Twemoji graphics © Twitter, Inc. and other contributors, CC-BY-4.0.\n'
            'https://github.com/jdecked/twemoji/tree/v17.0.3\n'
            'Emoji names and keywords: Emojibase / Unicode CLDR, MIT and Unicode licenses.\n'
            'https://github.com/milesj/emojibase\n'
            'Unicode 18 additions: OpenMoji contributors, CC-BY-SA-4.0.\n'
            'https://github.com/hfg-gmuend/openmoji/tree/' + lock['openmoji']['commit'] + '\n')
        for name in ('LICENSE', 'UNICODE-LICENSE'):
            members = [m for m in metadata.getmembers() if m.name.rsplit('/', 1)[-1] == name]
            if members:
                (target / ('EMOJIBASE-' + name)).write_bytes(metadata.extractfile(members[0]).read())
        for name, data in [('editor-emoji-ids', sorted(graphics)), ('editor-emoji-graphics', graphics)]:
            (ROOT / f'server/src/data/{name}.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
        print(f'Generated {len(catalog)} offline emoji entries, including skin-tone and ZWJ sequences.')


if __name__ == '__main__':
    main()
