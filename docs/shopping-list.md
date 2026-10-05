# Flexible recurring shopping list — Milestone 15

Implemented and staged for local validation. **Not complete yet:** the sandbox production build hit the known Turbopack CSS worker-port restriction. Chromium execution and desktop/mobile visual acceptance remain pending. Next configuration is unchanged; there is no commit or push.

## Saved model and browser persistence

The `comprafino-shopping-list` localStorage key contains `{ version: 1, items: [...] }`. Each item stores a stable local UUID, intent, label, search query, quantity `{ amount, unit }`, weekly/biweekly/monthly frequency, creation/update ISO timestamps, and either a canonical UUID (preferred/strict) or null (generic). Quantity's unit encodes its normalized dimension. The schema limits lists to 50 needs, validates whole counts and up to three decimal places for kg/L, rejects duplicate IDs/semantic keys, and produces deterministic serialization.

Core owns schemas, safe parsing and immutable add/edit/remove operations. The web repository isolates browser I/O; React state plus a small subscription hook shares changes across components. SSR never accesses storage. Invalid JSON, invalid schemas and unknown versions return an empty list with a recovery message; the original storage value is untouched until the user explicitly saves. Read/write failures retain an in-memory list during client navigation and explain that it will be lost on reload. Clearing browser data deletes the list. There are no accounts, remote list storage, migrations, dependencies or new state management libraries.

Storage events update other tabs, including removal of the key or clearing storage. Writes reread valid persisted state before mutation; simultaneous writes remain last-writer-wins, without transactional synchronization. Duplicate adds show “Actualizar existente” and update quantity/frequency while preserving the original ID and creation time. The key is intent plus compatible generic family/variant (normalized query for unsupported needs) or canonical ID plus requested measure. Different intent/measure combinations are distinct needs. Editing into an existing key is rejected with a message rather than silently merging two items.

## Intent and current recommendations

- **Cualquier opción que convenga:** stores a generic search intent. Supported family/variant needs drop brand/pack-size constraints when retrieving market candidates; unsupported queries are not silently broadened. All current compatible candidates are evaluated before returning up to three offers; changing prices can change the winning brand.
- **Prefiero este producto:** stores a stable canonical reference. Its cheapest eligible current retailer remains prominent and contributes to the summary. A compatible substitute is shown when the purchase saves both at least S/ 1 and 5%. The preference is never mutated. If that product has no eligible current offer but its public identity still exists, a compatible alternative may be displayed and included in the estimate without a savings claim. A missing/untrusted canonical identity cannot derive substitution semantics from an old local label.
- **Solo quiero este producto:** evaluates only that canonical identity across current retailers. It never substitutes another product. Exact comparison/history links reuse the existing detail page; history is not duplicated in list cards.

The read-only `/api/list/evaluate` boundary validates the versioned list before querying PostgreSQL. `/api/list/products` reuses public canonical search for explicit product selection. No retailer request, refresh or ingestion happens in evaluation. Work is bounded to 50 items and sequential queries. Responses are uncached and client responses are schema-validated; aborted requests cannot replace newer state. List prices refresh when returning to the tab and every minute while visible.

## Quantity, packages and overbuy

Supported measures are contained units, kg and L. A count need must be an integer. Mass/volume use catalog g/ml normalization with integer arithmetic at thousandth-unit precision. Each candidate needs strong existing quantity evidence and a matching measure; ambiguous quantities, tuna content, approximate paper rolls, and direct-KG quotes without a known retail package are excluded from generic quantity fulfillment.

For an exact mass/volume product, requesting units explicitly counts **whole retail envases/packs**, not litres/kg or the number of bottles inside a multipack. The editor explains this and recommendations label the count as envases/packs. An egg count still counts eggs and requires strong count evidence; an unknown package quantity is not guessed.

Packages = ceiling(requested quantity / package quantity). No fractional package purchase is assumed. Cards report packages, purchased quantity, extra quantity, total cost and effective price per purchased unit. A purchase can exceed the need, but purchases exceeding **2× the requested quantity** are excluded. This applies to all three intents. Within that bound, rank by total cost to satisfy the need, then lower overbuy, effective unit price and stable listing ID. There is no storage-life, travel-cost or utility score, and no mixed-package combination within a need.

## Compatibility and exact-match safeguards

Reuse the existing public generic search, structured family interpretation, normalization fingerprint/version, quantity-quality and freshness checks. Generic recommendations include independently normalized single-retailer products: requiring an exact cross-retailer association would incorrectly hide Bell's/Tottus store brands and almost all detergent options. Independence is not an assertion that a product matches a saved canonical SKU.

