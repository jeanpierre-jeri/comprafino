/** Retained catalog capacity shared by admission and complete-catalog readers. */
const retainedListingCap = 50_000;

export const catalogPolicy = {
  retainedListingCap,
  overflowSentinel: retainedListingCap + 1,
  batchSize: 500,
  acquisitionPagesPerRetailer: 100,
} as const;
