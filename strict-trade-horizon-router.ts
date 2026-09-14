export type StrictTradeHorizon = "EXPIRY_SCALP_0_1" | "NORMAL_SCALP_2_6" | "SWING_7_13" | "UNSUPPORTED";
export type StrictTradeStyle = "SCALP" | "SWING";

export interface StrictTradeHorizonRoute {
  horizon: StrictTradeHorizon;
  expectedStyle: StrictTradeStyle | null;
  supported: boolean;
  reason: string;
}

export function routeStrictTradeHorizon(dte: number): StrictTradeHorizonRoute {
  if (!Number.isInteger(dte) || dte < 0) return { horizon: "UNSUPPORTED", expectedStyle: null, supported: false, reason: "INVALID_DTE" };
  if (dte <= 1) return { horizon: "EXPIRY_SCALP_0_1", expectedStyle: "SCALP", supported: true, reason: "DTE_0_1_EXPIRY_SCALP" };
  if (dte <= 6) return { horizon: "NORMAL_SCALP_2_6", expectedStyle: "SCALP", supported: true, reason: "DTE_2_6_NORMAL_SCALP" };
  if (dte <= 13) return { horizon: "SWING_7_13", expectedStyle: "SWING", supported: true, reason: "DTE_7_13_SWING" };
  return { horizon: "UNSUPPORTED", expectedStyle: null, supported: false, reason: "DTE_OUTSIDE_STRICT_0_13_RANGE" };
}
