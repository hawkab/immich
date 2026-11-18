import uuid


def member_ids(album):
    if not isinstance(album.get('assets'), list):
        raise ValueError('Album membership requires an authoritative native readback')
    return {asset['id'] for asset in album['assets']}


def managed_album(owner, record):
    album = owner.album(record['album_id'])
    if album is None:
        return None, 'deleted'
    if not album.get('albumUsers') or album['albumUsers'][0]['user']['id'] != owner.id:
        raise PermissionError('Automatic album belongs to another owner')
    if record['marker'] not in (album.get('description') or '').splitlines():
        return None, 'detached'
    return album, 'active'


def sync_album(owner, registry, bucket, *, share_with=(), excluded_ids=frozenset()):
    scope, key = 'albums:' + owner.id, bucket['key']
    record = registry.get(scope, key)

    def save():
        registry.put(scope, key, record)
        return record

    desired = {asset['id'] for asset in bucket['assets']} - excluded_ids
    if any(asset.get('ownerId') != owner.id or asset.get('isTrashed') for asset in bucket['assets']):
        raise PermissionError('Automatic albums accept only current assets of this owner')
    if record and record['phase'] in ('deleted', 'detached'):
        return record
    fresh = record is None
    if fresh:
        record = {'phase': 'create_intent', 'marker': '[aegis:memory:v1:' + str(uuid.uuid4()) + ']',
                  'exclusions': [], 'managed_source_ids': [], 'source_ids': []}
        save()
    if not record.get('album_id'):
        if not fresh:
            matches = [item for item in owner.owned_albums()
                       if record['marker'] in (item.get('description') or '').splitlines()]
            if len(matches) != 1:
                record['phase'] = 'create_unknown'
                return save()
            record['album_id'] = matches[0]['id']
            save()
        else:
            body = {'albumName': bucket['title'],
                    'description': 'Автоматическая подборка. Ваши названия, обложки и изменения сохраняются.\n\n' + record['marker'],
                    'albumUsers': [{'userId': identity, 'role': 'viewer'}
                                   for identity in sorted(set(share_with) - {owner.id})]}
            try:
                created = owner.call('/albums', body, 'POST')
            except Exception as error:
                record.update(phase='create_unknown', create_error=type(error).__name__)
                return save()
            record['album_id'] = created['id']
            save()
    album, record['phase'] = managed_album(owner, record)
    if album is None:
        return save()
    current, managed = member_ids(album), set(record.get('managed_source_ids', []))
    exclusions = set(record.get('exclusions', [])) | (managed - current)
    uncertain = set(record.get('membership_uncertain_ids', []))
    uncertain_removals = set(record.get('membership_uncertain_removals', []))
    pending = record.pop('pending_membership', None)
    if pending:
        uncertain |= set(pending.get('add', [])) - current
        managed |= set(pending.get('add', [])) & current
        uncertain_removals |= set(pending.get('remove', [])) & current
        managed -= set(pending.get('remove', []))
    managed |= uncertain & current
    uncertain -= current
    uncertain_removals &= current
    add = desired - exclusions - uncertain - current
    remove = ((managed & current) - desired) | (current & excluded_ids)
    record['exclusions'] = sorted(exclusions)
    if add or remove:
        record['pending_membership'] = {'add': sorted(add), 'remove': sorted(remove)}
        save()
        try:
            if add:
                owner.call('/albums/' + record['album_id'] + '/assets', {'ids': sorted(add)}, 'PUT')
            if remove:
                owner.call('/albums/' + record['album_id'] + '/assets', {'ids': sorted(remove)}, 'DELETE')
            album, record['phase'] = managed_album(owner, record)
            if album is None:
                return save()
        except Exception as error:
            record['membership_phase'] = 'unknown:' + type(error).__name__
            return save()
        current = member_ids(album)
        managed = (managed - remove) | (add & current)
        uncertain |= add - current
        record.pop('pending_membership', None)
    record.update(phase='active', input_digest=bucket['input_digest'], exclusions=sorted(exclusions),
                  managed_source_ids=sorted(managed & current), source_ids=sorted((desired - exclusions) & current),
                  membership_uncertain_ids=sorted(uncertain), membership_uncertain_removals=sorted(uncertain_removals),
                  membership_phase='unknown_add_or_remove' if uncertain or uncertain_removals else 'verified')
    return save()
