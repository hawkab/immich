from .albums import sync_album
from .catalog import plan_buckets
from .ingest import synchronize
from .policy import eligible_assets
from .sources import digest


def process(owner, registry, profile, events, cache, now, *, should_stop=lambda: False):
    changed = synchronize(owner, registry, profile, events, cache, now)
    values = registry.rows('assets:' + owner.id)
    assets = [value['asset'] for value in values.values()]
    scenes = {identity: value['scene'] for identity, value in values.items()}
    allowed, excluded, waiting = eligible_assets(owner, registry, assets, scenes)
    groups = plan_buckets(allowed, scenes)
    stats = {'assets': len(assets), 'changed_assets': len(changed), 'albums': 0,
             'excluded_burial': len(excluded), 'waiting_for_scene': len(waiting), 'errors': []}
    scope = 'albums:' + owner.id
    for key, record in registry.rows(scope).items():
        if key not in groups and record.get('phase') not in ('deleted', 'detached'):
            groups[key] = {'key': key, 'title': '', 'theme': '', 'assets': [], 'input_digest': digest([])}
    for group in groups.values():
        if should_stop():
            break
        try:
            record = sync_album(owner, registry, group,
                share_with=profile.get('share_with', {}).get(owner.id, []), excluded_ids=set(excluded))
            if record.get('phase') == 'active':
                stats['albums'] += 1
        except Exception as error:
            stats['errors'].append({'bucket': group['key'], 'error_type': type(error).__name__, 'detail': str(error)})
    return stats
