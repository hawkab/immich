import hashlib
import json
from pathlib import Path
import tempfile
import urllib.error

from .albums import sync_album
from .catalog import curate, plan_buckets
from .ingest import synchronize
from .events import pending_sources
from .publishing import publish_memory
from .previews import PreviewPending, mark_preview_ready, request_regeneration, validate_preview
from .rendering import render_memory, select_memory_items
from .sources import digest, evict_verified_render, preview_item
from .status import save_status


def render_signature(group, record, profile):
    return digest({'input': group['input_digest'], 'excluded': sorted(record.get('exclusions', [])),
                   'title': group['title'], 'duration': profile.get('duration_seconds', 45), 'renderer': 1})


def pending_work(groups, profile, render_key=None):
    return any(group['render'] and record.get('phase') == 'active' and not record.get('video_suppressed')
               and (not render_key or render_key in (group['key'], group['theme']))
               and not (record.get('memory_phase') == 'verified' and record.get('render_input_digest') == render_signature(group, record, profile))
               and record.get('scheduler_waiting_signature') != render_signature(group, record, profile)
               for group, record in groups)


def process(owner, registry, profile, events, cache, now, *, render_key=None, should_stop=lambda: False, continuation=False):
    changed = synchronize(owner, registry, profile, events, cache, now)
    values = registry.rows(f'assets:{owner.id}')
    assets = [value['asset'] for value in values.values()]
    scenes = {identity: value['scene'] for identity, value in values.items()}
    groups = plan_buckets(assets, scenes)
    stats = {'assets': len(assets), 'changed_assets': len(changed), 'albums': 0,
             'rendered': 0, 'published': 0, 'unchanged_reels': 0, 'waiting': 0, 'errors': [],
             'continue_pending': False, 'cache_bytes_freed': 0}
    scope = 'albums:' + owner.id
    for key, old in registry.rows(scope).items():
        if key not in groups and old.get('phase') not in ('deleted', 'detached'):
            orphan = {'key': key, 'title': '', 'theme': '', 'render': False, 'assets': [], 'input_digest': digest([])}
            try:
                sync_album(owner, registry, orphan)
            except Exception as error:
                stats['errors'].append({'bucket': key, 'operation': 'obsolete_membership', 'error_type': type(error).__name__, 'detail': str(error)})
    summaries = {album['id']: album for album in owner.owned_albums()}
    prepared_groups = []
    for group in groups.values():
        if should_stop():
            break
        try:
            record = registry.get('albums:' + owner.id, group['key'], {})
            summary = summaries.get(record.get('album_id'))
            if not (record.get('phase') == 'active' and record.get('input_digest') == group['input_digest']
                    and record.get('membership_phase') == 'verified' and summary):
                record = sync_album(owner, registry, group, share_with=profile.get('share_with', {}).get(owner.id, []))
            if record.get('phase') == 'active':
                stats['albums'] += 1
            if summary:
                group['title'] = summary['albumName']
            prepared_groups.append((group, record))
        except Exception as error:
            stats['errors'].append({'bucket': group['key'], 'operation': 'album', 'error_type': type(error).__name__, 'detail': str(error)})
    priorities = {theme: index for index, theme in enumerate(profile.get('render_priority',
        ['horse', 'sea', 'celebration', 'travel', 'dog', 'cat', 'nature', 'creative', 'family']))}
    prepared_groups.sort(key=lambda item: (priorities.get(item[0]['theme'], 100), item[0]['key']))
    cursor = registry.get('scheduling:' + owner.id, 'last_bucket')
    positions = [index for index, item in enumerate(prepared_groups) if item[0]['key'] == cursor]
    if positions:
        offset = positions[0] + 1
        prepared_groups = prepared_groups[offset:] + prepared_groups[:offset]
    for position, (group, record) in enumerate(prepared_groups):
        if should_stop():
            break
        attempted, signature = False, None
        try:
            if record.get('phase') in ('detached', 'deleted', 'create_unknown') or not group['render'] or record.get('video_suppressed'):
                continue
            if render_key and render_key not in (group['key'], group['theme']):
                continue
            excluded = set(record.get('exclusions', record.get('excluded', [])))
            allowed = set(record.get('source_ids', [a['id'] for a in group['assets']]))
            candidates = curate([a for a in group['assets'] if a['id'] in allowed and a['id'] not in excluded and a.get('thumbhash')])
            signature = render_signature(group, record, profile)
            destination = Path(profile['state_directory']) / 'renders' / owner.id / digest(group['key']) / signature
            receipt = destination / 'render-result.json'
            if not candidates:
                record['scheduler_waiting_signature'] = signature
                registry.put(scope, group['key'], record)
                stats['waiting'] += 1
                continue
            if record.get('render_input_digest') == signature and record.get('memory_phase') == 'verified':
                if receipt.is_file():
                    cleanup = evict_verified_render(destination, json.loads(receipt.read_text()), record, signature)
                    stats['cache_bytes_freed'] += cleanup['bytes_freed']
                stats['unchanged_reels'] += 1
                continue
            if continuation and not changed and record.get('scheduler_waiting_signature') == signature:
                stats['waiting'] += 1
                continue
            pending = registry.get(f'pending:{owner.id}', group['key'], {})
            if pending.get('signature') != signature:
                pending = {'signature': signature, 'since': now.timestamp()}
                registry.put(f'pending:{owner.id}', group['key'], pending)
            historic = max(a.get('localDateTime', a['fileCreatedAt'])[:10] for a in candidates) < now.date().isoformat()
            quiet = now.timestamp() - pending['since'] >= profile.get('settle_seconds', 300)
            if not (historic or quiet or render_key):
                record['scheduler_waiting_signature'] = signature
                registry.put(scope, group['key'], record)
                stats['waiting'] += 1
                continue
            items = [preview_item(asset) for asset in candidates]
            selected = select_memory_items(items, profile.get('duration_seconds', 45))
            destination.mkdir(parents=True, exist_ok=True, mode=0o700)
            result = json.loads(receipt.read_text()) if receipt.is_file() else None
            if result is not None:
                video = Path(result['video'])
                if not video.is_file():
                    raise RuntimeError('Cached render output changed; preserve its publication intent')
                with video.open('rb') as source:
                    if hashlib.file_digest(source, 'sha256').hexdigest() != result['video_sha256']:
                        raise RuntimeError('Cached render output changed; preserve its publication intent')
            else:
                revisions = {}
                with tempfile.TemporaryDirectory(prefix='previews-', dir=destination) as temporary:
                    paths = {}
                    for item in selected:
                        asset = values[item['id']]['asset']
                        revisions[asset['id']] = {key: asset.get(key) for key in ('checksum', 'thumbhash', 'isEdited')}
                        if asset.get('isEdited'):
                            revisions[asset['id']]['edits'] = owner.call('/assets/' + asset['id'] + '/edits')
                        try:
                            try:
                                raw, headers = owner.preview(asset)
                            except urllib.error.HTTPError as error:
                                if error.code not in (404, 409):
                                    raise
                                raise PreviewPending('The native preview is not ready') from error
                            proof = validate_preview(asset, revisions[asset['id']].get('edits', []), headers)
                        except PreviewPending:
                            request_regeneration(owner, registry, asset)
                            raise
                        revisions[asset['id']]['preview_proof'] = proof
                        mark_preview_ready(owner, registry, asset, revisions[asset['id']].get('edits', []), proof)
                        if asset.get('isEdited') and revisions[asset['id']]['edits'] != owner.call('/assets/' + asset['id'] + '/edits'):
                            raise RuntimeError('Source edits changed during preview fetch')
                        path = Path(temporary) / (asset['id'] + '.image')
                        path.write_bytes(raw)
                        paths[item['id']] = {'path': path, 'sha256': hashlib.sha256(raw).hexdigest()}
                    prepared = [{**item, **paths.get(item['id'], {})} for item in items]
                    attempted = True
                    result = render_memory(prepared, destination, title=group['title'], theme=group['theme'],
                                           duration_seconds=profile.get('duration_seconds', 45))
                result.update(input_digest=signature, source_revisions=revisions)
                save_status(receipt, result)
                stats['rendered'] += 1
            attempted = True
            published = publish_memory(owner, registry, group, record, result)
            if published.get('memory_phase') == 'verified':
                stats['published'] += 1
                published.pop('scheduler_waiting_signature', None)
                registry.put(scope, group['key'], published)
                cleanup = evict_verified_render(destination, result, registry.get(scope, group['key']), signature)
                stats['cache_bytes_freed'] += cleanup['bytes_freed']
            else:
                published['scheduler_waiting_signature'] = signature
                registry.put(scope, group['key'], published)
                stats['waiting'] += 1
            if pending_sources(profile['event_directory'], registry):
                stats['yielded_to_new_sources'] = True
                break
        except PreviewPending:
            record['scheduler_waiting_signature'] = signature
            registry.put(scope, group['key'], record)
            stats['waiting'] += 1
        except Exception as error:
            stats['errors'].append({'bucket': group['key'], 'error_type': type(error).__name__, 'detail': str(error)})
            if signature:
                current = registry.get(scope, group['key'], record)
                current['scheduler_waiting_signature'] = signature
                registry.put(scope, group['key'], current)
        if attempted:
            registry.put('scheduling:' + owner.id, 'last_bucket', group['key'])
            remaining = prepared_groups[position + 1:]
            stats['continue_pending'] = pending_work(remaining, profile, render_key)
            break
    return stats
