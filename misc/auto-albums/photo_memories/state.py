import json
from pathlib import Path
import sqlite3


class Registry:
    def __init__(self, path):
        Path(path).parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(path)
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.execute('CREATE TABLE IF NOT EXISTS records (scope TEXT, key TEXT, value TEXT, '
                        'PRIMARY KEY(scope,key))')
        self.db.commit()

    def get(self, scope, key, default=None):
        row = self.db.execute('SELECT value FROM records WHERE scope=? AND key=?', (scope, key)).fetchone()
        return json.loads(row[0]) if row else default

    def put(self, scope, key, value):
        self.db.execute('INSERT INTO records VALUES(?,?,?) ON CONFLICT(scope,key) DO UPDATE '
                        'SET value=excluded.value', (scope, key, json.dumps(value, ensure_ascii=False)))
        self.db.commit()

    def rows(self, scope):
        return {key: json.loads(value) for key, value in self.db.execute(
            'SELECT key,value FROM records WHERE scope=?', (scope,))}

    def remove(self, scope, key):
        self.db.execute('DELETE FROM records WHERE scope=? AND key=?', (scope, key))
        self.db.commit()

    def close(self):
        self.db.close()
