import { dbQuerySafe } from "./db.js";
import type { CandidateLifecycleRecord, DerivedHistoryState, OutcomeAttribution } from "./h1-derived-history.js";

export async function ensureH1DerivedSchema(): Promise<boolean> {
  const res = await dbQuerySafe(`
    CREATE TABLE IF NOT EXISTS h1_derived_state (
      id BIGSERIAL PRIMARY KEY,
      symbol TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      snapshot_id TEXT,
      mode TEXT NOT NULL,
      direction TEXT NOT NULL,
      regime TEXT NOT NULL,
      maturity TEXT NOT NULL,
      evidence_quality TEXT NOT NULL,
      evidence_completeness_pct DOUBLE PRECISION,
      conflict_count INTEGER NOT NULL DEFAULT 0,
      candidate_age_minutes INTEGER,
      no_chase BOOLEAN NOT NULL DEFAULT false,
      overextended BOOLEAN NOT NULL DEFAULT false,
      multi_horizon_alignment TEXT NOT NULL,
      regime_survival_count INTEGER NOT NULL DEFAULT 0,
      premium_pair JSONB,
      evidence_families JSONB NOT NULL DEFAULT '[]'::jsonb,
      fii_dii_context TEXT NOT NULL,
      reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      rule_version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(symbol, observed_at, mode, rule_version)
    );
    CREATE INDEX IF NOT EXISTS idx_h1_derived_state_symbol_mode_time
      ON h1_derived_state(symbol, mode, observed_at DESC);

    CREATE TABLE IF NOT EXISTS h1_candidate_lifecycle (
      id BIGSERIAL PRIMARY KEY,
      candidate_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      mode TEXT NOT NULL,
      observed_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL,
      direction TEXT NOT NULL,
      expiry DATE,
      strike INTEGER,
      side CHAR(2),
      entry_low DOUBLE PRECISION,
      entry_high DOUBLE PRECISION,
      sl DOUBLE PRECISION,
      t1 DOUBLE PRECISION,
      t2 DOUBLE PRECISION,
      t3 DOUBLE PRECISION,
      current_premium DOUBLE PRECISION,
      opposite_premium DOUBLE PRECISION,
      reason_codes JSONB NOT NULL DEFAULT '[]'::jsonb,
      evidence_quality TEXT NOT NULL,
      rule_version TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE(candidate_id, observed_at, status)
    );
    CREATE INDEX IF NOT EXISTS idx_h1_candidate_lifecycle_candidate_time
      ON h1_candidate_lifecycle(candidate_id, observed_at DESC);

    CREATE TABLE IF NOT EXISTS h1_outcome_attribution (
      id BIGSERIAL PRIMARY KEY,
      candidate_id TEXT NOT NULL UNIQUE,
      closed_at TIMESTAMPTZ NOT NULL,
      outcome TEXT NOT NULL,
      mfe_pct DOUBLE PRECISION,
      mae_pct DOUBLE PRECISION,
      time_to_t1_minutes INTEGER,
      time_to_stop_minutes INTEGER,
      regime_survival_count INTEGER NOT NULL DEFAULT 0,
      exit_reason_code TEXT,
      direction_correct BOOLEAN,
      timing_correct BOOLEAN,
      premium_selection_correct BOOLEAN,
      user_discipline_issue BOOLEAN,
      notes JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  return res !== null;
}

export async function persistH1DerivedState(row: DerivedHistoryState): Promise<boolean> {
  const res = await dbQuerySafe(`
    INSERT INTO h1_derived_state (
      symbol, observed_at, snapshot_id, mode, direction, regime, maturity,
      evidence_quality, evidence_completeness_pct, conflict_count, candidate_age_minutes,
      no_chase, overextended, multi_horizon_alignment, regime_survival_count,
      premium_pair, evidence_families, fii_dii_context, reason_codes, rule_version
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
      $16::jsonb,$17::jsonb,$18,$19::jsonb,$20
    ) ON CONFLICT (symbol, observed_at, mode, rule_version) DO UPDATE SET
      snapshot_id=EXCLUDED.snapshot_id,
      direction=EXCLUDED.direction,
      regime=EXCLUDED.regime,
      maturity=EXCLUDED.maturity,
      evidence_quality=EXCLUDED.evidence_quality,
      evidence_completeness_pct=EXCLUDED.evidence_completeness_pct,
      conflict_count=EXCLUDED.conflict_count,
      candidate_age_minutes=EXCLUDED.candidate_age_minutes,
      no_chase=EXCLUDED.no_chase,
      overextended=EXCLUDED.overextended,
      multi_horizon_alignment=EXCLUDED.multi_horizon_alignment,
      regime_survival_count=EXCLUDED.regime_survival_count,
      premium_pair=EXCLUDED.premium_pair,
      evidence_families=EXCLUDED.evidence_families,
      fii_dii_context=EXCLUDED.fii_dii_context,
      reason_codes=EXCLUDED.reason_codes
  `, [
    row.symbol, row.observedAt, row.snapshotId, row.mode, row.direction, row.regime, row.maturity,
    row.evidenceQuality, row.evidenceCompletenessPct, row.conflictCount, row.candidateAgeMinutes,
    row.noChase, row.overextended, row.multiHorizonAlignment, row.regimeSurvivalCount,
    JSON.stringify(row.premiumPair), JSON.stringify(row.evidenceFamilies), row.fiiDiiContext,
    JSON.stringify(row.reasonCodes), row.ruleVersion,
  ]);
  return res !== null;
}

export async function persistH1CandidateLifecycle(row: CandidateLifecycleRecord): Promise<boolean> {
  const res = await dbQuerySafe(`
    INSERT INTO h1_candidate_lifecycle (
      candidate_id, symbol, mode, observed_at, status, direction, expiry, strike, side,
      entry_low, entry_high, sl, t1, t2, t3, current_premium, opposite_premium,
      reason_codes, evidence_quality, rule_version
    ) VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20
    ) ON CONFLICT (candidate_id, observed_at, status) DO NOTHING
  `, [
    row.candidateId, row.symbol, row.mode, row.observedAt, row.status, row.direction,
    row.expiry, row.strike, row.side, row.entryLow, row.entryHigh, row.sl, row.t1, row.t2, row.t3,
    row.currentPremium, row.oppositePremium, JSON.stringify(row.reasonCodes), row.evidenceQuality, row.ruleVersion,
  ]);
  return res !== null;
}

export async function persistH1OutcomeAttribution(row: OutcomeAttribution): Promise<boolean> {
  const res = await dbQuerySafe(`
    INSERT INTO h1_outcome_attribution (
      candidate_id, closed_at, outcome, mfe_pct, mae_pct, time_to_t1_minutes,
      time_to_stop_minutes, regime_survival_count, exit_reason_code, direction_correct,
      timing_correct, premium_selection_correct, user_discipline_issue, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb)
    ON CONFLICT (candidate_id) DO UPDATE SET
      closed_at=EXCLUDED.closed_at,
      outcome=EXCLUDED.outcome,
      mfe_pct=EXCLUDED.mfe_pct,
      mae_pct=EXCLUDED.mae_pct,
      time_to_t1_minutes=EXCLUDED.time_to_t1_minutes,
      time_to_stop_minutes=EXCLUDED.time_to_stop_minutes,
      regime_survival_count=EXCLUDED.regime_survival_count,
      exit_reason_code=EXCLUDED.exit_reason_code,
      direction_correct=EXCLUDED.direction_correct,
      timing_correct=EXCLUDED.timing_correct,
      premium_selection_correct=EXCLUDED.premium_selection_correct,
      user_discipline_issue=EXCLUDED.user_discipline_issue,
      notes=EXCLUDED.notes
  `, [
    row.candidateId, row.closedAt, row.outcome, row.mfePct, row.maePct, row.timeToT1Minutes,
    row.timeToStopMinutes, row.regimeSurvivalCount, row.exitReasonCode, row.directionCorrect,
    row.timingCorrect, row.premiumSelectionCorrect, row.userDisciplineIssue, JSON.stringify(row.notes),
  ]);
  return res !== null;
}
