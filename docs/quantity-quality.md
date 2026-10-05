# Quantity and source quality

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

## Semantic decisions

Use the smallest comparison concept: `UnitPrice.basis` (`mass`, `volume`, `item-count`, `roll`) and `quality` (`strong`, `approximate`). No giant quantity ontology or unsupported sheet/length denominator is introduced. These are recomputed **comparison attributes**, separate from persisted exact-match normalization.

- **Tuna policy C:** withhold all current tuna unit prices, including count-only can packs. Plaza Vea establishes net weight for two cans, but the other sources do not establish a consistent cross-retailer net/drained role. Neither automatic drained-content selection nor a global net-weight assumption is justified. Titles mentioning drained weight are withheld too. Both net/drained values may remain in raw display text; neither becomes a comparable denominator. Existing normalized declared quantity remains available for package display.
- **Paper policy C:** reliable normalized contained counts mean rolls within this family. Display `S/ … / rollo · orientativo`; keep the roll-size warning. Both 20m and 65m rolls can have approximate shopping signals, but the UI does not claim equal physical content or a best-value winner. No sheet count is inferred from “doble/triple hoja,” Jumbo or XL; no sheet/length price is calculated.
- **Detergent:** powder uses S/kg, liquid/refill uses S/L; never convert by assumed density, doses, washes or marketing claims. Existing reliable multipliers produce package totals. Reliable pod/capsule count can use S/unit; other detergent count-only offerings are withheld. Unknown Twopack and mixed detergent/softener bundles remain withheld. No overall cross-dimension detergent winner.
- **Controls:** egg counts, exact rice/sugar mass and oil volume retain existing arithmetic. Direct source KG quotes remain physical prices regardless of estimated package mass.

Unavailable reasons distinguish missing quantity, ambiguous quantity, ambiguous semantics, conflicting mass/volume dimensions, invalid quantity/price and stale/unavailable offers. Existing freshness gates apply before comparison eligibility. “Strong” means a usable denominator, not identical brand, effectiveness, egg size or quality.

## Sorting and UI

Use exact bigint rational cross-products within compatible basis and quality. The comparator rejects incompatible dimension, basis or quality. Sort blocks are kg → L → item-count → approximate rolls → unavailable. The thirty-card quota reserves room for each present basis, including unknowns; roll prices cannot consume an egg-count block. The UI groups these same bases and labels the roll block as orientative. Relevance/package sorting and exact canonical comparison remain unchanged. Two decimal places are display rounding only.
