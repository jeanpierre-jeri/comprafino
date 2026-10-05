# Availability evidence — Milestone 18

Unknown stock remains distinct from unavailable. `pnpm audit:availability` and `pnpm audit:catalog-coverage` inspect the complete bounded catalog without retailer calls or writes. [Measured audit](catalog-coverage-audit.json) includes prospective timestamps, legacy booleans, price freshness, last request failures and exact absence separately.

## Real source semantics

| Source                 | Positive evidence                                                                                                            | Explicit unavailable                                          | Missing/uncertain evidence                                                                                                                |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Tottus category/search | Usable quote; stock remains unknown                                                                                          | No new negative inference                                     | Omission from bounded sample says nothing about stock                                                                                     |
| Tottus exact page      | Exact parent/variant, published, purchaseable, online sellable, unique active TOTTUS_PERU offering; validated ordinary quote | Explicit false published/purchaseable/online/active flag      | Missing seller, hydration/schema/identity/quote failures are failures; 404/410 or missing variant is exact absence, not proof of deletion |
| Plaza Vea exact SKU    | Exact parent/SKU, unique seller 1, IsAvailable true, AvailableQuantity >0 and validated ordinary quote                       | Seller 1 explicitly IsAvailable false or AvailableQuantity =0 | Missing/ambiguous/malformed seller evidence or invalid quote is failure; empty/404/missing SKU is exact absence                           |
| Metro exact SKU        | Same VTEX identity/seller gates, isolated Metro parser/context                                                               | Same explicit seller-1 stock fields                           | Same distinction; no authentication or protection bypass                                                                                  |

VTEX previously called any parser omission unavailable. The updated lookup checks exact seller stock **before** full quote parsing and throws for missing/ambiguous evidence. Tottus previously treated a missing offering as inactive; it now requires an explicit negative flag for unavailable, otherwise missing seller evidence fails. Exact positive Tottus lookup supplies true; category/search keeps null because it does not expose those purchase flags. Anonymous channel/location stock is not a universal fulfillment promise.

## Small additive persistence model

Existing nullable `available` remains the source-state value. Migration `0007_brainy_captain_britain.sql` adds:

- `availability_verified_at`: prospective timestamp of explicit stock evidence, independent of ordinary-price `last_seen_at`.
- `exact_missing_count`: nonnegative consecutive successful exact-absence results, initialized to zero.
- `last_exact_missing_at`: latest such absence timestamp; null after successful presence recovery.

No availability event table, price-history model change, backfill or inferred legacy timestamps is added. Legacy true/false booleans retain their previous eligibility semantics but are reported separately from timestamped evidence. Migration `0008_large_masque.sql` drops the initially generated non-null-stock/timestamp constraint to keep older writers' unknown quotes compatible. Both are reviewed and applied; the final schema retains the nonnegative missing-count constraint. Neither touches history or observation coverage.

**Rollout:** deploy every category/discovery/targeted writer from this revision together. Additive DB fields alone cannot upgrade older writers' evidence behavior or global capacity lock. Older writers can still replace stock with unknown, so preservation/cap guarantees apply to the updated writer. No workflow/app deployment was performed in this task. The compatibility correction avoids rejecting legacy writes while code is pending approval.

Explicit category/discovery/targeted quote evidence updates stock and its timestamp only when newer than existing stock evidence. Unknown quote stock preserves the previous evidence; it cannot recover an unavailable listing. A quote arriving after an older price but before a newer negative may update real price metadata while retaining the stronger negative and withholding usable coverage. Exact absence/unavailable finalization is guarded by the owned attempt and timestamps, so an older request cannot overwrite a newer quote/stock observation. Failures update attempt metadata only. Replaying the same absent result does not increment the count twice.

## Conservative missing/negative lifecycle

Active supported listings retain normal refresh. One exact absence is suspected missing; two or more are repeated absence. This is an operational audit flag, **not** confirmed permanent disappearance or a false availability boolean. Request failures do not increment it; category omission does not alter it. A newer successfully observed listing resets it, including presence with unknown stock; explicit unavailable presence also resets absence. No hard deletion, automatic deactivation or historical-page removal occurs.

The anonymous sources do not reliably prove permanent deletion, so this milestone deliberately does not implement a confirmed-disappeared state. Repeated absence retains existing price-age eligibility, loses recommendation eligibility as ordinary freshness expires, and remains inspectable. Continued targeted age/cooldown retries can recover it. Available/unavailable evidence also ages in the audit; stale negative stock remains blocking until stronger positive source evidence recovers it. Do not convert stale stock evidence into a fabricated available boolean.

## Refresh, public offers and recovery

Priority: trusted public exact associations, normalized strong safe shopping candidates, discovery acquisitions, other quantity-useful staple candidates, then other known listings. Within each tier, oldest quote observation first, UUID tie-breaker. Global relevance never reads browser shopping lists. Age remains 24 hours, attempt cooldown 12 hours, cap 100 sequential requests and three consecutive failures per retailer cutoff. Ordinary successful category observation prevents immediate targeted duplication.

One conservative exception prevents a permanently blocked recovery: when retained stock is explicitly false, refresh eligibility uses its verification timestamp. A recent unknown-stock category quote cannot forever suppress exact verification. Fresh negative evidence still waits 24 hours and all attempt cooldown/claim guards apply. This verifies stock rather than pretending the recent quote recovered it.

Current normalized search/list/basket candidates exclude explicit false. Null continues the existing freshness/current-price rules. Exact comparison cheapest ranking also excludes false. Listing pages remain accessible with retained ordinary history and existing “No disponible en la última consulta” / last-registered-price copy. Recovery with newer true restores current offer eligibility; it is not inferred from omission, an unknown quote, a local list label or a failed request. No public layout or label redesign is required.

Availability-only outcomes never update `price_history`, close a state, insert a zero price or fabricate an observation. `listing_observation_days` remains **usable ordinary-price coverage**: unavailable exact lookups, missing results and request failures add no daily coverage. Accepted unchanged quotes advance counts only if effective retained stock is not false. This avoids an unknown quote falsely filling a gap during verified unavailability. Recovered usable quotes resume prospective coverage without fabricating the missing period.

## Evidence and limits

Final measured catalog: 664 available source flags, zero unavailable, 288 unknown; 443 timestamped positives and 221 legacy positive flags. No live missing/negative result was manufactured. One Tottus chorizo exact response failed source schema validation with HTTP 200; it stays unknown and stale, with prior data intact. Final complete metrics are a dated snapshot; schedules/discovery may change them.

Unit tests cover positive/negative/unknown/stale ranking, exact source flags versus missing sellers, deterministic priority and unavailable recovery admission. Isolated PostgreSQL tests exercise persistence/timestamps, out-of-order newer negatives, unknown quote preservation, failed requests, category omission, absent-result replay, recovery, unchanged price history, withheld/resumed coverage and atomic cross-retailer capacity. Existing canonical/list/basket boundaries retain their regression coverage. The local production build and all eight isolated listing Chromium tests pass, including unavailable search exclusion, retained history and explicit recovery; all 22 shopping/basket cases also pass. See [coverage validation](catalog-coverage.md).
