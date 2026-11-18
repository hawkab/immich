from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path

FPS = 25
RENDERER_VERSION = '1'


def chronology(item):
    value = item.get('captured_at') or ''
    try:
        moment = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return moment.timestamp(), str(item['id'])
    except (ValueError, TypeError, OverflowError):
        return math.inf, str(item['id'])


def timeline(duration_seconds):
    if not math.isfinite(duration_seconds) or duration_seconds <= 0:
        raise ValueError('A memory duration must be a positive finite number')
    frames = max(3, round(duration_seconds * FPS))
    opening = max(1, min(round(2.3 * FPS), round(frames * 0.12)))
    closing = max(1, min(round(4.5 * FPS), round(frames * 0.22)))
    return {'opening_frames': opening, 'closing_frames': closing,
            'photo_frames': frames - opening - closing, 'total_frames': frames}


def select_memory_items(items, duration_seconds=45):
    ordered = sorted(items, key=chronology)
    if not ordered:
        raise ValueError('A memory needs at least one real display preview')
    if len({str(item['id']) for item in ordered}) != len(ordered):
        raise ValueError('Memory membership must use distinct asset IDs')
    available = timeline(duration_seconds)['photo_frames']
    count = min(len(ordered), max(1, round(available / (FPS * 3.4))), available)
    if count == 1:
        return [ordered[(len(ordered) - 1) // 2]]
    positions = [round(index * (len(ordered) - 1) / (count - 1)) for index in range(count)]
    return [ordered[index] for index in positions]


def date_caption(items):
    dates = []
    for item in sorted(items, key=chronology):
        if math.isfinite(chronology(item)[0]):
            moment = datetime.fromisoformat(str(item['captured_at']).replace('Z', '+00:00'))
            dates.append(moment.strftime('%d.%m.%Y'))
    if not dates:
        return ''
    return dates[0] if dates[0] == dates[-1] else dates[0] + ' — ' + dates[-1]


def creation_time(items):
    for item in sorted(items, key=chronology):
        if math.isfinite(chronology(item)[0]):
            return datetime.fromtimestamp(chronology(item)[0], timezone.utc).isoformat()
    return None


def file_sha256(path):
    with Path(path).open('rb') as source:
        return hashlib.file_digest(source, 'sha256').hexdigest()


def membership_signature(items, selected, *, title, theme, duration_seconds, width, height):
    rendered = []
    for item in selected:
        digest = file_sha256(item['path'])
        if item.get('sha256') and digest.lower() != item['sha256'].lower():
            raise ValueError('A display preview changed after it was verified')
        rendered.append({'id': str(item['id']), 'sha256': digest})
    document = {'renderer': RENDERER_VERSION, 'title': title, 'theme': theme,
                'duration_seconds': duration_seconds, 'width': width, 'height': height,
                'members': [{'id': str(item['id']), 'captured_at': str(item.get('captured_at') or ''),
                             'sha256': item.get('sha256')} for item in sorted(items, key=chronology)],
                'rendered_previews': rendered}
    encoded = json.dumps(document, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
    return hashlib.sha256(encoded).hexdigest(), rendered
