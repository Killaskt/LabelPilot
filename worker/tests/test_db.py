"""
Tests for the db.py database abstraction layer.

Covers:
  - _Result: fetchone / fetchall behaviour on empty and populated result sets
  - _SqliteConn: execute with and without params, context-manager commit/rollback
  - _PgConn: ? → %s placeholder substitution, commit on success, rollback on error
  - get_conn(): routes to _SqliteConn when DATABASE_URL is absent,
                routes to _PgConn  when DATABASE_URL is present (connection mocked)
"""

import os
import sqlite3
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from db import _PgConn, _Result, _SqliteConn, get_conn


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _memory_sqlite_conn() -> _SqliteConn:
    """Return a _SqliteConn backed by an in-memory SQLite database."""
    raw = sqlite3.connect(":memory:")
    raw.row_factory = sqlite3.Row
    raw.execute("PRAGMA foreign_keys=ON")
    return _SqliteConn(raw)


def _mock_pg_conn() -> tuple[_PgConn, MagicMock, MagicMock]:
    """Return a (_PgConn, mock_connection, mock_cursor) triple for unit tests."""
    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.description = None          # pretend no rows returned
    mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
    mock_conn.cursor.return_value.__exit__.return_value = False
    return _PgConn(mock_conn), mock_conn, mock_cursor


# ─── _Result ──────────────────────────────────────────────────────────────────

class TestResult:
    def test_fetchone_empty_returns_none(self):
        assert _Result([]).fetchone() is None

    def test_fetchone_returns_first_row(self):
        rows = [{"id": "a"}, {"id": "b"}]
        assert _Result(rows).fetchone() == {"id": "a"}

    def test_fetchall_empty_returns_empty_list(self):
        assert _Result([]).fetchall() == []

    def test_fetchall_returns_all_rows(self):
        rows = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
        assert _Result(rows).fetchall() == rows

    def test_fetchall_returns_independent_list(self):
        rows = [{"id": "a"}]
        result = _Result(rows)
        # Modifying the returned list must not affect internal state
        result.fetchall().append({"id": "z"})
        assert len(result.fetchall()) == 1


# ─── _SqliteConn ──────────────────────────────────────────────────────────────

class TestSqliteConn:
    def test_execute_no_params(self):
        conn = _memory_sqlite_conn()
        conn._conn.execute("CREATE TABLE t (x INTEGER)")
        conn._conn.execute("INSERT INTO t VALUES (42)")
        result = conn.execute("SELECT x FROM t")
        assert result.fetchone() == {"x": 42}
        conn.close()

    def test_execute_with_params(self):
        conn = _memory_sqlite_conn()
        conn._conn.execute("CREATE TABLE t (name TEXT)")
        conn._conn.execute("INSERT INTO t VALUES ('alpha')")
        conn._conn.execute("INSERT INTO t VALUES ('beta')")
        result = conn.execute("SELECT name FROM t WHERE name = ?", ("alpha",))
        row = result.fetchone()
        assert row is not None
        assert row["name"] == "alpha"
        conn.close()

    def test_fetchall_returns_multiple_rows(self):
        conn = _memory_sqlite_conn()
        conn._conn.execute("CREATE TABLE t (v INTEGER)")
        conn._conn.executemany("INSERT INTO t VALUES (?)", [(1,), (2,), (3,)])
        rows = conn.execute("SELECT v FROM t ORDER BY v").fetchall()
        assert [r["v"] for r in rows] == [1, 2, 3]
        conn.close()

    def test_context_manager_commits_on_success(self):
        conn = _memory_sqlite_conn()
        conn._conn.execute("CREATE TABLE t (x INTEGER)")
        with conn:
            conn.execute("INSERT INTO t VALUES (99)")
        rows = conn.execute("SELECT x FROM t").fetchall()
        assert len(rows) == 1
        assert rows[0]["x"] == 99
        conn.close()

    def test_context_manager_rolls_back_on_exception(self):
        conn = _memory_sqlite_conn()
        conn._conn.execute("CREATE TABLE t (x INTEGER)")
        conn._conn.commit()
        try:
            with conn:
                conn.execute("INSERT INTO t VALUES (1)")
                raise RuntimeError("simulated failure")
        except RuntimeError:
            pass
        rows = conn.execute("SELECT x FROM t").fetchall()
        assert rows == [], "INSERT should have been rolled back"
        conn.close()

    def test_execute_insert_returns_empty_result(self):
        conn = _memory_sqlite_conn()
        conn._conn.execute("CREATE TABLE t (x INTEGER)")
        result = conn.execute("INSERT INTO t VALUES (7)")
        # INSERT without RETURNING has no rows — fetchone returns None
        assert result.fetchone() is None
        conn.close()


