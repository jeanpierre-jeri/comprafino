# Search UX — Milestone 11

Search remains server-rendered and shareable. The query form submits a GET search. A small client toolbar immediately navigates with App Router `router.push(..., {scroll:false})` when a select changes. There is no Apply button, browser-side results cache, state-management dependency or persistent preference. Native labelled selects support keyboards; navigation disables the fieldset while pending and announces “Actualizando resultados…” using an output/status element. Back/forward restores controls from server URL props.

| Parameter   | Default (omitted) | Supported values               |
| ----------- | ----------------- | ------------------------------ |
| `q`         | empty             | existing validated query       |
| `sort`      | `relevance`       | `total-price`, `unit-price`    |
| `retailer`  | all               | `tottus`, `plaza-vea`, `metro` |
| `unit`      | all bases         | `kg`, `L`, `unit`, `roll`      |
| `priceMode` | `standard`        | `benefits`                     |

Invalid, duplicate/repeated or unsupported filter values fall back independently to defaults. Query text is encoded. Example: `/search?q=huevos&sort=unit-price&unit=unit&retailer=metro&priceMode=benefits`. Exact detail supports `priceMode=benefits` too; comparison links preserve that preference.

## Filters, sorting and eligibility

“Relevancia”, “Menor precio total” and “Mejor precio por unidad” retain existing family admission and SQL relevance. Generic candidates are filtered **before** the thirty-card limit, then sorted. Package totals remain separate from direct KG quotes. Unit sorting compares exact rational prices only inside compatible kg/litre/physical-item/approximate-roll blocks; absent unit prices remain a labelled last block. Approximate roll prices remain orientative, never interchangeable with eggs/items.

The optional basis select appears only when multiple comparable bases exist, or a basis is already selected so it can be cleared. One strong basis needs no extra select. Basis choices come from all admitted candidates for the selected retailer, before card limits and selected-basis filtering. No kg/L/count conversion is guessed. No brand facet is added: existing query text already preserves brand/variant tokens, and the small catalog does not justify another control.

Retailer selection filters independent offers and retains exact cards containing that retailer. Exact cards remain whole-product comparison entry points across supermarkets, with relevance ordering and full-comparison minimum; generic results provide the filtered price ranking. Unit filtering admits exact cards only when eligible member listings have that comparison basis; withheld tuna and approximate rolls cannot become physical quantity winners. Exact product identity and detail associations remain unchanged.

Default prices rank ordinary quotes. “Incluir beneficios” uses lower fresh CMR potential prices with adjacent required-card text; it does not assert user eligibility. Generic cards keep ordinary totals visible even when benefit unit prices determine sorting. See [conditional pricing](conditional-pricing.md).

Discovery uses the successful **unfiltered** useful-query count. A retailer/unit filter returning zero existing candidates displays “No hay opciones con estos filtros” and suggests clearing filters; it creates no new missing-catalog demand. True underlying empty searches retain existing discovery handling. Public navigation never calls retailers.

## Focused layout changes

A compact toolbar sits immediately below search, including for filtered empty results. Mobile uses a two-column grid, desktop up to four columns. It does not require opening a filter modal. Search images use a compact 144px area rather than full-width square images; cards have tighter padding, a subtle border/shadow, prominent ordinary and unit prices, named retailer, adjacent conditional requirement, observation time and explicit comparison link. Detail stays stacked on mobile and uses horizontal retailer rows on wider screens.

No unrelated page redesign, history chart, faceted count, expensive aggregation or personal-preference persistence is included. Manual browser confirmation at desktop and 390px for huevos/arroz/aceite and a fresh Tottus CMR exact product remains required after a successful local default build. The sandbox production build restriction prevents claiming a completed visual audit.
