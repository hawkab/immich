from collections import defaultdict
import re

from .sources import captured, current_scene, digest, logical_edits
from .policy import burial_context

MONTHS = ('январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август',
          'сентябрь', 'октябрь', 'ноябрь', 'декабрь')
THEMES = (
    ('sea', 'У моря', r'\b(?:мор[еяю]|морском|пляж\w*|побереж\w*|океан\w*|beach|seaside|ocean)\b'),
    ('aircraft', 'Авиация', r'\b(?:самол[её]т\w*|биплан\w*|аэроплан\w*|авиалайнер\w*|aircraft|airplane)\b'),
    ('dog', 'Собаки', r'\b(?:собак\w*|щен\w*|п[её]с|dog|puppy)\b'),
    ('cat', 'Кошки', r'\b(?:кошк\w*|кот(?:а|у|ом|е|ы|ов|ам|ами|ах)?|кот[её]н(?:ок|ка|ку|ком|ке)|котят\w*|cat|kitten)\b'),
    ('horse', 'Лошади', r'\b(?:лошад\w*|кон(?:ь|я|ю|[её]м|е|и|ей|ям|ями|ях)|жереб\w*|пони|horse|pony|unicorn|единорог\w*)\b'),
    ('nature', 'Природа и прогулки', r'\b(?:лес\w*|парк\w*|гор[аыуе]|горы|озер\w*|озёр\w*|прогул\w*|forest|hiking|mountain)\b'),
    ('celebration', 'Праздники', r'\b(?:праздник\w*|рожден\w*|рождени\w*|торт\w*|свадьб\w*|новогод\w*|birthday|wedding)\b'),
    ('creative', 'Творчество и игры', r'\b(?:рисун\w*|рисован\w*|игруш\w*|танц\w*|концерт\w*|театр\w*|живопис\w*|playground|concert)\b'),
    ('sport', 'Спорт и движение', r'\b(?:велосипед\w*|лыж\w*|коньк\w*|футбол\w*|теннис\w*|спорт\w*|bicycle|cycling|skiing)\b'),
)


def classification(asset, scene):
    if not current_scene(asset, scene):
        scene = {}
    if burial_context(scene):
        return []
    kind = scene.get('kind', '')
    filename = asset.get('originalFileName', '').casefold()
    technical = kind in ('screenshot', 'document') or filename.startswith(('screenshot', 'скриншот'))
    if technical:
        return ['technical']
    facts = scene.get('facts') or [scene.get('visionText', scene.get('searchText', ''))]
    if not isinstance(facts, list) or any(not isinstance(fact, str) for fact in facts):
        facts = []
    actual = ' '.join(facts)
    themes = [key for key, _, pattern in THEMES if re.search(pattern, actual.casefold())]
    if kind == 'drawing':
        themes.append('creative')
    return sorted(set(themes))


def plan_buckets(assets, scenes):
    groups = {}
    cities = defaultdict(list)

    def add(key, title, theme, asset):
        group = groups.setdefault(key, {'key': key, 'title': title, 'theme': theme,
                                         'assets': []})
        group['assets'].append(asset)

    titles = {key: title for key, title, _ in THEMES}
    for asset in assets:
        if not current_scene(asset, scenes.get(asset['id'])) or burial_context(scenes[asset['id']]):
            continue
        date = captured(asset)
        themes = classification(asset, scenes.get(asset['id']))
        if themes == ['technical']:
            add(f'technical:{date.year}', f'Документы и скриншоты · {date.year}', 'technical', asset)
            continue
        add(f'month:{date:%Y-%m}', f'Моменты · {MONTHS[date.month - 1]} {date.year}', 'family', asset)
        for theme in themes:
            add(f'theme:{theme}:{date.year}', f'{titles[theme]} · {date.year}', theme, asset)
        city = (asset.get('exifInfo') or {}).get('city')
        if city and isinstance(city, str) and city.strip():
            cities[(city.strip(), date.strftime('%Y-%m'))].append(asset)
    for (city, month), photos in cities.items():
        key = f'place:{city.casefold()}:{month}'
        start = captured(photos[0])
        add(key, f'{city} · {MONTHS[start.month - 1]} {start.year}', 'travel', photos[0])
        groups[key]['assets'] = photos
    for group in groups.values():
        group['assets'].sort(key=lambda asset: (captured(asset), asset['id']))
        group['input_digest'] = digest([(a['id'], a.get('checksum'), a.get('thumbhash'),
                                         a.get('isEdited'), logical_edits(a.get('_edits', [])), a.get('isFavorite'),
                                         (a.get('exifInfo') or {}).get('rating'), captured(a).isoformat())
                                        for a in group['assets']])
    return groups
