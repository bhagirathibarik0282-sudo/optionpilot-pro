"""Versioned snapshots plus append-only economic/state events; no raw-tick retention."""
import json
from pathlib import Path
from .domain import STATES, integer, number, text

class StoreConflict(RuntimeError):
    pass

class TradeStore:
    def __init__(self, connection, scope, postgres=True):
        self.connection, self.scope, self.postgres = connection, text(scope, 'scope') , postgres
        self.owned = False
        self.replay_recorder = None

    @classmethod
    def connect(cls, url, scope):
        import psycopg2
        return cls(psycopg2.connect(url, connect_timeout=5,
            options='-c statement_timeout=3000 -c lock_timeout=2000'), scope)

    def _query(self, cur, sql, params=()):
        return cur.execute(sql if self.postgres else sql.replace('%s', '?'), params)

    def acquire(self):
        if self.postgres:
            with self.connection, self.connection.cursor() as cur:
                self._query(cur, 'SELECT pg_try_advisory_lock(hashtextextended(%s,0))', ('bnf-shadow:'+self.scope,))
                if not cur.fetchone()[0]:
                    raise StoreConflict('scope already owned by another worker')
        # SQLite is a test backend only, not a multi-process deployment backend.
        self.owned = True

    def migrate(self):
        sql = Path(__file__).with_name('schema.sql').read_text()
        with self.connection:
            cur = self.connection.cursor()
            try:
                if self.postgres:
                    cur.execute(sql)
                else:
                    clean = '\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--'))
                    for statement in clean.split(';'):
                        if statement.strip(): cur.execute(statement)
            finally: cur.close()

    def load(self, initial):
        if not self.owned: raise StoreConflict('scope ownership required')
        with self.connection:
            cur = self.connection.cursor()
            try:
                self._query(cur, 'INSERT INTO bnf_shadow_scope_v1(scope,version,payload) VALUES (%s,0,%s) ON CONFLICT(scope) DO NOTHING',
                    (self.scope, json.dumps(initial, allow_nan=False)))
                self._query(cur, 'SELECT version,payload FROM bnf_shadow_scope_v1 WHERE scope=%s', (self.scope,))
                version, payload = cur.fetchone()
                result = int(version), json.loads(payload)
            finally: cur.close()
        # Optional observational read runs after the original load transaction commits.
        # Its rollback/failure cannot roll back journal initialization or stop the engine.
        if self.replay_recorder:
            try:
                with self.connection:
                    cur = self.connection.cursor()
                    try:
                        self._query(cur, 'SELECT signal_id FROM bnf_shadow_signal_v1 WHERE scope=%s ORDER BY signal_id LIMIT 10001', (self.scope,))
                        signals = [r[0] for r in cur.fetchall()]
                    finally: cur.close()
                self.replay_recorder.start(result[0], result[1], signals)
            except Exception:
                self.replay_recorder.fail('CAPTURE_SEED_UNAVAILABLE')
        return result

    def has_signal(self, signal_id):
        with self.connection:
            cur = self.connection.cursor()
            try:
                self._query(cur, 'SELECT 1 FROM bnf_shadow_signal_v1 WHERE scope=%s AND signal_id=%s', (self.scope, signal_id))
                return cur.fetchone() is not None
            finally: cur.close()

    def save(self, expected_version, snapshot, event, signal_id=None):
        if not self.owned: raise StoreConflict('scope ownership required')
        active = snapshot.get('active')
        if active:
            if active['state'] not in STATES: raise ValueError('invalid trade state')
            filled, exited, requested = [integer(active[k], k, 0) for k in ('filled_qty','exited_qty','requested_qty')]
            if not 0 <= exited <= filled <= requested or requested == 0:
                raise ValueError('invalid quantity accounting')
            for key in ('entry_notional','exit_notional'):
                number(active[key], key)
        payload = json.dumps(snapshot, allow_nan=False, separators=(',', ':'))
        event_payload = json.dumps(event, allow_nan=False, separators=(',', ':'))
        with self.connection:
            cur = self.connection.cursor()
            try:
                self._query(cur, 'UPDATE bnf_shadow_scope_v1 SET version=version+1,payload=%s WHERE scope=%s AND version=%s',
                    (payload, self.scope, expected_version))
                if cur.rowcount != 1: raise StoreConflict('snapshot version conflict')
                self._query(cur, 'INSERT INTO bnf_shadow_event_v1(scope,event_id,intent_id,occurred_at,kind,payload) VALUES (%s,%s,%s,%s,%s,%s)',
                    (self.scope,event['event_id'],event['intent_id'],event['occurred_at'],event['kind'],event_payload))
                if signal_id is not None:
                    self._query(cur, 'INSERT INTO bnf_shadow_signal_v1(scope,signal_id,intent_id) VALUES (%s,%s,%s)',
                        (self.scope, signal_id, event['intent_id']))
            finally: cur.close()
        if self.replay_recorder:
            self.replay_recorder.journal(event)
        return expected_version + 1

    def close(self):
        self.owned = False
        self.connection.close()  # Releases PostgreSQL session advisory lock as well.
