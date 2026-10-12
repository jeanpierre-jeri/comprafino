# Search UX

Search remains server-rendered and shareable. The query form submits a GET search. A small client toolbar immediately navigates with App Router `router.push(..., {scroll:false})` when a select changes. There is no Apply button, browser-side results cache, state-management dependency or persistent filter preference. Labelled Base UI custom Select triggers/popups support keyboards; navigation disables the fieldset while pending and announces “Actualizando resultados…” using an output/status element. Back/forward restores controls from server URL props.

| Parameter   | Default (omitted) | Supported values                                                         |
| ----------- | ----------------- | ------------------------------------------------------------------------ |
| `q`         | empty             | existing validated query                                                 |
| `category`  | all               | `abarrotes`, `lacteos-huevos`, `bebidas`, `limpieza`, `cuidado-personal` |
| `sort`      | `relevance`       | `total-price`, `unit-price`                                              |
| `retailer`  | all               | `tottus`, `plaza-vea`, `metro`, `makro`                                  |
| `unit`      | all bases         | `kg`, `L`, `unit`, `roll`                                                |
| `priceMode` | `standard`        | `benefits`                                                               |

Invalid, duplicate/repeated or unsupported filter values fall back independently to defaults. Query text is encoded. Example: `/search?q=huevos&sort=unit-price&unit=unit&retailer=metro&priceMode=benefits`. Exact detail supports `priceMode=benefits` too; comparison links preserve that preference.

## Filters, sorting and eligibility

“Relevancia”, “Menor precio total” and “Menor por unidad” retain existing family admission and SQL relevance. Generic candidates are filtered **before** the thirty-card limit, then sorted. Package totals remain separate from direct KG quotes. Unit sorting compares exact rational prices only inside compatible kg/litre/physical-item/approximate-roll blocks; absent unit prices remain a labelled last block. Approximate roll prices remain orientative, never interchangeable with eggs/items.

The optional basis select appears only when multiple comparable bases exist, or a basis is already selected so it can be cleared. One strong basis needs no extra select. Basis choices come from all admitted candidates for the selected retailer, before card limits and selected-basis filtering. No kg/L/count conversion is guessed. No brand facet is added: existing query text already preserves brand/variant tokens, and the small catalog does not justify another control.

Retailer and unit selection filter the single product list. Only current eligible independent offers are shown, including listings with an existing exact association. Each card retains its listing detail, source, shopping-list action and optional exact-comparison link. Exact product identity and detail associations remain unchanged.

Default prices rank ordinary quotes. “Incluir beneficios” uses lower fresh CMR potential prices with adjacent required-card text; it does not assert user eligibility. Generic cards keep ordinary totals visible even when benefit unit prices determine sorting. See [conditional pricing](conditional-pricing.md).

Discovery uses the successful **unfiltered** useful-query count. A retailer/unit filter returning zero existing candidates displays “No hay opciones con estos filtros” and suggests clearing filters; it creates no new missing-catalog demand. True underlying empty searches retain existing discovery handling. Public navigation never calls retailers.

## Explicit comparison scope

Search shows a single “Productos” grid. It has no separate exact-comparison section or disclosure arrow. Sorting applies to its retailer offers, and category/retailer/unit filters and pagination describe that same visible list. Empty filters cannot leave a second comparison section behind. Comparison links on eligible product cards open `/products/[id]`, where all retained stores, current offer counts, unknown stock and stale/unavailable records remain disclosed.

Validated strong egg counts use “/ huevo” for ordinary and CMR unit prices on independent cards/listing detail and CMR references in exact comparisons. Fractions, rounding, sorting and identity are unchanged. Independent cards and listing detail explain absent unit prices using existing calculation reasons. Direct KG quotes retain their source “/ kg” label.

Controlled `apps/web/e2e/search-experience.spec.ts` cases run with `pnpm test:e2e:fixtures:local` after a production build, in the existing owned random schema. Fixtures exercise 15/30 eggs, differing variants, unknown stock, ordinary ties, CMR, missing/ambiguous quantities, stale/unavailable exclusions and product-card links opening comparisons with all retained stores after a retailer filter. DB tests cover one/zero current offers separately from retained store counts. No application catalog, retailer requests, schema changes or additional infrastructure are required.

