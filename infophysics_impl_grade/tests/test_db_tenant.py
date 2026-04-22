"""Test that set_tenant escapes single quotes in the tenant string.

set_tenant interpolates the tenant id into `SET LOCAL app.tenant_id =
'<id>'` because SET LOCAL does not accept bind parameters. The audit
note in api/db.py calls out that upstream handlers should regex-validate
the value; defense-in-depth says the escape must still hold if a bad
value slips through.
"""

from __future__ import annotations


class _CapturingCursor:
    """Records the SQL text passed to execute()."""
    def __init__(self):
        self.executed: list[str] = []

    def execute(self, sql, *args, **kwargs):
        self.executed.append(sql)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeConn:
    def __init__(self):
        self.cur = _CapturingCursor()

    def cursor(self):
        return self.cur


def test_set_tenant_escapes_single_quote():
    from api.db import set_tenant
    conn = _FakeConn()
    # Classic injection attempt: close the quote, drop the table.
    set_tenant(conn, "tenantA'; DROP TABLE users; --")
    sql = conn.cur.executed[0]
    # The single quote must be doubled, not left bare.
    assert "tenantA''; DROP TABLE users; --" in sql
    # And the whole value stays inside the surrounding quotes.
    assert sql.startswith("SET LOCAL app.tenant_id = '")
    assert sql.endswith("'")


def test_set_tenant_simple_value():
    from api.db import set_tenant
    conn = _FakeConn()
    set_tenant(conn, "tenantB")
    assert conn.cur.executed == ["SET LOCAL app.tenant_id = 'tenantB'"]
