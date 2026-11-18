import argparse
from datetime import datetime, timezone
import fcntl
import json
import os
from pathlib import Path
import signal
from threading import Event

from .client import Owner
from .events import claim, wait_for_changes
from .pipeline import process
from .sources import scene_cache
from .state import Registry
from .status import save_status

STOP = Event()


def run(profile, *, once=False, render_key=None):
    os.umask(0o077)
    directory = Path(profile['state_directory'])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (directory / 'worker.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        registry = Registry(directory / 'registry.sqlite3')
        sessions = {}
        continuation = False
        try:
            while not STOP.is_set():
                now = datetime.now(timezone.utc)
                events = list(claim(profile['event_directory'], directory / 'claimed'))
                if any(not registry.get('generated:' + owner_id, asset_id) for _, owner_id, asset_id in events):
                    continuation = False
                cache = scene_cache(profile.get('scene_cache'))
                accounts = [Path(profile['credential_directory']) / 'login.json']
                accounts += sorted((Path(profile['credential_directory']) / 'users').glob('*.login.json'))
                status = {'at': now.isoformat(), 'phase': 'processing', 'owners': {}}
                for credential in accounts:
                    if not credential.is_file():
                        continue
                    owner = None
                    try:
                        owner = sessions.get(credential)
                        if owner is None:
                            owner = sessions[credential] = Owner(profile, credential)
                        status['owners'][owner.id] = process(owner, registry, profile, events, cache, now,
                                                              render_key=render_key, should_stop=STOP.is_set, continuation=continuation)
                        save_status(directory / 'STATUS.json', status)
                    except Exception as error:
                        identity = owner.id if owner else 'credential:' + credential.name
                        status['owners'][identity] = {'errors': [{'operation': 'source_sync', 'error_type': type(error).__name__, 'detail': str(error)}]}
                        if getattr(error, 'code', None) == 401:
                            sessions.pop(credential, None)
                status['phase'] = 'watching' if all(not s['errors'] for s in status['owners'].values()) else 'reconciliation_pending'
                if not status['owners']:
                    status['phase'] = 'waiting_for_owners'
                save_status(directory / 'STATUS.json', status)
                if once:
                    return status
                if STOP.is_set():
                    return status
                continuation = any(value.get('continue_pending') for value in status['owners'].values())
                if continuation:
                    continue
                wait_for_changes(profile['event_directory'], profile.get('poll_seconds', 60))
        finally:
            for owner in sessions.values():
                try:
                    owner.close()
                except Exception:
                    pass
            registry.close()


def main():
    signal.signal(signal.SIGTERM, lambda *_: STOP.set())
    signal.signal(signal.SIGINT, lambda *_: STOP.set())
    parser = argparse.ArgumentParser()
    parser.add_argument('profile', type=Path)
    parser.add_argument('--once', action='store_true')
    parser.add_argument('--render-key')
    args = parser.parse_args()
    result = run(json.loads(args.profile.read_text()), once=args.once, render_key=args.render_key)
    if result:
        print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
