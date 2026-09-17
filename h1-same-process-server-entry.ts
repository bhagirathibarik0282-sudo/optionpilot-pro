import { startH1ExactShadowLiveService } from "./h1-exact-shadow-live-service.js";

/**
 * Production entrypoint that hosts the H1 exact packet registry and HTTP
 * server in one JavaScript process. Exact/Gold shadow flags remain default-OFF;
 * startup failures are contained and never prevent the HTTP server import.
 */
try {
  await startH1ExactShadowLiveService();
} catch (error) {
  console.error(
    "[H1_EXACT_SHADOW_HOST] startup contained:",
    error instanceof Error ? error.message : "UNKNOWN_ERROR",
  );
}

await import("./server.js");
