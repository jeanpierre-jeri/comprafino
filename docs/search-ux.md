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

“Relevancia”, “Menor precio total” and “Menor por unidad” retain existing family admission and SQL relevance. Current offer candidates are filtered, grouped by admitted canonical identity, sorted and then limited to thirty product cards. Unconfirmed SKUs stay separate. Counts explicitly distinguish products from store offers. Package totals remain separate from direct KG quotes. Unit sorting compares exact rational prices only inside compatible kg/litre/physical-item/approximate-roll blocks; absent unit prices remain a labelled last block. Approximate roll prices remain orientative, never interchangeable with eggs/items.

The optional basis select appears only when multiple comparable bases exist, or a basis is already selected so it can be cleared. One strong basis needs no extra select. Basis choices come from all admitted candidates for the selected retailer, before card limits and selected-basis filtering. No kg/L/count conversion is guessed. No brand facet is added: existing query text already preserves brand/variant tokens, and the small catalog does not justify another control.

Retailer and unit selection filter the single product list. Only current eligible offers contribute. Confirmed equivalents share a card with name, presentation, ordinary “Desde” price, valid unit price, filtered supermarket count and “Comparar precios”. Its title and comparison action open the shared comparison; unconfirmed SKUs open their independent listing detail and retain source links. Both support adding to a shopping list. Exact product identity and detail associations remain unchanged.

Unconfirmed cards label their internal action “Ver producto”; they do not promise a comparison between equivalent products. If a requested page is empty while the filtered product count is positive, the page explains that pagination is out of range and offers “Volver a la primera página”, retaining query, category, sort, retailer, unit and price mode. This differs from genuinely empty searches or filters and does not change grouping or discovery.

Default prices rank ordinary quotes. “Incluir beneficios” uses lower fresh CMR potential prices with adjacent required-card text; it does not assert user eligibility. Generic cards keep ordinary totals visible even when benefit unit prices determine sorting. See [conditional pricing](conditional-pricing.md).

Discovery uses the successful **unfiltered** useful-query count. A retailer/unit filter returning zero existing candidates displays “No hay opciones con estos filtros” and suggests clearing filters; it creates no new missing-catalog demand. True underlying empty searches retain existing discovery handling. Public navigation never calls retailers.

## Explicit comparison scope

Search shows a single “Productos” grid. It has no separate exact-comparison section or disclosure arrow. Sorting applies to grouped products, and category/retailer/unit filters and pagination describe that same visible list. Empty filters cannot leave a second comparison section behind. Comparison links on eligible product cards open `/products/[id]`, where all retained stores, current offer counts, unknown stock and stale/unavailable records remain disclosed.

Validated strong egg counts use “/ huevo” for ordinary and CMR unit prices on independent cards/listing detail and CMR references in exact comparisons. Fractions, rounding, sorting and identity are unchanged. Independent cards and listing detail explain absent unit prices using existing calculation reasons. Direct KG quotes retain their source “/ kg” label.

Controlled `apps/web/e2e/search-experience.spec.ts` cases run with `pnpm test:e2e:fixtures:local` after a production build, in the existing owned random schema. Fixtures exercise 15/30 eggs, differing variants, unknown stock, ordinary ties, CMR, missing/ambiguous quantities, stale/unavailable exclusions and product-card links opening comparisons with all retained stores after a retailer filter. DB tests cover one/zero current offers separately from retained store counts. No application catalog, retailer requests, schema changes or additional infrastructure are required.

## Compact search layout

Search uses a compact header and labelled search input, followed by the total result count and the existing sort control. At widths below 1024px, secondary category, retailer, optional unit and price-mode controls sit in an accessible “Filtros” disclosure, closed initially. Enter/Space toggles it; controls remain keyboard accessible when expanded. Desktop displays those controls directly. Opening the disclosure is local interaction state; filter values always come from the validated URL.

Active category, retailer, unit and benefits filters have individually removable labels and an active count. “Limpiar filtros” removes those four filters while retaining query and sort. Changing or removing filters resets pagination. Search submission retains the current filters. Back/forward and reload restore URL values; no saved browser preference or results cache is added. Filter navigation retains the mounted toolbar so keyboard focus and the open disclosure survive an update. Pending search/filter navigation announces progress; the initial Suspense skeleton uses the compact layout. Empty results retain search, count, sorting and filter removal controls.

