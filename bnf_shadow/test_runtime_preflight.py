from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import json
import os
import sys
import unittest
from .runtime_preflight import REQUIRED,check_journal

class PreflightTests(unittest.TestCase):
    def fixture(self,missing=False):
        state={'closed':False,'queries':[],'options':None}
        class Cursor:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def execute(self,query,params):
                if not query.startswith('SELECT '):raise AssertionError('preflight must be read-only')
                state['queries'].append(query);self.table=params[0]
            def fetchall(self):return [] if missing else [(name,) for name in REQUIRED[self.table]]
        class Connection:
            def __enter__(self):return self
            def __exit__(self,*a):pass
            def cursor(self):return Cursor()
            def close(self):state['closed']=True
        def connect(*a,**kw):state['options']=kw.get('options');return Connection()
        return state,SimpleNamespace(connect=connect)
    def test_schema_check_is_read_only_and_closes_connection(self):
        state,driver=self.fixture()
        with patch.dict(sys.modules,{'psycopg2':driver}):report=check_journal('synthetic-url')
        self.assertTrue(report['ready']);self.assertEqual(report['journal_writes'],0)
        self.assertIn('default_transaction_read_only=on',state['options']);self.assertTrue(state['closed'])
    def test_missing_schema_returns_explicit_blocker_without_creation(self):
        state,driver=self.fixture(True)
        with patch.dict(sys.modules,{'psycopg2':driver}):report=check_journal('synthetic-url')
        self.assertFalse(report['ready']);self.assertEqual(report['status'],'JOURNAL_SCHEMA_REQUIRED')
        self.assertEqual(len(report['missing_tables']),3)
    def test_preflight_flag_is_separate_from_schema_initialization(self):
        from .__main__ import main
        with patch.object(sys,'argv',['bnf','--config','unused','--preflight','--init-schema']):
            with self.assertRaisesRegex(ValueError,'separate read-only'):main()
    def test_cli_preflight_never_opens_mutating_trade_store(self):
        import contextlib
        import io
        from . import __main__ as runner
        from .test_bnf_shadow import NOW
        from .test_snapshot_source import CSV
        output=io.StringIO()
        provider=SimpleNamespace(resolve=lambda:SimpleNamespace(user_id='TEST',token='synthetic'),verify=lambda session:None,get=lambda path,session:CSV.encode())
        args=['bnf','--config',str(Path(__file__).parent/'examples'/'one_lot.json'),'--preflight']
        with patch.object(sys,'argv',args),patch.dict(os.environ,{'DATABASE_URL':'synthetic','EXECUTION_MODE':'SHADOW'}),patch.object(runner,'datetime',SimpleNamespace(now=lambda tz:NOW)),patch.object(runner,'SessionProvider',return_value=provider),patch('bnf_shadow.runtime_preflight.check_journal',return_value={'status':'SHADOW_PREFLIGHT_READY','ready':True,'journal_writes':0}),patch.object(runner.TradeStore,'connect',side_effect=AssertionError('must not open mutating store')),contextlib.redirect_stdout(output):
            runner.main()
        self.assertTrue(json.loads(output.getvalue())['ready'])

if __name__=='__main__':unittest.main()
