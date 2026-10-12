# Search UX — Milestone 11

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

Retailer selection filters independent offers and retains exact cards containing that retailer. Exact cards remain whole-product comparison entry points across supermarkets, with relevance ordering and full-comparison minimum; generic results provide the filtered price ranking. Unit filtering admits exact cards only when eligible member listings have that comparison basis; withheld tuna and approximate rolls cannot become physical quantity winners. Exact product identity and detail associations remain unchanged.

Default prices rank ordinary quotes. “Incluir beneficios” uses lower fresh CMR potential prices with adjacent required-card text; it does not assert user eligibility. Generic cards keep ordinary totals visible even when benefit unit prices determine sorting. See [conditional pricing](conditional-pricing.md).

Discovery uses the successful **unfiltered** useful-query count. A retailer/unit filter returning zero existing candidates displays “No hay opciones con estos filtros” and suggests clearing filters; it creates no new missing-catalog demand. True underlying empty searches retain existing discovery handling. Public navigation never calls retailers.

## Explicit comparison scope

The toolbar says that sorting applies to “Opciones en supermercados” and explains the retailer filter's two scopes. The exact section states that comparisons retain relevance ordering and that “Desde” considers current offers across all stores in the group. Exact cards link to records in the counted stores; cards and detail separately show the number of current ordinary offers (positive, observed within 36 hours, not future, availability not false). Unknown stock remains allowed and disclosed; a current offer count is not a confirmed-stock count. Stale/unavailable exact records remain visible and cannot win. Detail labels their amounts “Último precio registrado para todos”.

Validated strong egg counts use “/ huevo” for ordinary and CMR unit prices on independent cards/listing detail and CMR references in exact comparisons. Fractions, rounding, sorting and identity are unchanged. Independent cards and listing detail explain absent unit prices using existing calculation reasons. Direct KG quotes retain their source “/ kg” label.

Controlled `apps/web/e2e/search-experience.spec.ts` cases run with `pnpm test:e2e:fixtures:local` after a production build, in the existing owned random schema. Fixtures exercise 15/30 eggs, differing variants, unknown stock, ordinary ties, CMR, missing/ambiguous quantities, stale/unavailable exclusions and exact comparisons retaining all stores under a retailer filter. DB tests cover one/zero current offers separately from retained store counts. No application catalog, retailer requests, schema changes or additional infrastructure are required.

## Milestone 12 visual refinement

The URL/state behavior above is unchanged. The heading is borderless, with compact sage controls, a distinct exact-comparison surface and independent shopping options on the warm page background. The toolbar uses 44px custom controls in two columns from 380px (one below that), three/four on desktop according to available bases; an odd final control spans the mobile row. Product cards use compact images beside complete titles on desktop and mobile, larger ordinary prices, stronger unit prices and small retailer labels. Result dates use relative “Observado hace …” wording with exact ISO/tooltip timestamps; detail keeps full Peru dates. Generic title links extend across the card and now open `/listings/[id]`, with external source links kept separate. Ordinary prices remain primary even in benefits mode; calculated conditional unit prices keep “con CMR”, and CMR totals/requirements have a separate warm surface. Exact cards show the existing best conditional offer separately from the ordinary minimum. Detail groups ordinary minima and lower conditional benefits in its product hero, with distinct compact retailer rows. Empty states provide a same-query filter reset or starter search. See [UI polish](ui-polish.md) for the manual audit, visual system and validation.

No history chart, aggregation, filter preference persistence, client caching or filter modal is included.

## Category navigation

The homepage now links to five CompraFino categories instead of product examples. `/search?category=lacteos-huevos` browses without query text; `/search?q=gloria&category=lacteos-huevos` searches within that category. Nonempty text keeps the existing 2–120 character validation. The category selector includes “Todas las categorías”; invalid/repeated category values fall back to that option. Filter changes reset pagination, browser back/forward restores URL state, and submitting search preserves the current category, retailer, sort, unit and price mode.

`packages/core/src/search-categories.ts` defines the public category IDs, labels and explicit source-department mapping. Membership comes from active acquired `catalog_sources` paths through `catalog_source_listings`, using their first department name. A product in multiple acquired paths appears once. Missing or unrecognized category evidence is not guessed from titles: those listings remain available in general search. This initial navigation covers pantry/breakfast, dairy/eggs, nonalcoholic drinks, cleaning and personal care; other departments remain outside these five categories.

Both independent candidates and exact groups are category-filtered in SQL before pagination. An exact group qualifies when a retained eligible member belongs to the category; its comparison still shows all retained stores. Category membership does not change exact identity, family classification, substitution policy or price eligibility. Category-only browsing never records missing-product discovery or creates a shopping-list item from a department name. A category filter on a textual search preserves unfiltered discovery counts; an empty filtered result is not new missing-product demand. Refresh requests remain bounded to the category search candidates, and public requests make no retailer calls.

No migration, dependency, ingestion change or separate endpoint is required. Availability of category results depends on acquired membership already stored in the catalog. Pure URL/request tests, owned-schema SQL tests and controlled Chromium category navigation/pagination tests exercise this behavior.

Public appearance supports System/Light/Dark independently of filter URLs. An explicit light/dark preference is stored locally; System removes that override. See [UI polish](ui-polish.md) for initialization and token details.

## Compact exact comparisons

“Compara el mismo producto” initially shows up to three cards in the existing result order. A centered downward arrow reveals additional results and then disappears. It has a 44px touch target and an accessible name including the remaining count, without visible text or border. Expansion stays open until search/filter navigation; focus moves to the first revealed product link when the control disappears. Up to three results need no disclosure control. The total result count, query/filter URLs, matching, prices and generic retailer options remain unchanged.

Cards and both grids remain Server Components. A small client disclosure uses the shared Base UI Collapsible, local open state and the existing measured-height/opacity transition (220/180 ms). Reduced-motion preference removes the panel transition. Collapsed contents are hidden from focus and accessibility navigation; keyboard Enter/Space and expanded state follow the native button/Collapsible behavior. There are no animation dependencies, extra queries, client result cache or timers. Search/filter navigation resets expansion through the existing keyed server result boundary.
