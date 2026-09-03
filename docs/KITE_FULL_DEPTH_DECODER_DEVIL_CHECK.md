# KITE FULL DEPTH DECODER DEVIL CHECK

PASS criteria:
- 184-byte tradable full packet decodes exactly 5 buy + 5 sell levels.
- Level fields are quantity, price, orders.
- Price uses the existing token divisor logic.
- 44-byte quote packets expose no marketDepth.
- Index packets expose no marketDepth.
- Existing LTP/OI/timestamp behavior remains unchanged.
- No execution authority is introduced.
