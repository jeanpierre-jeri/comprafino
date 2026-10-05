# Shopping lists — Milestone 15.1

Milestone 15 supplies recurring browser-local needs and current recommendations. Milestone 15.1 is committed in `075c999` and accepted in the user-confirmed baseline. [Milestone 16 current basket optimization](basket-optimization.md) is implemented and validated: local production build, standard smoke and all 22 isolated shopping/basket Chromium tests pass. No temporal prediction, account, alert, dependency or PostgreSQL schema change is included.

## Contextual creation and editing

Generic saves persist the safe substitution context rather than the raw retailer/brand search: `huevos tottus` and `huevos metro` become `Huevos` / `huevos` with `eggs:regular`. Unsupported semantic variants such as `huevos de codorniz`, `arroz integral`, and `aceite de oliva` retain their descriptions with null profiles. Custom labels and explicitly withheld substitution evidence remain conservative.

From search, **Agregar como necesidad** opens a compact dialog titled with the search label. Intent is automatically generic. Only desired quantity, measure and frequency are editable, followed by “Compararemos opciones equivalentes entre marcas y supermercados.” There is no intent radio group, product search or list-name field.

Canonical comparison cards, safely linked retailer-option cards and product details provide **Agregar a mi lista** with the product already selected. The dialog offers **Prefiero este producto** and **Solo quiero este producto**, a whole sale-package count (default one) and frequency. Labels are generated from the canonical display name. There is no generic option, nested product search or editable name. To choose another product, close the dialog and choose it in search.

Every retailer-option card also provides a compact, secondary **Agregar a mi lista** action. Listings without a safe public canonical association save only generic needs, with no preferred/strict radio choices or invented exact identity. Supported families preserve the appropriate form (including sunflower and machine detergent) and use strong normalized contents as the initial desired quantity. Unsupported listings retain their description and save with a null profile; the dialog explains that comparable alternatives are unavailable. Search ranking and matching thresholds are unchanged. Card title links stretch across the background: safely linked cards navigate to CompraFino product details, while independent cards open the retailer in a new tab. Buttons sit above that overlay and open the list dialog without navigating or opening another tab. The explicit retailer link remains available on linked cards.

Generic edits keep desired quantity, measure and frequency. New exact edits keep package count, frequency and preferred/strict choice. Custom names already persisted remain visible and survive editing and migration. Editing does not change the underlying product or convert a generic need to an exact product; select another product outside the dialog. Shared native dialogs fade/scale in over 180ms and out over 140ms, including the backdrop. A labeled 44px close button, Cancel, Escape and a backdrop click all dismiss them; clicks inside and content-origin drags ending outside preserve edits. Reduced-motion preferences remove animations and close immediately. Dropdowns and shopping controls use short transitions rather than page-wide motion. Dialogs retain keyboard containment and trigger focus return; edit focus is restored after a frequency change remounts its card.

`/list` groups cards by weekly/biweekly/monthly recurrence. Public intent copy is “Cualquier opción equivalente”, “Producto preferido”, and “Producto exacto”. New exact items display `1 paquete` or `6 paquetes`; generic items display their desired units/kg/L. Explicitly withheld compatibility stays withheld on save/edit and is kept distinct from a supported family need during duplicate detection. Creating a new supported need from search can establish that separate intent. Unknown or unsupported generic compatibility displays “No encontramos alternativas suficientemente comparables por ahora.” Pricing failures have their own retry message.

## Desired quantity and sale-package counts

Generic `quantityMode: normalized` means the amount needed: 30 eggs, 5 kg rice or 3 L cooking oil. Strong catalog quantity evidence determines how many whole packages fulfill it. Mass/volume use integer thousandth-unit arithmetic; units are whole counts. Packages = ceiling(desired quantity / package quantity). Offers exceeding twice the desired amount are excluded.

New preferred/strict `quantityMode: packages` means whole **sale packages**, independently of their contained measure. Two exact 30-egg trays mean two trays, not two eggs. Two exact 1 kg rice packages mean two packages. Exact recommendations price that many sale packages without asking the user to enter the SKU's own size. Direct per-kg quotes cannot be treated as sale-package prices.

Preferred alternatives fulfill the contained amount of those requested packages using strong current exact-product quantity evidence. Two 30-egg trays may be compared with four safe 15-egg trays. Two 1 kg packages may be compared with four safe 500 g packages. If the current exact package contents cannot be established, alternatives are withheld. Options carry their own quantity unit, so mass/volume alternatives are not mislabeled as package counts.

