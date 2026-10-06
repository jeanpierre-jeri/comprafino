# Shopping lists

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

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

Shopping lists remain browser-local (with a session fallback). Evaluation requests transiently send list labels, queries, amounts and item metadata to the server. Evaluation does not persist the list or create discovery demand; no account/IP identity is attached.

`/api/list/evaluate` accepts at most **128 KiB of UTF-8 body bytes**, including JSON escaping. This accommodates 50 items with maximum label/query/profile fields and conservative metadata headroom. Both declared length and actual streamed bytes are checked before JSON parsing; no streaming JSON parser is used. Oversized bodies return safe 413, malformed JSON/schema or more than 50 items return 400, and rejected requests never access market evaluation. Within the byte cap, labels/queries remain limited to 120 characters.

`/api/list/evaluate` validates the version-two list and performs read-only current-catalog queries; evaluation never ingests or refreshes retailers. The unused legacy `GET /api/list/products` endpoint was removed in the final repository cleanup and now returns 404; dialogs use contextual creation and do not search that endpoint. Responses are uncached and validated; list prices refresh on tab return and every minute. Fresh active ordinary prices and supported CMR benefits use existing ranking. Milestone 16 now compares optimized complete/partial baskets for up to one, two and three retailers; per-item recommendations retain their existing behavior. Frequencies do not produce a monthly recurring bill.

## Limits and current basket work

Basket optimization consumes shared approved fulfillment options and preserves substitution, freshness and quantity gates. Broad search relevance cannot establish equivalence. Legacy exact normalized quantities are retained; family coverage is limited, names may under-describe specialty properties, canonical references can become unavailable, and browser lists have no account sync or backup. See [basket optimization](basket-optimization.md).

## Transient browser-storage failure (Cleanup A)

Storage rereads use the latest module/session list as their fallback when localStorage access throws. Mutations and storage-event handling preserve that list instead of replacing it with an empty list. A read warning survives the same mutation even if its subsequent write succeeds. Session state continues across client navigation; a full reload without working storage cannot recover an unpersisted session.

Working storage still supplies the latest persisted state before mutation and cross-tab events still synchronize it, including removal/clear. Missing or malformed/incompatible stored data retains the existing empty-list recovery semantics; it is distinct from inaccessible storage. No state-management dependency was added.

Current item and basket responses are rendered only for the list object, price mode and refresh revision that produced them. When an item is removed or edited, the previous response is withheld immediately during rendering, before effects start reevaluation. This prevents a deleted item's basket assignment from being rendered against the updated list and preserves the remaining session items.
