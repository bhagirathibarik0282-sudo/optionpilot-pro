import { resolveKiteAuthoritySession } from "./kite-session-authority.js";
import { fetchH1KiteLiveInstrumentMaster } from "./h1-kite-live-instrument-master-adapter.js";
import { buildH1ExactLiveConfigPreflight, type H1ExactLiveConfigPreflightRequest } from "./h1-exact-live-config-preflight.js";

export interface H1ExactLiveConfigPreflightRunnerResult {
  version: "H1_EXACT_LIVE_CONFIG_PREFLIGHT_RUNNER_V1";
  ready: boolean;
  authorityActive: boolean;
  masterReady: boolean;
  preflightReady: boolean;
  contractCount: number;
  registryTokenCount: number;
  blockers: string[];
  credentialsExposed: false;
  emitsRegistryJson: false;
  emitsPolicyJson: false;
  writesRailwayVariables: false;
  activatesShadow: false;
  telegramSendAllowed: false;
  affectsVerdict: false;
  affectsExecution: false;
  productionImpact: "NONE";
  failClosed: true;
}

function fail(blockers: string[], authorityActive = false, masterReady = false): H1ExactLiveConfigPreflightRunnerResult {
  return {
    version: "H1_EXACT_LIVE_CONFIG_PREFLIGHT_RUNNER_V1",
    ready: false,
    authorityActive,
    masterReady,
    preflightReady: false,
    contractCount: 0,
    registryTokenCount: 0,
    blockers: [...new Set(blockers)],
    credentialsExposed: false,
    emitsRegistryJson: false,
    emitsPolicyJson: false,
    writesRailwayVariables: false,
    activatesShadow: false,
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    productionImpact: "NONE",
    failClosed: true,
  };
}

export async function runH1ExactLiveConfigPreflight(
  request: H1ExactLiveConfigPreflightRequest,
  deps: {
    resolveAuthority?: typeof resolveKiteAuthoritySession;
    fetchMaster?: typeof fetchH1KiteLiveInstrumentMaster;
    apiKey?: string | null;
  } = {},
): Promise<H1ExactLiveConfigPreflightRunnerResult> {
  const apiKey = (deps.apiKey ?? process.env.KITE_API_KEY ?? "").trim();
  if (!apiKey) return fail(["KITE_API_KEY_MISSING"]);

  const authority = await (deps.resolveAuthority ?? resolveKiteAuthoritySession)();
  if (!authority.session) return fail([`KITE_AUTHORITY_${authority.status.code}`]);

  const master = await (deps.fetchMaster ?? fetchH1KiteLiveInstrumentMaster)({
    apiKey,
    accessToken: authority.session.accessToken,
  });
  if (!master.ready) return fail(master.blockers, true, false);

  const preflight = buildH1ExactLiveConfigPreflight(master.rows, request);
  if (!preflight.ready) return fail(preflight.blockers, true, true);

  return {
    version: "H1_EXACT_LIVE_CONFIG_PREFLIGHT_RUNNER_V1",
    ready: true,
    authorityActive: true,
    masterReady: true,
    preflightReady: true,
    contractCount: preflight.contractCount,
    registryTokenCount: preflight.registryTokenCount,
    blockers: [],
    credentialsExposed: false,
    emitsRegistryJson: false,
    emitsPolicyJson: false,
    writesRailwayVariables: false,
    activatesShadow: false,
    telegramSendAllowed: false,
    affectsVerdict: false,
    affectsExecution: false,
    productionImpact: "NONE",
    failClosed: true,
  };
}

function parseRequest(raw: string | undefined): H1ExactLiveConfigPreflightRequest | null {
  try {
    if (!raw?.trim()) return null;
    return JSON.parse(raw) as H1ExactLiveConfigPreflightRequest;
  } catch {
    return null;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const request = parseRequest(process.env.KITE_H1_EXACT_PREFLIGHT_REQUEST_JSON);
  if (!request) {
    console.log(JSON.stringify(fail(["KITE_H1_EXACT_PREFLIGHT_REQUEST_JSON_REQUIRED_OR_INVALID"])));
    process.exitCode = 2;
  } else {
    runH1ExactLiveConfigPreflight(request).then((out) => {
      console.log(JSON.stringify(out));
      if (!out.ready) process.exitCode = 2;
    }).catch(() => {
      console.log(JSON.stringify(fail(["PREFLIGHT_RUNNER_UNHANDLED_FAILURE"])));
      process.exitCode = 2;
    });
  }
}
