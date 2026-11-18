"""Opt-in real PostgreSQL tests; creates its own local Unix-socket cluster.

No DATABASE_URL is accepted or read. Never points at Railway/production.
"""
from copy import deepcopy
from datetime import timedelta
import os
from pathlib import Path
import tempfile
import unittest
import uuid
from .domain import BNFConfig
from .engine import OrderStateMachine
from .store import TradeStore, StoreConflict
from .test_bnf_shadow import NOW, sig, tick


@unittest.skipUnless(os.environ.get('BNF_SHADOW_REAL_PG_TEST') == '1', 'isolated real PostgreSQL tests opt-in')
class RealPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import pgserver
        import psycopg2
        cls.pg_tmp = tempfile.TemporaryDirectory(prefix='bnf-shadow-real-pg-')
        try:
            cls.pg = pgserver.get_server(Path(cls.pg_tmp.name)/'data', cleanup_mode='stop')
            cls.url = cls.pg.get_uri()
            cls.driver = psycopg2
            cls.admin = psycopg2.connect(cls.url)
            cls.admin.autocommit = True
            with cls.admin.cursor() as cur:
                cur.execute('SELECT version()')
                cls.pg_version = cur.fetchone()[0]
        except BaseException:
            if hasattr(cls, 'pg'): cls.pg.cleanup()
            cls.pg_tmp.cleanup()
            raise

    @classmethod
    def tearDownClass(cls):
        cls.admin.close()
        cls.pg.cleanup()
        cls.pg_tmp.cleanup()

    def setUp(self):
        self.stores = []
        self.scope = 'isolated-pg-test:'+uuid.uuid4().hex
        self.store = self.connect()
        self.store.acquire(); self.store.migrate()
        self.engine = OrderStateMachine(BNFConfig(), self.store, startup_now=NOW)

    def connect(self, scope=None):
        store = TradeStore.connect(self.url, scope or self.scope)
        self.stores.append(store)
        return store

    def tearDown(self):
        for store in self.stores:
            store.close()

    def scalar(self, query, params=()):
        with self.admin.cursor() as cur:
            cur.execute(query, params)
            return cur.fetchone()[0]

    def test_second_connection_excluded_until_owner_closes(self):
        other = self.connect()
        with self.assertRaises(StoreConflict): other.acquire()
        self.assertFalse(other.owned)
        self.store.close()
        other.acquire()
        self.assertTrue(other.owned)
        self.assertEqual(other.load({})[0], 0)

    def test_different_scopes_can_run_independently(self):
        other = self.connect(self.scope+':independent')
        other.acquire(); other.load({'test': 'independent'})
        self.engine.on_signal(sig(), NOW)
        self.assertEqual(other.load({})[1], {'test': 'independent'})

    def test_filled_position_survives_new_connection_and_requires_fresh_exit(self):
        self.engine.on_signal(sig(), NOW)
        self.engine.on_tick(tick(1), NOW+timedelta(seconds=1))
        intent = self.engine.active['intent_id']
        self.store.close()
        resumed = self.connect(); resumed.acquire()
        engine = OrderStateMachine(BNFConfig(), resumed, startup_now=NOW+timedelta(seconds=2))
        self.assertEqual(engine.active['intent_id'], intent)
        self.assertEqual(engine.active['state'], 'RECONCILIATION_REQUIRED')
        engine.on_tick(tick(3), NOW+timedelta(seconds=3))
        self.assertEqual(engine.active['state'], 'EXIT_PENDING')
        self.assertEqual(engine.active['exited_qty'], 0)
        engine.on_tick(tick(4), NOW+timedelta(seconds=4))
        self.assertIsNone(engine.active)
        self.assertEqual(resumed.load({})[1]['last_result']['intent_id'], intent)

    def event(self, event_id=None):
        return dict(event_id=event_id or uuid.uuid4().hex, intent_id='test-intent',
                    occurred_at=NOW.isoformat(), kind='SQL_ATOMICITY_TEST', details={})

    def test_duplicate_event_rolls_back_snapshot_version(self):
        event = self.event()
        snapshot = deepcopy(self.engine.snapshot)
        version = self.store.save(self.engine.version, snapshot, event)
        with self.assertRaises(self.driver.IntegrityError):
            self.store.save(version, {**snapshot, 'would_be_corrupt': True}, event)
        actual_version, actual_snapshot = self.store.load({})
        self.assertEqual(actual_version, version)
        self.assertNotIn('would_be_corrupt', actual_snapshot)
        self.assertEqual(self.scalar('SELECT count(*) FROM bnf_shadow_event_v1 WHERE scope=%s', (self.scope,)), 1)

    def test_duplicate_signal_rolls_back_event_and_snapshot(self):
        snapshot = deepcopy(self.engine.snapshot)
        version = self.store.save(self.engine.version, snapshot, self.event(), signal_id='duplicate-signal')
        with self.assertRaises(self.driver.IntegrityError):
            self.store.save(version, {**snapshot, 'would_be_corrupt': True}, self.event(), signal_id='duplicate-signal')
        self.assertEqual(self.store.load({}), (version, snapshot))
        self.assertEqual(self.scalar('SELECT count(*) FROM bnf_shadow_event_v1 WHERE scope=%s', (self.scope,)), 1)
        self.assertTrue(self.store.has_signal('duplicate-signal'))

    def test_terminated_database_session_blocks_old_worker_and_releases_lock(self):
        self.engine.on_signal(sig(), NOW)
        old_version = self.engine.version
        pid = self.store.connection.get_backend_pid()
        self.assertTrue(self.scalar('SELECT pg_terminate_backend(%s)', (pid,)))
        # The old connection cannot silently reconnect and retain ownership.
        with self.assertRaises(self.driver.Error):
            self.engine.on_tick(tick(1), NOW+timedelta(seconds=1))
        self.assertFalse(self.engine.logging_healthy)
        other = self.connect(); other.acquire()
        version, snapshot = other.load({})
        self.assertEqual(version, old_version)
        self.assertEqual(snapshot['active']['filled_qty'], 0)
        with self.assertRaises(RuntimeError):
            self.engine.on_signal(sig(signal_id='must-not-trade'), NOW)


if __name__ == '__main__': unittest.main()
