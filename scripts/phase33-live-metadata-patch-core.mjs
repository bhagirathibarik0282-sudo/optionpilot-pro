const MARKER = "PHASE33_FUTURES_LIVE_METADATA";

function count(source, needle) {
  return source.split(needle).length - 1;
}

export function applyPhase33LiveMetadataPatch(input) {
  let source = String(input ?? "");
  if (source.includes(MARKER)) return { source, changed: false, reason: "ALREADY_PATCHED" };

  const interfaceAnchor = `interface FuturesContract {\n  label: "Near" | "Next" | "Far";\n  tradingsymbol: string;\n  expiry: string;`;
  const quoteAnchor = `const futQuotes = await fetchKiteQuote(accessToken, futSymbols);`;
  const mapAnchor = `tradingsymbol: f.tradingsymbol,\n          expiry: f.expiry,`;

  const interfaceCount = count(source, interfaceAnchor);
  const quoteCount = count(source, quoteAnchor);
  const mapCount = count(source, mapAnchor);

  if (interfaceCount !== 1 || quoteCount < 1 || quoteCount !== mapCount) {
    return {
      source,
      changed: false,
      reason: `AMBIGUOUS_ANCHORS interface=${interfaceCount} quote=${quoteCount} map=${mapCount}`,
    };
  }

  source = source.replace(
    interfaceAnchor,
    `${interfaceAnchor}\n  // ${MARKER}: copied from exact Kite futures instrument-master row.\n  instrumentToken: number | null;\n  exchangeToken: number | null;\n  exchange: string | null;\n  segment: string | null;\n  receivedAt: string | null;`,
  );

  source = source.replaceAll(
    quoteAnchor,
    `${quoteAnchor}\n      // ${MARKER}: backend time immediately after the futures quote batch returned.\n      // This is received_at, NOT an exchange/source timestamp.\n      const futQuotesReceivedAt = new Date().toISOString();`,
  );

  source = source.replaceAll(
    mapAnchor,
    `${mapAnchor}\n          instrumentToken: Number.isFinite(f.instrument_token) ? f.instrument_token : null,\n          exchangeToken: Number.isFinite(f.exchange_token) ? f.exchange_token : null,\n          exchange: f.exchange || null,\n          segment: f.segment || null,\n          receivedAt: futQuotesReceivedAt,`,
  );

  return { source, changed: true, reason: "PATCHED" };
}