Removing an active filter or clearing all filters returns keyboard focus to the visible “Ordenar” control when disabling/removing the initiating button would otherwise leave focus on the document body. Select changes retain their initiating select. Focus is not moved if the user has already moved to another element.

The generic shopping-need action follows results so it does not push the first product below the initial mobile viewport. Price, promotion, availability, identity and grouped sorting rules are unchanged. Controlled Chromium regressions in `search-experience.spec.ts` check milk search and category variants at 320/390/1280×844 in both themes, including first-title/ordinary-price visibility at scroll zero, overflow, keyboard disclosure, filter removal/reset, reload and back/forward. Screenshots are written to ignored `.artifacts/search-ux/`. Build first and run `pnpm test:e2e:fixtures:local` with the explicit owned-schema harness.

## Milestone 12 visual refinement (previous layout)

The URL/state behavior above is unchanged. The heading is borderless, with compact sage controls, a single product grid on the warm page background. The toolbar uses 44px custom controls in two columns from 380px (one below that), four/five on desktop according to available bases; an odd final control spans the mobile row. Product cards use compact images beside complete titles on desktop and mobile, larger ordinary prices, stronger unit prices and small retailer labels. Result dates use relative “Observado hace …” wording with exact ISO/tooltip timestamps; detail keeps full Peru dates. Generic title links extend across the card and now open `/listings/[id]`, with external source links kept separate. Ordinary prices remain primary even in benefits mode; calculated conditional unit prices keep “con tarjeta CMR”, and CMR totals/requirements have a separate warm surface. Detail groups ordinary minima and lower conditional benefits in its product hero, with distinct compact retailer rows. Empty states provide a same-query filter reset. With no underlying results, they offer “Cambiar búsqueda” (focuses the populated search field) and “Ver categorías”, plus the existing “Agregar sin elegir producto” action. Category empty states allow removing supermarket/measure filters while retaining the category, or searching the same text across categories. They do not recommend an unrelated category or promise catalog growth. See [UI polish](ui-polish.md) for the manual audit, visual system and validation.

No history chart, filter preference persistence, client caching or filter modal is included; mobile uses an inline disclosure.

## Category navigation

The homepage links to five CompraFino categories in one browse section. Category shortcuts no longer repeat beside the search. `/search?category=lacteos-huevos` browses without query text; `/search?q=gloria&category=lacteos-huevos` searches within that category. Nonempty text keeps the existing 2–120 character validation. The category selector includes “Todas las categorías”; invalid/repeated category values fall back to that option. Filter changes reset pagination, browser back/forward restores URL state, and submitting search preserves the current category, retailer, sort, unit and price mode.

## Homepage search and comparison

The hero prioritizes a full-width mobile search field and a list shortcut; the header exposes Productos (`/search`) and Mi lista (`/list`) without a menu. A compact sample streams below the search through its own Server Component/Suspense boundary. `getHomeProductComparison` reuses the public exact-comparison projection and validation, returning one deterministic product only when at least two distinct stores have positive ordinary PEN/unit prices, observations within the existing fresh window (excluding future dates) and availability other than explicit false. Unknown stock remains unknown. Only those current offers appear, with presentation, store, observed ordinary price and compact Peru observation date/time; the exact timestamp remains in ISO datetime. The link opens the existing full comparison with all retained records. There are no hardcoded products, discounts, savings, retailer calls, new client fetches or persistent caches.

The homepage now performs one request-time catalog read within the existing public database budget. Search, navigation and list access render before that read completes. Empty, unavailable or unconfigured data renders an invitation to explore products without numerical claims. No credentials are needed to render the homepage or build it.

