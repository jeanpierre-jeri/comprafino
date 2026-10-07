/** Retained catalog capacity shared by admission and complete-catalog readers. */
const retainedListingCap = 2000;

export const catalogPolicy = {
  retainedListingCap,
  overflowSentinel: retainedListingCap + 1,
} as const;
