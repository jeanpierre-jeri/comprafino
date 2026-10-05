# Conservative substitution compatibility

This domain layer in `packages/core/src/substitution-compatibility.ts` determines whether a saved need may automatically use a product. It is independent of React, PostgreSQL and search relevance. Broad discovery remains useful even when a candidate is excluded from substitution. Uncertainty means exclusion, never loose keyword fallback.

## API and evidence

- `getSubstitutionProfile({ title, family? })` returns a conservative family/form key or null, reusing existing normalized family/source-category evidence where supplied. A supplied negative family classification stays negative. Variant interpretation is centralized here.
- `areSafeSubstitutes(a, b)` requires equal non-null profiles. This is semantic compatibility, not a price, freshness or quantity-quality guarantee.
- `inferGenericSubstitutionProfile(query, unit)` infers supported need semantics. A broad oil need means vegetable/soy oil; a broad detergent need chooses powder for kg or liquid for L. Unsupported contexts produce null.
- `isListingCompatibleWithGenericNeed(need, listing)` requires a persisted non-null profile consistent with the query's current conservative policy and the listing. Unknown or inconsistent saved profiles withhold automatic fulfillment.

The database boundary supplies existing source-family evidence and quantity quality. Shopping evaluation separately requires matching normalized measure, strong contained-quantity evidence for generic/alternative fulfillment, fresh offers and bounded overbuy. Exact canonical purchase counts do not require guessing contained size. Preferred package-count alternatives require trusted exact-product contents as the reference amount.

## Initial family policy

| Family      | Compatible ordinary group                                                                                                       | Excluded or separated                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Eggs        | Standard chicken eggs; ordinary white, brown/pardo and pink/rosado eggs are treated as compatible across brands and tray counts | Quail/codorniz/codornices, other named species, organic/ecological, corral/free-range/campero, enriched/omega and premium eggs; chocolate/Easter products                                          |
| Rice        | Common white rice; extra/superior/añejo marketing grades may share the ordinary group                                           | Integral, basmati, jasmine, arborio/risotto, wild/sushi/glutinous/aromatic, precooked/parboiled, red/black, premium or mixed specialty rice                                                        |
| Cooking oil | Ordinary vegetable/soy oils together; sunflower is its own separate group                                                       | Olive, oleic, coconut, avocado, sesame, sacha inchi and premium variants; unspecified oils without clear family/form evidence                                                                      |
| Detergent   | Ordinary powder together; ordinary liquid together; matic/machine forms are separate groups within each                         | Powder vs liquid; pods/capsules/tablets withheld; baby/children, micellar, antibacterial, hypoallergenic, softener and specialty color forms excluded; conflicting powder/liquid evidence withheld |
| Milk        | No generic substitution group                                                                                                   | Fat, lactose, fortified/reconstituted/evaporated and container-content semantics need reviewed evidence; exact preferred/strict purchases remain possible                                          |

The initial model is a small family/form key plus conservative exclusion tokens, not a universal taxonomy. Unsupported families and specialties are not automatically interchanged, even with each other. Users can save them as exact products. Profiles do not promise identical nutrition or quality. Aromas in ordinary detergent may differ and complete product titles remain visible. Some marketing color names conservatively lose coverage.

## Search regression and audit

PostgreSQL tests seed an exceptionally cheap quail listing that remains relevant to broad huevos search but cannot win generic or preferred recommendations. Strict items always retain canonical isolation. Unit tests cover ordinary chicken eggs, quail singular/plural, organic/free-range/premium, white vs basmati/integral rice, vegetable/soy vs sunflower/olive oils, powder/liquid/pods/matic detergent and withheld generic milk.

The [current audit](history/shopping-list-audit.json) enumerates broad candidates and exclusions for huevos, arroz, aceite, detergente and leche. Its compatibility counts require strong matching quantity evidence but precede the purchase's overbuy/ranking rules. Live Bell's quail 18/24 trays and La Calera quail 18 eggs remain searchable and fail the safety gate.

## Saving from retailer-option cards

`shoppingSeedForRetailerOffer` maps existing public offer evidence to a creation seed. Only the existing safe public canonical association permits preferred/strict identity. An independent offer creates a generic need: supported family/form descriptors are retained, with strong contained quantities normalized to units/kg/L; unsupported evidence retains the original description and explicitly withholds substitutions. Null profiles are not upgraded by title inference on save/edit, and withheld needs have distinct duplicate keys from supported family needs. There is no listing UUID promoted to a canonical UUID, new persisted intent, storage-version change or matching-threshold change.

## Limitations and Milestone 16

Catalog evidence and normalized titles can omit attributes, and conservative exclusions can produce false negatives. New varieties need reviewed rules and meaningful tests; do not silently expand a profile to improve candidate counts. Stored generic profiles are checked against current policy, so a changed or unsupported key fails closed until explicitly saved under supported semantics.

Milestone 16 [current basket optimization](basket-optimization.md) reuses these APIs through `evaluateShoppingFulfillment`, alongside the existing quantity, pricing and freshness safeguards. The optimizer receives only approved options. Global preferred savings gates run before retailer subsets. Mixed packages within a need, delivery/travel cost and purchase timing remain outside scope.