Strict products retain their exact canonical identity across retailers and never substitute. Preferences retain their original identity and show an alternative only when it saves at least both S/ 1 and 5%, or when the preferred offer is unavailable and equivalent fulfillment can still be established. Exact eligibility, freshness, ordinary/conditional-price safeguards and matching rules remain unchanged.

## Browser storage and migration

The existing `comprafino-shopping-list` localStorage key now stores `{ version: 2, items: [...] }`. Items retain UUID, intent, label, query, quantity, frequency, timestamps and canonical reference. Added fields are `quantityMode` and nullable `substitutionProfile`; generic creation stores a normalized query and a conservative inferred profile. The measure already captures normalized quantity dimension. Unsupported needs are saved with a null profile and receive no automatic substitutions.

Valid version-one lists migrate in memory to version two on read. All three intents, IDs, canonical references, custom labels, original quantities, frequency and timestamps are retained. Generic profiles are inferred only through the conservative domain policy. Legacy exact quantities stay `normalized`: storage has insufficient package evidence to reinterpret 30 eggs as 30 trays or 2 kg as two packages. Their editor explicitly explains that the original measure is retained. Legacy exact unit counts for mass/volume still preserve Milestone 15's container-count behavior. Re-adding the SKU creates an explicit package-count item; the two quantity modes have distinct duplicate keys.

A subsequent explicit write serializes version two. Reading does not overwrite the original stored value. Invalid JSON/schema, duplicates or unknown versions recover to an empty list with a message; malformed input is not silently coerced. Schema defaults preserve omitted legacy metadata conservatively. Browser storage failures retain session state and explain reload loss. Limits remain 50 needs, whole counts and up to three kg/L decimals. Cross-tab updates, deletion and last-writer-wins behavior are unchanged. Migration affects browser data only; there is no SQL migration.

## Compatibility and current prices

Search relevance and substitution compatibility are separate. Broad search can include quail eggs, specialty rice/oils and mixed detergent forms. Saved needs cannot use keyword relevance as evidence of equivalence. Framework-independent APIs and family policies are documented in [substitution compatibility](substitution-compatibility.md).

Evaluation reuses normalized family/category and strong quantity evidence. Independent normalized retailer offers can satisfy generic needs without gaining invented canonical/history associations. Exact associations still require current automatic high-confidence public matching eligibility. Null or inconsistent saved compatibility fails closed. Preferred compatibility comes from the current canonical product, never a custom local label. A negative source-family classification remains negative.

`/api/list/evaluate` validates the version-two list and performs read-only current-catalog queries; evaluation never ingests or refreshes retailers. The old product-selection endpoint remains available but is unused by the dialogs. Responses are uncached and validated; list prices refresh on tab return and every minute. Fresh active ordinary prices and supported CMR benefits use existing ranking. Milestone 16 now compares optimized complete/partial baskets for up to one, two and three retailers; per-item recommendations retain their existing behavior. Frequencies do not produce a monthly recurring bill.

## Real-data audit

The read-only [audit snapshot](shopping-list-audit.json) records current catalog data on October 4, 2026 (Peru). It lists every audited broad candidate, semantic compatibility, safe quantity evidence, exclusion reason and current recommendations. No retailer request or catalog write was made. Audit retrieval intentionally examines all eligible search offers rather than only the public page's first 30.

| Need                   | Broad candidates | Compatible candidates with strong matching quantity evidence |
| ---------------------- | ---------------: | -----------------------------------------------------------: |
| Eggs, 30 units         |               29 |                                                           18 |
| Rice, 5 kg             |               54 |                                                           44 |
| Vegetable oil, 3 L     |               27 |                                                           17 |
| Milk, 6 units          |              105 |                                                            0 |
| Powder detergent, 3 kg |               24 |                                                           12 |
| Liquid detergent, 3 L  |               24 |                                                            6 |

These compatibility counts precede purchase-size/overbuy filtering and offer ranking. Three live quail offers remain discoverable: Bell's 18-unit and 24-unit trays and La Calera 18-unit eggs. All are incompatible and excluded. Other exclusions include corral/free-range/organic eggs, integral/arborio/parboiled/premium rice, oleic/premium oils, baby/micellar detergent and machine detergent for ordinary needs. Conservative rules also exclude some marketing names such as Faraón Rojo/Negro; precision is favored over recall.

