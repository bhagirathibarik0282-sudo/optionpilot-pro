import assert from "node:assert/strict";
import test from "node:test";
import { runH1CanonicalLiveBusinessRuntime } from "../h1-canonical-live-business-runtime-coordinator.js";
import { deriveH1ExactLiveSpotDirection } from "../h1-exact-live-spot-direction-provider.js";
import { buildCanonicalOneRoofMarketSnapshot, type CanonicalMarketFamily } from "../canonical-one-roof-market-snapshot.js";
import { selectExecutionCandidate } from "../execution-candidate-selector.js";
import type { LiveGateEvidencePacket, LiveGateName } from "../h1-live-gate-evidence-assembler.js";

const now = Date.now();
const observedAt = new Date(now - 30_000).toISOString();
const hash = "runtime-manifest";
const families: CanonicalMarketFamily[] = ["MARKET_STRUCTURE","FUTURES_CONFIRMATION","OPTION_PREMIUMS","OI_POSITIONING","MULTI_DTE","VOLATILITY","HEAVYWEIGHTS","SECTOR_BREADTH","RESPONSE_LADDER","LIQUIDITY_EXECUTABILITY"];

function packet(): LiveGateEvidencePacket {
  const names: LiveGateName[] = ["capitalFit","liquidityOk","spreadOk","premiumResponseConfirmed","deltaGammaResponseConfirmed","thetaIvBurdenAcceptable","multiExpiryConflictAbsent","currentOrNearExpiryUsable"];
  return {
    identity:{symbol:"NIFTY",side:"CE",strike:23400,expiryDate:"2026-09-15",dte:0,moneyness:"ATM",premiumLtp:150,observedAt,source:"exact-packet",provenance:"LIVE_RUNTIME_EXACT"},
    gates:Object.fromEntries(names.map(name=>[name,{value:true,observedAt,source:`exact-${name}`,provenance:"LIVE_RUNTIME_EXACT"}])) as LiveGateEvidencePacket["gates"],
  };
}

function direction() {
  return deriveH1ExactLiveSpotDirection(
    {source:"LIVE_RUNTIME_EXACT",symbol:"NIFTY",price:23300,observedAt:new Date(now-90_000).toISOString(),receivedAt:new Date(now-89_000).toISOString()},
    {source:"LIVE_RUNTIME_EXACT",symbol:"NIFTY",price:23350,observedAt,receivedAt:new Date(now-29_000).toISOString()},
    {maxObservationGapMs:120_000,minAbsoluteSpotMovePct:0.1},
  );
}

function missionInput() {
  const snapshot=buildCanonicalOneRoofMarketSnapshot({
    snapshotId:"runtime-snapshot",symbol:"NIFTY",asOfMs:now-1_000,minuteClosed:true,connectionId:"kite-live",instrumentMasterVersion:"master",
    components:families.map((family,index)=>({family,status:"VERIFIED" as const,exchangeTimestampMs:now-1_000,receivedAtMs:now-900,processedAtMs:now-800,ingestSeq:index+1,provenance:"KITE_WS" as const,source:`exact-${family}`,payload:{},devilFlags:[]})),
    freshnessBudgetsMs:Object.fromEntries(families.map(f=>[f,60_000])),
    ingestTelemetry:{queueDepth:0,queueLagMs:0,droppedPacketCount:0,backpressureActive:false},
  });
  const candidate={symbol:"NIFTY" as const,side:"CE" as const,strike:23400,expiryDate:"2026-09-15",dte:0,moneyness:"ATM" as const,premiumLtp:150,capitalFit:true,liquidityOk:true,spreadOk:true,premiumResponseConfirmed:true,deltaGammaResponseConfirmed:true,thetaIvBurdenAcceptable:true,multiExpiryConflictAbsent:true,currentOrNearExpiryUsable:true,higherDteUsable:false};
  return {
    provenance:"LIVE_CANONICAL_MISSION_ORCHESTRATOR_V1" as const,decisionId:"runtime-decision",nowMs:now,telegramHorizon:"INTRADAY" as const,
    source:{version:"CANONICAL_LIVE_SHADOW_SNAPSHOT_SOURCE_V1" as const,ready:true,sourceManifestHash:hash,snapshot,snapshotReadyForStrictFiltering:true,constituentTickCount:50,blockers:[],readOnly:true as const,shadowOnly:true as const,readsLiveConstituentTicks:true as const,forwardsDownstream:false as const,affectsDirection:false as const,affectsVerdict:false as const,affectsExecution:false as const,affectsTelegram:false as const,grantsCandidateAuthority:false as const,wiredIntoServer:false as const,failClosed:true as const},
    evaluations:[{candidate,selector:selectExecutionCandidate(candidate)}],
  };
}