## Milestone 12 visual refinement

The URL/state behavior above is unchanged. The heading is borderless, with compact sage controls, a single product grid on the warm page background. The toolbar uses 44px custom controls in two columns from 380px (one below that), four/five on desktop according to available bases; an odd final control spans the mobile row. Product cards use compact images beside complete titles on desktop and mobile, larger ordinary prices, stronger unit prices and small retailer labels. Result dates use relative “Observado hace …” wording with exact ISO/tooltip timestamps; detail keeps full Peru dates. Generic title links extend across the card and now open `/listings/[id]`, with external source links kept separate. Ordinary prices remain primary even in benefits mode; calculated conditional unit prices keep “con CMR”, and CMR totals/requirements have a separate warm surface. Detail groups ordinary minima and lower conditional benefits in its product hero, with distinct compact retailer rows. Empty states provide a same-query filter reset or starter search. See [UI polish](ui-polish.md) for the manual audit, visual system and validation.

No history chart, aggregation, filter preference persistence, client caching or filter modal is included.

## Category navigation

The homepage now links to five CompraFino categories instead of product examples. `/search?category=lacteos-huevos` browses without query text; `/search?q=gloria&category=lacteos-huevos` searches within that category. Nonempty text keeps the existing 2–120 character validation. The category selector includes “Todas las categorías”; invalid/repeated category values fall back to that option. Filter changes reset pagination, browser back/forward restores URL state, and submitting search preserves the current category, retailer, sort, unit and price mode.

`packages/core/src/search-categories.ts` defines the public category IDs, labels and explicit source-department mapping. Membership comes from active acquired `catalog_sources` paths through `catalog_source_listings`, using their first department name. A product in multiple acquired paths appears once. Missing or unrecognized category evidence is not guessed from titles: those listings remain available in general search. This initial navigation covers pantry/breakfast, dairy/eggs, nonalcoholic drinks, cleaning and personal care; other departments remain outside these five categories.

Public product candidates are category-filtered in SQL before pagination. The internal exact-group search helper retains its category filtering for database consumers; the public route disables separate comparison results with `includeComparisons: false`, avoiding unused exact-group reads and extra pages caused by hidden groups. Comparison destinations still show all retained stores. Category membership does not change exact identity, family classification, substitution policy or price eligibility. Category-only browsing never records missing-product discovery or creates a shopping-list item from a department name. A category filter on a textual search preserves unfiltered discovery counts; an empty filtered result is not new missing-product demand. Refresh requests remain bounded to the category search candidates, and public requests make no retailer calls.

No migration, dependency, ingestion change or separate endpoint is required. Availability of category results depends on acquired membership already stored in the catalog. Pure URL/request tests, owned-schema SQL tests and controlled Chromium category navigation/pagination tests exercise this behavior.

Category membership is applied to the raw `retailer_listings.id` UUID inside the current-offer query, before JSON projection. Filtering the projected JSON identity instead hides column statistics and can produce a nested-loop plan that recomputes the complete exact-product aggregate for each admitted listing. The owned-schema regression seeds 1,200 current category listings plus exact groups, collects statistics and executes the real query with `EXPLAIN ANALYZE`; it checks that exact groups are aggregated at most once, without a timing threshold tied to the test machine.

The public search route sets a 12-second HTTP deadline per database request. Each executed request gets a fresh abort signal, including later refresh-demand batches on the same client. Failed/timed-out reads use the existing public error state instead of leaving the loading skeleton waiting indefinitely. Auth, ingestion and other database callers retain their existing transport defaults; this deadline does not retry requests or guarantee that PostgreSQL cancels server-side work immediately on an HTTP disconnect.

Public appearance supports System/Light/Dark independently of filter URLs. An explicit light/dark preference is stored locally; System removes that override. See [UI polish](ui-polish.md) for initialization and token details.
