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

## Milestone 12 visual refinement

The URL/state behavior above is unchanged. The shared public surfaces now group search, exact comparisons and independent shopping options. The toolbar uses 44px native controls in two columns from 380px (one below that), three/four on desktop according to available bases; an odd final control spans the mobile row. Product cards use a compact image beside the complete title on mobile and a taller framed image above it on desktop. Ordinary prices remain primary even in benefits mode; calculated conditional unit prices keep “con CMR”, and CMR totals/requirements have a separate warm surface. Exact cards show the existing best conditional offer separately from the ordinary minimum. Detail has a distinct product hero and retailer rows. Empty states provide a same-query filter reset or starter search. See [UI polish](ui-polish.md) for the manual audit, visual system and validation.

No history chart, new facet, aggregation, preference persistence, client caching or filter modal is included.
