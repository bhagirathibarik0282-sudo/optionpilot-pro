export type ContractHistorySide = "CE" | "PE";

interface OptionContractLike {
  instrumentToken?: unknown;
  tradingSymbol?: unknown;
  expiryDate?: unknown;
  strike?: unknown;
  optionType?: unknown;
  lastPrice?: unknown;
  oi?: unknown;
  iv?: unknown;
}

interface FutureContractLike {
  tradingsymbol?: unknown;
  expiry?: unknown;
  ltp?: unknown;
}

interface ExpiryLike {
  ceStrikes?: unknown;
  peStrikes?: unknown;
}

interface SnapshotLike {
  expiries?: unknown;
  futuresContracts?: unknown;
}

export interface ContractPairIdentity {
  ready: boolean;
  label: string | null;
  expiryDate: string | null;
  strike: number | null;
  blockers: string[];
}

export interface ContractBoundHistoryPoint {
  pair: ContractPairIdentity;
  futureChange: number | null;
  cePremiumChangePct: number | null;
  pePremiumChangePct: number | null;
  ceOiChangePct: number | null;
  peOiChangePct: number | null;
  ceIvChange: number | null;
  peIvChange: number | null;
  blockers: string[];
  failClosed: true;
}

function positiveNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function text(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized ? normalized : null;
}

function dateOnly(value: unknown): string | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = text(value);
  if (!raw) return null;
  const direct = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
  if (direct) return direct;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : null;
}

function optionIdentity(option: OptionContractLike | null | undefined, side: ContractHistorySide): string | null {
  const token = positiveNumber(option?.instrumentToken);
  const tradingSymbol = text(option?.tradingSymbol);
  const expiryDate = dateOnly(option?.expiryDate);
  const strike = positiveNumber(option?.strike);
  if (token == null || !tradingSymbol || !expiryDate || strike == null || option?.optionType !== side) return null;
  return [token, tradingSymbol, expiryDate, strike, side].join("|");
}

function futureIdentity(future: FutureContractLike | null | undefined): string | null {
  const tradingSymbol = text(future?.tradingsymbol);
  const expiryDate = dateOnly(future?.expiry);
  return tradingSymbol && expiryDate ? `${tradingSymbol}|${expiryDate}` : null;
}

function optionRows(snapshot: SnapshotLike | null | undefined, side: ContractHistorySide): OptionContractLike[] {
  const expiries = Array.isArray(snapshot?.expiries) ? snapshot.expiries as ExpiryLike[] : [];
  return expiries.flatMap((expiry) => {
    const rows = side === "CE" ? expiry?.ceStrikes : expiry?.peStrikes;
    return Array.isArray(rows) ? rows as OptionContractLike[] : [];
  });
}

function exactPreviousOption(
  snapshot: SnapshotLike | null | undefined,
  current: OptionContractLike | null | undefined,
  side: ContractHistorySide,
): OptionContractLike | null {
  const identity = optionIdentity(current, side);
  if (!identity) return null;
  const matches = optionRows(snapshot, side).filter((row) => optionIdentity(row, side) === identity);
  return matches.length === 1 ? matches[0] : null;
}

function exactPreviousFuture(
  snapshot: SnapshotLike | null | undefined,
  current: FutureContractLike | null | undefined,
): FutureContractLike | null {
  const identity = futureIdentity(current);
  if (!identity) return null;
  const rows = Array.isArray(snapshot?.futuresContracts) ? snapshot.futuresContracts as FutureContractLike[] : [];
  const matches = rows.filter((row) => futureIdentity(row) === identity);
  return matches.length === 1 ? matches[0] : null;
}

function pctChange(current: unknown, previous: unknown): number | null {
  const currentNumber = positiveNumber(current);
  const previousNumber = positiveNumber(previous);
  return currentNumber != null && previousNumber != null
    ? ((currentNumber - previousNumber) / previousNumber) * 100
    : null;
}

function difference(current: unknown, previous: unknown): number | null {
  const currentNumber = positiveNumber(current);
  const previousNumber = positiveNumber(previous);
  return currentNumber != null && previousNumber != null ? currentNumber - previousNumber : null;
}

export function buildContractPairIdentity(
  symbol: string,
  ce: OptionContractLike | null | undefined,
  pe: OptionContractLike | null | undefined,
): ContractPairIdentity {
  const blockers: string[] = [];
  const ceIdentity = optionIdentity(ce, "CE");
  const peIdentity = optionIdentity(pe, "PE");
  if (!ceIdentity) blockers.push("CURRENT_CE_IDENTITY_INCOMPLETE");
  if (!peIdentity) blockers.push("CURRENT_PE_IDENTITY_INCOMPLETE");

  const ceExpiry = dateOnly(ce?.expiryDate);
  const peExpiry = dateOnly(pe?.expiryDate);
  const ceStrike = positiveNumber(ce?.strike);
  const peStrike = positiveNumber(pe?.strike);
  if (ceIdentity && peIdentity && (ceExpiry !== peExpiry || ceStrike !== peStrike)) blockers.push("CURRENT_CE_PE_PAIR_MISMATCH");

  const ready = blockers.length === 0;
  return {
    ready,
    label: ready ? `${symbol} ${ceExpiry} ${ceStrike} CE/PE` : null,
    expiryDate: ready ? ceExpiry : null,
    strike: ready ? ceStrike : null,
    blockers: [...new Set(blockers)],
  };
}

export function buildContractBoundHistoryPoint(input: {
  symbol: string;
  previousSnapshot: SnapshotLike | null | undefined;
  currentCe: OptionContractLike | null | undefined;
  currentPe: OptionContractLike | null | undefined;
  currentFuture: FutureContractLike | null | undefined;
}): ContractBoundHistoryPoint {
  const pair = buildContractPairIdentity(input.symbol, input.currentCe, input.currentPe);
  const blockers = [...pair.blockers];
  const previousCe = pair.ready ? exactPreviousOption(input.previousSnapshot, input.currentCe, "CE") : null;
  const previousPe = pair.ready ? exactPreviousOption(input.previousSnapshot, input.currentPe, "PE") : null;
  const previousFuture = exactPreviousFuture(input.previousSnapshot, input.currentFuture);

  if (pair.ready && !previousCe) blockers.push("PREVIOUS_CE_EXACT_CONTRACT_UNAVAILABLE");
  if (pair.ready && !previousPe) blockers.push("PREVIOUS_PE_EXACT_CONTRACT_UNAVAILABLE");
  if (!previousFuture) blockers.push("PREVIOUS_FUTURE_EXACT_CONTRACT_UNAVAILABLE");

  return {
    pair,
    futureChange: previousFuture ? difference(input.currentFuture?.ltp, previousFuture.ltp) : null,
    cePremiumChangePct: previousCe ? pctChange(input.currentCe?.lastPrice, previousCe.lastPrice) : null,
    pePremiumChangePct: previousPe ? pctChange(input.currentPe?.lastPrice, previousPe.lastPrice) : null,
    ceOiChangePct: previousCe ? pctChange(input.currentCe?.oi, previousCe.oi) : null,
    peOiChangePct: previousPe ? pctChange(input.currentPe?.oi, previousPe.oi) : null,
    ceIvChange: previousCe ? difference(input.currentCe?.iv, previousCe.iv) : null,
    peIvChange: previousPe ? difference(input.currentPe?.iv, previousPe.iv) : null,
    blockers: [...new Set(blockers)],
    failClosed: true,
  };
}
