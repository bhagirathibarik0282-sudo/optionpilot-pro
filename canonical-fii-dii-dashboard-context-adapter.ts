import type { CanonicalFiiDiiPracticalContextV2, PracticalWindowContext } from "./canonical-fii-dii-practical-ingest-v2.ts";

export const CANONICAL_FII_DII_DASHBOARD_CONTEXT_ADAPTER_V1 = "CANONICAL_FII_DII_DASHBOARD_CONTEXT_ADAPTER_V1" as const;

export interface FiiDiiDashboardWindowView {
  window: "1D" | "3D" | "5D" | "20D";
  ready: boolean;
  availableSessions: number;
  requiredSessions: number;
  fiiNetCrore: number | null;
  diiNetCrore: number | null;
  combinedNetCrore: number | null;
  state: "READY" | "ACCUMULATING_HISTORY";
}

export interface CanonicalFiiDiiDashboardContextView {
  version: typeof CANONICAL_FII_DII_DASHBOARD_CONTEXT_ADAPTER_V1;
  ready: boolean;
  latestSessionDate: string | null;
  windows: FiiDiiDashboardWindowView[];
  blockers: string[];
  warnings: string[];
  source: "OFFICIAL_NSE";
  label: "FII/DII Institutional Context";
  semantics: "PREVIOUS_SESSION_CONTEXT_ONLY_NO_DIRECTION_TRUTH";
  readOnly: true;
  presentationOnly: true;
  grantsDirectionalSupport: false;
  affectsVerdict: false;
  affectsCandidate: false;
  affectsExecution: false;
  affectsTelegram: false;
  failClosed: true;
}

function fail(blockers: string[]): CanonicalFiiDiiDashboardContextView {
  return {
    version: CANONICAL_FII_DII_DASHBOARD_CONTEXT_ADAPTER_V1,
    ready: false,
    latestSessionDate: null,
    windows: [],
    blockers: [...new Set(blockers)],
    warnings: [],
    source: "OFFICIAL_NSE",
    label: "FII/DII Institutional Context",
    semantics: "PREVIOUS_SESSION_CONTEXT_ONLY_NO_DIRECTION_TRUTH",
    readOnly: true,
    presentationOnly: true,
    grantsDirectionalSupport: false,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}

function validWindow(window: PracticalWindowContext): boolean {
  if (!["1D", "3D", "5D", "20D"].includes(window.window)) return false;
  if (!Number.isInteger(window.requiredSessions) || window.requiredSessions < 1) return false;
  if (!Number.isInteger(window.availableSessions) || window.availableSessions < 0) return false;
  if (window.ready) {
    return [window.fiiNetCrore, window.diiNetCrore, window.combinedNetCrore].every((v) => typeof v === "number" && Number.isFinite(v));
  }
  return window.fiiNetCrore === null && window.diiNetCrore === null && window.combinedNetCrore === null;
}

export function buildFiiDiiDashboardContextView(source: CanonicalFiiDiiPracticalContextV2): CanonicalFiiDiiDashboardContextView {
  if (!source || source.version !== "CANONICAL_FII_DII_PRACTICAL_INGEST_V2") return fail(["FII_DII_DASHBOARD_SOURCE_VERSION_INVALID"]);
  if (!source.readOnly || !source.previousSessionContextOnly || source.estimatesMissingValues || source.grantsDirectionalSupport || source.affectsVerdict || source.affectsCandidate || source.affectsExecution || source.affectsTelegram || !source.failClosed) {
    return fail(["FII_DII_DASHBOARD_AUTHORITY_BOUNDARY_INVALID"]);
  }
  if (!source.ready || !source.latestSessionDate || source.blockers.length) return fail(["FII_DII_DASHBOARD_SOURCE_NOT_READY", ...source.blockers]);
  if (source.windows.length !== 4 || source.windows.some((window) => !validWindow(window))) return fail(["FII_DII_DASHBOARD_WINDOWS_INVALID"]);

  return {
    version: CANONICAL_FII_DII_DASHBOARD_CONTEXT_ADAPTER_V1,
    ready: true,
    latestSessionDate: source.latestSessionDate,
    windows: source.windows.map((window) => ({
      window: window.window,
      ready: window.ready,
      availableSessions: window.availableSessions,
      requiredSessions: window.requiredSessions,
      fiiNetCrore: window.fiiNetCrore,
      diiNetCrore: window.diiNetCrore,
      combinedNetCrore: window.combinedNetCrore,
      state: window.ready ? "READY" : "ACCUMULATING_HISTORY",
    })),
    blockers: [],
    warnings: [...source.warnings],
    source: "OFFICIAL_NSE",
    label: "FII/DII Institutional Context",
    semantics: "PREVIOUS_SESSION_CONTEXT_ONLY_NO_DIRECTION_TRUTH",
    readOnly: true,
    presentationOnly: true,
    grantsDirectionalSupport: false,
    affectsVerdict: false,
    affectsCandidate: false,
    affectsExecution: false,
    affectsTelegram: false,
    failClosed: true,
  };
}
