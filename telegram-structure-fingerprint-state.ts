export type TelegramStructureFingerprintKind = "STRUCTURE_BLOCK" | "RISK_BLOCK" | "CANDIDATE";

export class TelegramStructureFingerprintState {
  private readonly state = new Map<string, string>();

  private key(symbol: string, kind: TelegramStructureFingerprintKind): string {
    return `${symbol.trim().toUpperCase()}|${kind}`;
  }

  shouldEmit(symbol: string, kind: TelegramStructureFingerprintKind, fingerprint: string): boolean {
    const key = this.key(symbol, kind);
    return this.state.get(key) !== fingerprint;
  }

  markEmitted(symbol: string, kind: TelegramStructureFingerprintKind, fingerprint: string): void {
    this.state.set(this.key(symbol, kind), fingerprint);
  }

  clear(): void {
    this.state.clear();
  }
}
