"""Read-only checks for the existing SHADOW journal. Never initializes schema."""
REQUIRED = {
    'bnf_shadow_scope_v1': {'scope','version','payload'},
    'bnf_shadow_signal_v1': {'scope','signal_id','intent_id'},
    'bnf_shadow_event_v1': {'scope','event_id','intent_id','occurred_at','kind','payload'},
}

def check_journal(db_url):
    import psycopg2
    conn=psycopg2.connect(db_url,connect_timeout=5,options='-c default_transaction_read_only=on -c statement_timeout=3000')
    try:
        missing=[]
        with conn,conn.cursor() as cur:
            for table,required in REQUIRED.items():
                cur.execute("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=%s",(table,))
                if not required <= {r[0] for r in cur.fetchall()}:missing.append(table)
        return {'status':'SHADOW_PREFLIGHT_READY' if not missing else 'JOURNAL_SCHEMA_REQUIRED',
                'ready':not missing,'missing_tables':missing,'broker_orders':0,'journal_writes':0}
    finally:conn.close()