The owned-schema `home-comparison.integration.test.ts` covers empty/current, positive-price, tri-state stock, fresh/stale/future and revoked/manual/obsolete identity boundaries. Build first, then run `pnpm test:e2e:fixtures:local home.spec.ts navigation.spec.ts theme.spec.ts` for Chromium layout/navigation and sample → full comparison consistency. `DATABASE_URL= pnpm --filter @comprafino/web test:e2e home.spec.ts` verifies the unconfigured fallback separately. Screenshots are saved in ignored Playwright test results. Browser emulation checks layout and navigation, not human comprehension or physical-device keyboards.

## Category membership

`packages/core/src/search-categories.ts` defines the public category IDs, labels and explicit source-department mapping. Membership comes from active acquired `catalog_sources` paths through `catalog_source_listings`, using their first department name. A product in multiple acquired paths appears once. Missing or unrecognized category evidence is not guessed from titles: those listings remain available in general search. This initial navigation covers pantry/breakfast, dairy/eggs, nonalcoholic drinks, cleaning and personal care; other departments remain outside these five categories.

Public product candidates are category-filtered in SQL before pagination. The internal exact-group search helper retains its category filtering for database consumers; the public route uses the single-read `searchGroupedPublicProducts`, avoiding unused exact-group reads and extra pages caused by hidden groups. Comparison destinations still show all retained stores. Category membership does not change exact identity, family classification, substitution policy or price eligibility. Category-only browsing never records missing-product discovery or creates a shopping-list item from a department name. A category filter on a textual search preserves unfiltered discovery counts; an empty filtered result is not new missing-product demand. Refresh requests remain bounded to the category search candidates, and public requests make no retailer calls.

No migration, dependency, ingestion change or separate endpoint is required. Availability of category results depends on acquired membership already stored in the catalog. Pure URL/request tests, owned-schema SQL tests and controlled Chromium category navigation/pagination tests exercise this behavior.

Category membership is applied to the raw `retailer_listings.id` UUID inside the current-offer query, before JSON projection. Filtering the projected JSON identity instead hides column statistics and can produce a nested-loop plan that recomputes the complete exact-product aggregate for each admitted listing. The owned-schema regression seeds 1,200 current category listings plus exact groups, collects statistics and executes the real query with `EXPLAIN ANALYZE`; it checks that exact groups are aggregated at most once, without a timing threshold tied to the test machine.

The public search route sets a 12-second HTTP deadline per database request. Each executed request gets a fresh abort signal, including later refresh-demand batches on the same client. Failed/timed-out reads use the existing public error state instead of leaving the loading skeleton waiting indefinitely. Auth, ingestion and other database callers retain their existing transport defaults; this deadline does not retry requests or guarantee that PostgreSQL cancels server-side work immediately on an HTTP disconnect.

Public appearance supports System/Light/Dark independently of filter URLs. An explicit light/dark preference is stored locally; System removes that override. See [UI polish](ui-polish.md) for initialization and token details.

## Returning from details

Listing and comparison links retain query, filters, page and vertical position in a validated local search return URL. Both detail routes show “Volver a resultados” when this context exists, and “Buscar otro producto” otherwise. Changing history range or comparison price mode keeps the return context. Price, comparison, list and external-store actions precede history; external links visibly announce a new tab. Isolated listing Chromium tests cover direct entry, unsafe destinations, comparison/no comparison, unknown stock, pagination, reload, mobile/desktop layout and scroll restoration.

`apps/web/e2e/ux-review.spec.ts` adds regressions for unconfirmed destinations, out-of-range pages and keyboard filter removal. Its full home → search → filter → comparison → add → list edit → browser back → results journey checks light/dark at 390/1280px and validates the persisted canonical identity, strict intent and package quantity after reload. Run it through `pnpm test:e2e:fixtures:local` after building, so discovery, account and catalog writes remain inside the harness's owned random schema.

## Buyer-facing wording

“Sin tarjeta ni membresía” labels ordinary prices consistently across search, product details, history and shopping lists. Conditional CMR prices explicitly name the card and retain their source condition text. Reference prices are labeled as reference prices, without implying a proven previous purchase price. Shopping history compares the last consulted price, without claiming a quote is from today. Sign-in describes the attempt to combine browser/account lists, the most recently edited duplicate and pending account writes rather than guaranteeing successful synchronization. Calculations, eligibility, discovery and persistence are unchanged.
