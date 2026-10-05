/** Retained catalog capacity shared by admission and complete-catalog readers. */
const retainedListingCap = 1000;
export const catalogPolicy = {
  retainedListingCap,
  overflowSentinel: retainedListingCap + 1,
} as const;
