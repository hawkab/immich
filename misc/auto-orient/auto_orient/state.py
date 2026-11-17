import fcntl
import json
import os
import sqlite3
from pathlib import Path
from typing import Any


class State:
    def __init__(self, directory: Path, server: str, owner: str):
        os.umask(0o077)
        directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.lock = (directory / "run.lock").open("a")
        fcntl.flock(self.lock, fcntl.LOCK_EX)
        self.db = sqlite3.connect(directory / "receipts.sqlite3")
        self.db.execute("CREATE TABLE IF NOT EXISTS binding(server TEXT,owner TEXT)")
        binding = self.db.execute("SELECT server,owner FROM binding").fetchone()
        if binding and binding != (server, owner):
            self.close()
            raise ValueError("Use a separate state directory for each Immich instance and owner")
        if not binding:
            self.db.execute("INSERT INTO binding VALUES(?,?)", (server, owner))
        self.db.execute("CREATE TABLE IF NOT EXISTS receipts(asset TEXT PRIMARY KEY,value TEXT,phase TEXT)")
        self.db.commit()

    def get(self, identity: str) -> tuple[dict[str, Any], str] | None:
        row = self.db.execute("SELECT value,phase FROM receipts WHERE asset=?", (identity,)).fetchone()
        return (json.loads(row[0]), row[1]) if row else None

    def save(self, value: dict[str, Any], phase: str) -> None:
        self.db.execute(
            "INSERT INTO receipts VALUES(?,?,?) ON CONFLICT(asset) DO UPDATE SET "
            "value=excluded.value,phase=excluded.phase",
            (value["id"], json.dumps(value), phase),
        )
        self.db.commit()

    def report(self) -> dict[str, int]:
        return dict(self.db.execute("SELECT phase,count(*) FROM receipts GROUP BY phase").fetchall())

    def close(self) -> None:
        self.db.close()
        self.lock.close()