Canonical identity/history links are only attached by the existing public eligibility CTE: automatic/current-version/≥0.90 links, at least two retailers, and no manual/low-confidence/obsolete associations. Review and unmatched listings never leak into strict canonical offers or become invented exact/history associations. An independent offer with strong family/variant/quantity evidence can compete as a generic substitute while retaining a null canonical ID.

List compatibility further narrows existing families without changing the matcher:

- Ordinary chicken eggs; exclude quail, organic, free-range, corral, omega/enriched and premium variants.
- Ordinary white rice; exclude integral, basmati, jasmine, risotto/arborio, prepared/precooked/parboiled, mixed quinua and red/black variants. Source marketing grades such as extra/superior/añejo remain ordinary rice; the complete title is shown.
- Ordinary vegetable/soy oil and sunflower oil are separate groups. A broad “aceite” defaults to vegetable/soy. Olive/coconut/avocado/sesame/specialty oils are excluded.
- Powder and liquid detergent are separate, with machine/matic variants separated further. Baby/children, micellar, hypoallergenic, antibacterial, fabric-softener, pods and specialty color variants are excluded from ordinary substitutes. A broad “detergente” selects powder for kg and liquid for L.

Other families fail closed. Generic milk is unsupported: fat level, lactose, fortified/reconstituted/evaporated semantics and bottle-content count need more evidence. Tuna and paper rolls retain existing cautions; sugar/pasta/flour/oats are not enabled for generic list equivalence yet. These products can still be saved as exact preferences/strict items when their quantity/identity is supported. Full variant titles remain visible; compatibility does not claim every nutritional/quality property is identical. More specialist groups need explicit reviewed evidence before expanding this policy.

## Ordinary and benefits prices

Standard mode uses the current ordinary open price state. Benefits mode lets existing supported, fresh, active CMR conditions compete through `rankedPrice`; unsupported promotions never enter the model. Cards clearly display the condition and separate ordinary purchase total. No ordinary state or history is overwritten by a conditional offer. Unavailable, future-dated or >36-hour-old offers never participate; without a valid recommendation, the card says “Estamos actualizando este producto.” Query failures instead explain that prices could not load and offer retry.

The summary adds independently evaluated valid item recommendations. It identifies unpriced needs and the number priced. It does not mix frequencies into a recurring monthly bill, aggregate preferred-alternative savings, or claim a globally cheapest multi-store basket.

## Public experience

`/list` groups stacked cards by frequency, with an empty search CTA, pricing mode, summary, edit/remove controls, and at most three current options. The public header includes “Mi lista” through the existing immediate navigation component and a loading boundary. Search offers “Agregar como necesidad”; canonical detail pages offer a compact intent/quantity/frequency dialog. Generic-to-specific edits require explicit canonical selection. Strict-to-generic edits preserve family context where available.

Native modal dialogs provide keyboard containment/Escape; dismissal closes the dialog and restores trigger focus. All fields and radio options have labels. Status/error copy is textual. Existing theme tokens support light/dark. Cards use one column at 390px and two columns on desktop; fields and buttons have 44px minimum targets. Browser screenshots and human visual review are still required before acceptance.

## Real current-data audit

The read-only [snapshot](shopping-list-audit.json) records current PostgreSQL data on **October 4, 2026, Peru time**, with no retailer requests or writes. The arithmetic below was independently recalculated from the stored source quantities/prices. These are observations, not guaranteed future prices.