function input() {
  const common={provenance:"LIVE_RUNTIME_EXACT" as const,symbol:"NIFTY" as const,observedAtMs:now-5_000,devilFlags:[] as string[]};
  return {
    packet:packet(),
    coreFamilySignals:(["OPTION_PREMIUMS","MULTI_DTE","LIQUIDITY_EXECUTABILITY"] as const).map((family,index)=>({family,stance:"BUYER_SUPPORT" as const,strength:80-index*5,deterministic:true as const,evidenceReady:true as const,sourceId:`core-${family}`,sourceManifestHash:hash,sourceSemantics:"EXPLICIT_DIRECTIONAL_SUPPORT" as const,grantsDirectionalSupport:true as const,devilFlags:[]})),
    directionSource:direction(),
    sevenFamilyFacts:{
      marketStructure:{...common,sourceId:"structure",spotMovePct:0.22,spotPivotAccepted:true,structureHoldSamples:2},
      futuresConfirmation:{...common,sourceId:"futures",futuresMovePct:0.2,futuresVwapAccepted:true,acceptanceSamples:2},
      oiPositioning:{...common,sourceId:"oi",band7PcrDelta:0.04,volumePcrDelta:0.03,wallAsymmetryPct:4},
      volatility:{...common,sourceId:"vol",candidatePremiumMovePct:4,vixChangePct:0.3,atmIvChangePct:0.4},
      heavyweights:{...common,sourceId:"H1_EXACT_WEIGHTED_HEAVYWEIGHT_LIVE_ADAPTER_V1" as const,bullishWeightPct:70,bearishWeightPct:20,neutralWeightPct:10,liveWeightCoveragePct:100,liveConstituentCount:4,authorityConstituentCount:4,lookbackMinutes:3,referenceProviderId:"OFFICIAL_NIFTY_PROVIDER",referenceDocumentId:"official-index-weight-file",referenceVersion:"2026-09-14",referenceManifestHash:"sha256:official-reference-manifest",officialWeightAuthorityVerified:true as const,normalizedMissingWeightAway:false as const},
      sectorBreadth:{...common,sourceId:"sector",bullishCount:7,bearishCount:2,totalCount:10},
      responseLadder:{...common,sourceId:"ladder",direction:"UP" as const,confirmedStages:3,totalStages:4 as const},
    },
    sevenFamilyPolicy:{minSpotMovePct:0.1,requiredStructureHoldSamples:2,minFuturesMovePct:0.1,requiredFuturesAcceptanceSamples:2,minBand7PcrDelta:0.02,minVolumePcrDelta:0.02,minWallAsymmetryPct:2,minCandidatePremiumMovePct:2,minVolExpansionPct:0.2,minHeavyweightDirectionalMarginPct:20,minSectorDirectionalSharePct:60,requiredResponseStages:3,maxAgeMs:90_000},
    sourceManifestHash:hash,missionInput:missionInput(),maxAgeMs:90_000,
  };
}

test("coordinates exact facts through 3 plus 7 into Telegram transport readiness",()=>{
  const out=runH1CanonicalLiveBusinessRuntime(input());
  assert.equal(out.ready,true);
  assert.equal(out.stage,"READY_FOR_TELEGRAM_TRANSPORT");
  assert.equal(out.core?.envelopes.length,3);
  assert.equal(out.producer?.evidence.length,7);
  assert.equal(out.missionChain?.familyCount,10);
  assert.equal(out.sendsTelegram,false);
  assert.equal(out.createsOrders,false);
});

test("one live family failure stops before canonical mission",()=>{
  const value=input();
  value.sevenFamilyFacts.sectorBreadth.bullishCount=4;
  const out=runH1CanonicalLiveBusinessRuntime(value);
  assert.equal(out.ready,false);
  assert.equal(out.stage,"PRODUCER_7");
  assert.equal(out.missionChain,null);
});

test("identity mismatch and stale core evidence fail closed",()=>{
  const mismatch=input();
  mismatch.missionInput.source.snapshot!.symbol="SENSEX";
  assert.equal(runH1CanonicalLiveBusinessRuntime(mismatch).stage,"INPUT");
  const stale=input();
  stale.missionInput.nowMs=now+120_000;
  assert.equal(runH1CanonicalLiveBusinessRuntime(stale).stage,"CORE_3");
});
