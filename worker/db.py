# Database connection abstraction.
#
# The worker needs to talk to either SQLite (local dev) or PostgreSQL (hybrid/prod).
# These two databases have different Python libraries with different APIs:
#
#   SQLite    → sqlite3 (built into Python)
#               parameter placeholders: ?
#               connection.execute(sql, params) works directly
#               PRAGMA commands for WAL mode and foreign keys
#
#   PostgreSQL → psycopg2 (third-party, pip install psycopg2-binary)
#               parameter placeholders: %s
#               must use a cursor: conn.cursor().execute(sql, params)
#               no PRAGMA support (not needed — PostgreSQL handles these natively)
#
# This module hides those differences behind a single get_conn() function.
# worker.py calls get_conn() and gets back a DbConn object that behaves
# the same regardless of which database is underneath.
#
# How it decides which DB to use:
#   DATABASE_URL set → PostgreSQL
#   SQLITE_PATH set (or default) → SQLite

import logging
import os
from pathlib import Path

logger = logging.getLogger(__name__)


# ─── Unified result object ────────────────────────────────────────────────────
#
# Both SQLite and PostgreSQL cursors return rows differently.
# This class gives both a consistent .fetchone() and .fetchall() that
# always return plain Python dicts (or None).

class _Result:
    def __init__(self, rows: list):
        self._rows = rows

    def fetchone(self) -> dict | None:
        return self._rows[0] if self._rows else None

    def fetchall(self) -> list[dict]:
        return self._rows


# ─── SQLite wrapper ───────────────────────────────────────────────────────────

class _SqliteConn:
    def __init__(self, raw_conn):
        self._conn = raw_conn

    def execute(self, sql: str, params=()) -> _Result:
        # sqlite3 connection.execute() returns a cursor directly.
        # We eagerly fetch all rows so the cursor can be discarded.
        cur = self._conn.execute(sql, params)
        rows = [dict(r) for r in cur.fetchall()]
        return _Result(rows)

    def close(self) -> None:
        self._conn.close()

    # "with conn:" support — SQLite's built-in transaction context manager.
    # On success: commits. On exception: rolls back.
    def __enter__(self):
        self._conn.__enter__()
        return self

    def __exit__(self, *args):
        return self._conn.__exit__(*args)


# ─── PostgreSQL wrapper ───────────────────────────────────────────────────────

class _PgConn:
    def __init__(self, raw_conn):
        self._conn = raw_conn
        # autocommit=False means we control transactions explicitly.
        # "with conn:" will commit or rollback as needed.
        self._conn.autocommit = False

    def execute(self, sql: str, params=()) -> _Result:
        # PostgreSQL uses %s placeholders instead of ?.
        # Replace all ? in the query before sending it.
        sql = sql.replace("?", "%s")

        # psycopg2 requires a cursor object — you can't call execute() on the
        # connection directly like SQLite. RealDictCursor makes rows behave like
        # dicts so we can access columns by name (e.g. row["id"]).
        import psycopg2.extras
        with self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(sql, params or None)
            # cur.description is None for queries that return no rows (INSERT, UPDATE
            # without RETURNING). Calling fetchall() on those would raise an error.
            rows = [dict(r) for r in cur.fetchall()] if cur.description else []
        return _Result(rows)

    def close(self) -> None:
        self._conn.close()

    # "with conn:" support — we manage the transaction manually here.
    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type:
            # Something went wrong — roll back so partial writes don't persist.
            self._conn.rollback()
        else:
            # All good — commit the transaction to make changes permanent.
            self._conn.commit()


# ─── Public entry point ───────────────────────────────────────────────────────

def get_conn():
    """
    Return a database connection for the current environment.

    If DATABASE_URL is set → connects to PostgreSQL.
    Otherwise → connects to SQLite using SQLITE_PATH.

    The returned object has .execute(sql, params), .close(),
    and supports "with conn:" for transactions.
    """
    database_url = os.environ.get("DATABASE_URL")

    if database_url:
        return _postgres_conn(database_url)

    sqlite_path = os.environ.get("SQLITE_PATH", "../web/prisma/dev.db")
    return _sqlite_conn(sqlite_path)


def _sqlite_conn(sqlite_path: str) -> _SqliteConn:
    import sqlite3
    db_path = Path(sqlite_path).resolve()
    logger.debug("Connecting to SQLite: %s", db_path)

    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row

    # WAL (Write-Ahead Logging): allows the Next.js web app and this worker
    # to read/write the DB simultaneously without blocking each other.
    conn.execute("PRAGMA journal_mode=WAL")

    # Enforce foreign key constraints (SQLite disables them by default).
    conn.execute("PRAGMA foreign_keys=ON")

    return _SqliteConn(conn)


def _postgres_conn(url: str) -> _PgConn:
    import psycopg2
    logger.debug("Connecting to PostgreSQL")
    conn = psycopg2.connect(url)
    return _PgConn(conn)