| Need           | Fresh search offers inspected | Eligible best ordinary purchase                          | Arithmetic                                             |
| -------------- | ----------------------------: | -------------------------------------------------------- | ------------------------------------------------------ |
| 30 eggs        |                            29 | Tottus 30-unit tray; S/ 15.90 (Bell's ties at Plaza Vea) | 1 × S/ 15.90; 30 eggs                                  |
| 5 kg rice      |                            54 | Faraon añejo 5 kg at Plaza Vea; S/ 19.50                 | 1 × S/ 19.50; 5 kg                                     |
| 3 L oil        |                            27 | Bell's vegetable 3 L at Plaza Vea; S/ 18.50              | 1 × S/ 18.50; 3 L                                      |
| 6 milk units   |                           104 | Generic recommendation withheld                          | Not safe to equate variants or count volume as bottles |
| 3 kg detergent |                            24 | Sapolio Limón 2 kg at Tottus; S/ 33.80                   | 2 × S/ 16.90; 4 kg, 1 kg extra                         |
| 3 L detergent  |                       Same 24 | Bolívar Cuidado Total 3 L at Plaza Vea; S/ 41.50         | 1 × S/ 41.50; 3 L                                      |

Specialty eggs/rice/oils were inspected and withheld; powder/liquid/matic and baby/micellar detergents were kept separate or excluded. No matcher was broadened to improve these results. Exact real-product add/edit interactions still need local browser review.

Reproduce with `pnpm audit:shopping-list` using root `.env`/`DATABASE_URL`. It emits public product data only. As with previous audits, server databases and prices can change between runs.

## Verification and completion gate

Passed: format/lint/typecheck, all 560 unit tests (including 18 shopping-list cases for shopping persistence, intent, package math, overbuy, price mode, stale/weak/incompatible exclusions, independent brands and preferred/strict behavior), and all **42 PostgreSQL integration tests**. The isolated browser harness validates ordinary S/ 14.90 and supported CMR S/ 12.90 winners and cleans up its random schema. No live retailer dependencies.

Ten Chromium scenarios cover generic add/reload/edit/remove/duplicates, invalid/unavailable storage, cross-tab removal/clear, Escape/focus, 390px/desktop light/dark screenshots, preferred savings, strict isolation/history, benefit-mode switching, fixture price changes and generic-to-specific selection. The initial user-run default E2E reported 12 passed, 19 skipped and five failures: four shopping scenarios were blocked by the count input’s native step mismatch, and a navigation assertion expired while streamed results were loading. The input now uses min=1/step=1 for units and min=0.001/step=0.001 for kg/L. Browser regressions assert numeric validity, successful dialog dismissal and saved status; the navigation readiness assertion allows 15 seconds within the existing test budget. **The corrected scenarios still require execution**: `pnpm build` failed binding the Turbopack worker port and `pnpm test:e2e` could not start its production server. There is no successful production build of the corrected implementation available in the sandbox. An isolated Chromium native-form check reproduced the original failure and confirmed whole-unit submission, fractional kg/L validity and fractional-count rejection. No framework workaround is added.

Local confirmation:

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

Inspect `/list` at desktop/390px in both themes, generic/preferred/strict cards, add/edit/remove/duplicate flows, keyboard focus and immediate navigation/loading. The fixture command additionally supplies a fully isolated PostgreSQL catalog to the browser; default E2E skips fixture-dependent cases. Use `pnpm test:e2e:list:local --validate-fixtures` for database-only fixture checks.

After those gates pass, commit `feat: add flexible recurring shopping list`. Do not push automatically.

## Future planning and limitations

Stable item/canonical references, need size, recurrence metadata and timestamps support later decision-history and temporal analysis without pinning a generic need to its current winning SKU. This version stores no next date, weekday pattern, decision history, prediction, alert or buy/wait recommendation. It evaluates each need independently and buys one package type from one retailer per need; whole-basket/store optimization is deferred. Browser-only persistence has no account sync/backup and a 50-item limit. Canonical IDs can become unavailable after catalog regrouping; users can explicitly select another product.

Recommended next work is reviewed compatibility/coverage expansion and recording actual list purchase decisions before temporal planning. Do not start it automatically or issue timing advice from the young price history.

### Follow-up browser validation

The next user-run default E2E passed 16 tests, skipped 19 fixture/catalog cases, and found two exact-label lookup failures for Medida/Frecuencia. Isolated Chromium reproduced `getByLabel("Medida", { exact: true })` matching zero elements when the wrapping label included select option text, while the combobox role/name matched correctly. Editor product/measure/frequency selects and the list pricing select now use separate `label htmlFor`/select `id` associations, with React `useId` ensuring unique SSR-safe IDs. Regression assertions retain exact-label selection and additionally check accessible names. An isolated Chromium dialog verified exact lookup, accessible names and option selection for all four corrected controls. Format/lint/typecheck and the 560-unit-test suite pass. Corrected application E2E execution remains pending local build confirmation.

The subsequent default E2E passed 17 tests, skipped 19 and found one focus restoration failure after saving a frequency change. Moving the card between frequency sections remounts its edit button; the old DOM reference could not retain focus. The list now registers current edit buttons by item ID and restores focus in a layout effect after the dialog closes and React commits the move. The regression explicitly checks the new frequency section, focus after saving, and focus after Escape. Isolated Chromium rendered the actual React list/editor components (with a lightweight link substitute and stubbed pricing response) and passed both save/move and Escape focus checks. Format/lint/typecheck and all 560 unit tests pass. Production build and application E2E remain pending because the sandbox still rejects the Turbopack worker port.
