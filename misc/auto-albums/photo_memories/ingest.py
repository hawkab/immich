from datetime import timedelta
import urllib.error

from .sources import GENERATED_KEY, SCENE_KEY, current_scene, live_photo


def synchronize(owner, registry, profile, events, cache, now):
    owner.server_started_at = None
    scope = f'assets:{owner.id}'
    previous = registry.get('owners', owner.id, {})
    full = not previous.get('cursor') or now.timestamp() - previous.get('last_full', 0) >= 86400
    before = dict(registry.rows(scope))
    changed = set()
    incoming = list(owner.assets(None if full else previous['cursor']))
    found = {asset['id'] for asset in incoming}
    for path, event_owner, asset_id in events:
        if event_owner != owner.id or asset_id in found:
            continue
        try:
            asset = owner.call('/assets/' + asset_id)
            incoming.append(asset)
            found.add(asset_id)
        except urllib.error.HTTPError as error:
            if error.code != 404:
                raise
            registry.remove(scope, asset_id)
            changed.add(asset_id)
    for asset in incoming:
        identity = asset['id']
        if registry.get(f'generated:{owner.id}', identity) or not live_photo(asset, owner.id):
            registry.remove(scope, identity)
            if identity in before:
                changed.add(identity)
            continue
        old = before.get(identity, {})
        if asset.get('isEdited'):
            asset['_edits'] = owner.call('/assets/' + identity + '/edits')
        scene = cache.get((owner.id, identity), old.get('scene'))
        if not current_scene(asset, scene) and asset.get('thumbhash'):
            scene = owner.metadata(identity, SCENE_KEY)
        generated = asset.get('originalFileName', '').startswith('Aegis_Memory_')
        generated_tag = owner.metadata(identity, GENERATED_KEY) if generated else None
        if isinstance(generated_tag, dict) and generated_tag.get('generated') is True:
            registry.put(f'generated:{owner.id}', identity, {'generated': True})
            registry.remove(scope, identity)
            continue
        value = {'asset': asset, 'scene': scene if current_scene(asset, scene) else None}
        if old != value:
            changed.add(identity)
            registry.put(scope, identity, value)
    if full:
        for identity in set(before) - found:
            registry.remove(scope, identity)
            changed.add(identity)
    for identity, value in registry.rows(scope).items():
        fresh = cache.get((owner.id, identity))
        if fresh != value.get('scene') and current_scene(value['asset'], fresh):
            registry.put(scope, identity, {**value, 'scene': fresh})
            changed.add(identity)
    cursor = ((owner.server_started_at or now) - timedelta(seconds=1)).isoformat()
    registry.put('owners', owner.id, {'cursor': cursor,
        'last_full': now.timestamp() if full else previous.get('last_full', 0)})
    for path, event_owner, _ in events:
        if event_owner == owner.id:
            path.unlink(missing_ok=True)
    return changed
