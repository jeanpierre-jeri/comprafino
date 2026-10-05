# Listing and price eligibility vocabulary

| Term                         | Meaning and owner                                                                                                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Known listing                | Retained retailer/SKU identity, possibly stale, unavailable, unnormalized or unmatched. Persistence is not purchase approval.                                                    |
| Public identity eligibility  | Trusted automatic/current-version exact association and group identity gates in `db/public-products.ts`; independent listing pages have their own validated identity boundary.   |
| Current purchase eligibility | Positive ordinary PEN price, active listing, availability not explicitly false, consistent open price state, current observation and the relevant normalization/identity gates.  |
| Generic search option        | Independently normalized, relevant retailer offering. Relevance and a usable unit price do not establish safe substitution.                                                      |
| Safe substitution candidate  | Current purchase option accepted by the supported family/variant, quantity and fulfillment policy in core. Unsupported or ambiguous profiles fail closed.                        |
| Exact comparison candidate   | Current trusted canonical option for the requested exact identity. Generic similarity cannot supply this association.                                                            |
| Ordinary price               | Positive unconditional observed amount paid for the source sale offering or kilogram; persisted ordinary history tracks its state changes.                                       |
| Reference price              | Separately reported higher comparison/list price. It is not the amount paid and cannot become the purchase winner.                                                               |
| Conditional offer / benefit  | Concrete validated amount with program/payment/validity conditions, such as Tottus CMR. Evaluated separately in benefits mode; excluded from ordinary history.                   |
| Availability                 | Tri-state source evidence: true, false or unknown. Unknown delivery text is not a positive stock claim; explicit negatives prevent current purchase eligibility.                 |
| Freshness                    | Age of an accepted price observation. Fresh price evidence does not establish address-specific stock; retailer run health does not establish freshness of each retained listing. |

`knownListings.public` / `KnownListing.public` is an approximate exact-association refresh-priority hint. It does not check every current normalization, price, stock and freshness gate and must not be used as purchase eligibility. The name remains for this narrow existing internal contract; the schema comments identify its role.

[Matching](catalog-matching.md), [availability](availability.md), [listing refresh](listing-refresh.md), [generic comparison](generic-comparison.md), [substitution compatibility](substitution-compatibility.md) and [shopping lists](shopping-list.md) define the durable rules. Shared constants live in their domain owners, not a generic configuration framework. SQL migration constraints intentionally encode reviewed invariants independently; changing schema policy requires reviewed migrations, not merely changing a TypeScript constant.

## Shared policy ownership

`catalogPolicy` owns retained admission/read capacity and its derived overflow sentinel. `listingRefreshPolicy` owns offer freshness and targeted admission/bounds; `matchingThresholds.auto` owns automatic confidence. `shoppingListPolicy` supplies list/basket item limits, quantity precision/amount and preferred savings to schemas, evaluation and editor controls. Scheduled retailer totals derive from scraper `refreshCoverage`; discovery reporting distinguishes the default query batch from the daily maximum and per-retailer listing yield.

Deliberately separate: retailer run health versus listing freshness; targeted age versus cooldown; UI result limits versus complete DB safety bounds; UTC discovery admission versus Peru observation day; default discovery query count versus per-retailer listing yield; measurement scenarios, currency/unit conversions, source page sizes, request pauses and calibration sample bounds. Their equal numeric values do not imply shared policy. Reviewed SQL schema constraints retain independent invariant encoding; runtime SQL predicates interpolate domain constants and are covered by SQL contracts and PostgreSQL boundary tests. No migration-policy change is introduced.
