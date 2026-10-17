// Explicitly imported only by the local Chromium smoke server. A rehearsal must
// not contact Neon, OAuth or retailers, even if a UI prefetch runs unexpectedly.
globalThis.fetch = () =>
  Promise.reject(new Error("Outbound fetch disabled in local hosting smoke"));
