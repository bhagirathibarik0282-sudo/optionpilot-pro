# KITE_FULL_DEPTH_DECODER_V1

Purpose: expose exact top-of-book and 5x5 market depth from Zerodha Kite 184-byte FULL websocket packets.

Safety semantics:
- Depth exists only for 184-byte tradable FULL packets.
- 44-byte quote and index packets do not fabricate depth.
- Five buy levels and five sell levels are preserved in wire order.
- Each level exposes quantity, price and order count.
- This decoder adds evidence only; it grants no execution, selector, verdict, Telegram or AI authority.