Reproduce with `pnpm audit:shopping-list` and the existing configured `DATABASE_URL`. Future prices and catalog membership may change.

## Validation and completion gate

Passed: TypeScript checks; 606 unit tests (including migration of every intent/custom labels, generic desired quantities, exact egg/rice package counts, preferred contents-based alternatives and compatibility family rules); 42 PostgreSQL integration tests; isolated shopping/history fixture validation. The PostgreSQL regression proves quail eggs remain in broad search while generic and preferred recommendations reject an artificially cheapest quail candidate.

The user confirmed fresh local production `pnpm build` and `pnpm test:e2e` passed and accepted the final UX for Milestone 15.1. The final persistence-normalization correction then passed format/lint/types and 606 unit tests. A fresh agent build retry, including elevated execution, encountered the same CSS worker port restriction; full application E2E could not be repeated against that correction here. Earlier sandbox attempts were blocked by Turbopack CSS worker port restrictions; Next configuration was unchanged. Updated Chromium scenarios cover compact generic creation, preselected exact creation, package-count edits, version-one browser migration, Escape/focus, and create/edit screenshots for generic/preferred/strict items across both widths/themes. An isolated Chromium hit-test reproduced the stretched-link interception before the CSS fix, then confirmed add-button/dialog clicks and card-background/link clicks at 390px and 1280px using the actual overlay/control stylesheet rules. The actual shared React modal also passed isolated Chromium checks for opening/closing animation, close button, Cancel, Escape, backdrop dismissal, inside-click/drag protection, focus return and reduced motion at both widths. These isolated checks do not replace application E2E. Database-only fixture validation does not execute these browser scenarios. Retailer-option regressions additionally cover canonical preferred/strict creation, independent generic creation without strict mode, and unsupported/quail creation with recommendations withheld.

Local acceptance commands:

```sh
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:db:up
pnpm test:integration:local
pnpm build
pnpm test:e2e
pnpm test:e2e:list:local
pnpm test:db:down
```

Review generic huevos search and canonical eggs add/edit flows, all three intents at desktop and 390px, both themes, keyboard containment, Escape and focus return. Local build/E2E and final UX acceptance were confirmed by the user. Commit `fix: simplify shopping list intent and safe substitutions`. Do not push or begin Milestone 16 automatically.

## Limits and current basket work

The compatibility API and explicit quantity modes now supply Milestone 16 basket optimization through shared approved fulfillment. Optimization applies the same safety gate, freshness and quantity evidence; it must never treat broad search relevance as equivalence. Milestone 16 implements the optimizer through this shared domain boundary; see [basket optimization](basket-optimization.md) for scope and pending validation. Legacy exact normalized quantities are intentionally retained, family coverage is deliberately limited, names may under-describe specialty properties, canonical references may become unavailable, and browser lists have no account sync or backup.

## Milestone 18 availability and measured coverage

Current evaluation keeps the existing SQL/current-offer boundary: explicit unavailable flags cannot be the best option, while unknown stock follows normal price freshness. The updated writer preserves stronger negative evidence through later unknown quotes and recovers only with newer explicit positive evidence. No substitution profile or intent policy is expanded. [Coverage audit](catalog-coverage.md) reports 103 potential generic candidates and 147 exact package candidates, before need-specific gates; family coverage is not equivalent to safe fulfillment. [Availability](availability.md) documents history, recovery and coordinated writer rollout.

## Transient browser-storage failure (Cleanup A)

Storage rereads use the latest module/session list as their fallback when localStorage access throws. Mutations and storage-event handling preserve that list instead of replacing it with an empty list. A read warning survives the same mutation even if its subsequent write succeeds. Session state continues across client navigation; a full reload without working storage cannot recover an unpersisted session.

Working storage still supplies the latest persisted state before mutation and cross-tab events still synchronize it, including removal/clear. Missing or malformed/incompatible stored data retains the existing empty-list recovery semantics; it is distinct from inaccessible storage. No state-management dependency was added.

Current item and basket responses are rendered only for the list object, price mode and refresh revision that produced them. When an item is removed or edited, the previous response is withheld immediately during rendering, before effects start reevaluation. This prevents a deleted item's basket assignment from being rendered against the updated list and preserves the remaining session items.
