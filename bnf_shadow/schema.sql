-- Additive SHADOW-only migration. Apply explicitly; never run by dashboard startup.
CREATE TABLE IF NOT EXISTS bnf_shadow_scope_v1 (
    scope TEXT PRIMARY KEY,
    version BIGINT NOT NULL CHECK (version >= 0),
    payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bnf_shadow_signal_v1 (
    scope TEXT NOT NULL REFERENCES bnf_shadow_scope_v1(scope),
    signal_id TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    PRIMARY KEY(scope, signal_id)
);
CREATE TABLE IF NOT EXISTS bnf_shadow_event_v1 (
    scope TEXT NOT NULL REFERENCES bnf_shadow_scope_v1(scope),
    event_id TEXT NOT NULL,
    intent_id TEXT NOT NULL,
    occurred_at TEXT NOT NULL,
    kind TEXT NOT NULL,
    payload TEXT NOT NULL,
    PRIMARY KEY(scope, event_id)
);
CREATE INDEX IF NOT EXISTS bnf_shadow_event_intent_v1 ON bnf_shadow_event_v1(scope, intent_id);