# ─── _PgConn — tested with a mocked psycopg2 connection ──────────────────────

class TestPgConn:
    def test_placeholder_substitution_single(self):
        pg, _, mock_cursor = _mock_pg_conn()
        pg.execute("SELECT * FROM t WHERE id = ?", ("abc",))
        sql_sent = mock_cursor.execute.call_args[0][0]
        assert sql_sent == "SELECT * FROM t WHERE id = %s"

    def test_placeholder_substitution_multiple(self):
        pg, _, mock_cursor = _mock_pg_conn()
        pg.execute("UPDATE t SET a = ?, b = ? WHERE id = ?", (1, 2, 3))
        sql_sent = mock_cursor.execute.call_args[0][0]
        assert sql_sent.count("%s") == 3
        assert "?" not in sql_sent

    def test_no_placeholders_unchanged(self):
        pg, _, mock_cursor = _mock_pg_conn()
        pg.execute("SELECT 1")
        sql_sent = mock_cursor.execute.call_args[0][0]
        assert sql_sent == "SELECT 1"

    def test_commit_called_on_success(self):
        pg, mock_conn, _ = _mock_pg_conn()
        with pg:
            pg.execute("SELECT 1")
        mock_conn.commit.assert_called_once()
        mock_conn.rollback.assert_not_called()

    def test_rollback_called_on_exception(self):
        pg, mock_conn, _ = _mock_pg_conn()
        try:
            with pg:
                raise ValueError("boom")
        except ValueError:
            pass
        mock_conn.rollback.assert_called_once()
        mock_conn.commit.assert_not_called()

    def test_rows_returned_as_dicts(self):
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_cursor.description = True          # signal rows are present
        mock_cursor.fetchall.return_value = [{"id": "x", "val": 1}]
        mock_conn.cursor.return_value.__enter__.return_value = mock_cursor
        mock_conn.cursor.return_value.__exit__.return_value = False

        pg = _PgConn(mock_conn)
        result = pg.execute("SELECT id, val FROM t")
        assert result.fetchone() == {"id": "x", "val": 1}

    def test_no_description_returns_empty(self):
        pg, _, mock_cursor = _mock_pg_conn()
        mock_cursor.description = None
        result = pg.execute("INSERT INTO t VALUES (%s)", (1,))
        assert result.fetchall() == []


# ─── get_conn() routing ───────────────────────────────────────────────────────

class TestGetConn:
    def test_returns_sqlite_conn_when_no_database_url(self, tmp_path, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        monkeypatch.setenv("SQLITE_PATH", str(tmp_path / "test.db"))
        conn = get_conn()
        assert isinstance(conn, _SqliteConn)
        conn.close()

    def test_uses_sqlite_path_env_var(self, tmp_path, monkeypatch):
        monkeypatch.delenv("DATABASE_URL", raising=False)
        db_path = tmp_path / "custom.db"
        monkeypatch.setenv("SQLITE_PATH", str(db_path))
        conn = get_conn()
        assert isinstance(conn, _SqliteConn)
        conn.close()

    def test_returns_pg_conn_when_database_url_set(self, monkeypatch):
        monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@host/db")
        with patch("db._postgres_conn") as mock_pg:
            mock_pg.return_value = MagicMock(spec=_PgConn)
            conn = get_conn()
            mock_pg.assert_called_once_with("postgresql://user:pw@host/db")
            assert conn is mock_pg.return_value
