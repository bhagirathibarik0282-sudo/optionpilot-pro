import { dbIsConfigured, dbQuerySafe } from "./db.js";
import { KITE_SESSION_AUTHORITY_ID } from "./kite-session-authority.js";

export interface KiteAuthorityRevokeResult {
  ok: boolean;
  code: "REVOKED" | "STORAGE_UNAVAILABLE";
  tokenExposed: false;
  sessionIdExposed: false;
  productionDecisionImpact: "NONE";
}

export async function revokeKiteAuthoritySession(): Promise<KiteAuthorityRevokeResult> {
  if (!dbIsConfigured()) {
    return {
      ok: false,
      code: "STORAGE_UNAVAILABLE",
      tokenExposed: false,
      sessionIdExposed: false,
      productionDecisionImpact: "NONE",
    };
  }

  const result = await dbQuerySafe(
    "DELETE FROM kite_session_authority WHERE authority_id = $1",
    [KITE_SESSION_AUTHORITY_ID],
  );

  if (result === null) {
    return {
      ok: false,
      code: "STORAGE_UNAVAILABLE",
      tokenExposed: false,
      sessionIdExposed: false,
      productionDecisionImpact: "NONE",
    };
  }

  return {
    ok: true,
    code: "REVOKED",
    tokenExposed: false,
    sessionIdExposed: false,
    productionDecisionImpact: "NONE",
  };
}
