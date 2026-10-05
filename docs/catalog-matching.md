# Catalog matching

Current domain guidance. Dated audits, measurements and acceptance narratives are preserved in [engineering history](history/engineering-notes-2026-10-05.md).

## Refresh and normalization

Refresh accepted source metadata, normalize the complete retained scope, then match current evidence. Source brands are preserved, exact content remains separate from KG pricing, and unknown/approximate packages stay conservative. Neither normalization nor matching modifies ordinary price history. Prior bounded sample counts are historical evidence.

## Candidate generation and similarity

Read an active, stable retailer/external-ID ordered sample of persisted normalized listings. Refuse stale input fingerprints, wrong normalization versions or derived values that differ from current normalization. `--limit` is a global bound; default 100, maximum 5000. A limit cutting an existing canonical group refuses persistence; rerun with a complete scope.

Core builds exact brand-key blocks and emits different-retailer pairs only. Missing-brand listings use a small observed product-family block (`leche`, `yogurt`, `queso`, `mantequilla`, `huevos`, `mezcla`, `kefir`); unknown family plus absent brand generates no candidates. Known different brands are never fuzzy matched. Equal brand is candidate evidence, not a final decision. Missing quantity/count does not block candidate generation. Keeping conflicting quantities/counts in these bounded blocks allows rejection audits.

The real sample produces 744 candidates, versus 7600 possible cross-retailer pairs. No global Cartesian comparison is performed. Brand blocks can still become large; this bounded baseline is not a full-catalog scaling claim. Stronger dimension/category sub-blocks require future measured coverage.

Structured incompatibilities are checked first. PostgreSQL `public.similarity()` computes `pg_trgm` similarity in one parameterized JSON batch; rejected candidates retain similarity only for audit and never receive a positive decision from it. Migration `0002_complete_malice.sql` enables `pg_trgm` in public. No trigram text index is added: the query scores generated pairs, not a similarity scan of stored titles. The composite listing index added in the same migration supports the retailer/listing foreign key, not speculative search.

Comparison titles remove exact brand, supported measurements and explicit package-count/container syntax; lowercase and accent folding are deterministic. Word order and duplicate words do not change the identity token set. Unknown identity words, model/stage numbers, `light`, whole/skim terms, flavors, sugar-free terms, processing instructions and product-family words survive. Only observed `sin lactosa`, `deslactosada`, `zero lacto` aliases share a token; `descremada`/`descremado` share their grammatical stem. No milk-formulation or yogurt-style synonym ontology is inferred. Explicit pack syntax (`pack x6`) is removed; arbitrary standalone numbers remain. Known explicit bag/carton/can/bottle differences are separately incompatible even though container syntax is absent from similarity text.

## Compatibility, score and decisions

Hard conflicts win, returning score zero and explicit reasons:

- Same retailer or two known different brand keys.
- Different pricing basis or quantity dimension (g/ml/unit).
- Different exact base per-item quantities: no approximate tolerance.
- Different known package counts or total quantities/dimensions.
- Different explicit containers when both titles identify one bag/carton/can/bottle.
- Contradictory observed whole/light/skim, flavor or salted/unsalted descriptors.

Missing values are missing evidence, not hard conflicts. An absent variant modifier never proves equivalence. Asymmetric and unrecognized variant terms remain different identity tokens and prevent automatic matching. Variable-weight listings and any normalization diagnostics cannot auto-match. Fixed-package versus KG quotes are incompatible. Ambiguous weighted or packaged cases can remain review/no-match depending on available evidence.

| Evidence                               |      Contribution | Rationale                                                    |
| -------------------------------------- | ----------------: | ------------------------------------------------------------ |
| Same known brand                       |              0.20 | Necessary supplier evidence; no fuzzy brands                 |
| Same known per-item quantity/dimension |              0.20 | Fixed content supports comparability                         |
| Same known package count               |              0.15 | Singles/multipacks are different offerings                   |
| Same known total content               |              0.05 | Correlated arithmetic cross-check, deliberately lower weight |
| Trigram title similarity               | 0.40 × similarity | Largest differentiating signal after structured conflicts    |

Missing evidence contributes zero with a `missing_*` reason. Scores round to four decimals and are **evidence scores, not calibrated probabilities**. The persisted `confidence` column stores this evidence score.

`auto_match` requires score ≥ 0.90 **and** complete brand/quantity/count/total evidence, no weight/diagnostic uncertainty, and identical nonempty identity token sets. `review` requires score ≥ 0.65 after no hard conflict; otherwise `no_match`. Hard conflicts always produce `incompatible`. Review is never persisted as a canonical link. Reasons record every evidence contribution, missing field, similarity and safety-gate failure.

The weights and conservative gates were chosen by examining the labelled calibration pairs' structured and variant failures, not coefficient fitting. All accepted calibration pairs score 1; several uncertain pairs exceed 0.90 and still require review because their identity terms differ. Thus calibration supports the safety gate, **not a statistically established 0.90 numeric boundary**. The 0.65 review boundary retains broad plausible cases without routing zero-title-overlap, complete-attribute pairs (score 0.60) into review. Both boundaries are provisional, documented engineering choices. Do not lower gates to improve recall on this fixture.

## Canonical schema and recomputation

`canonical_products`: deterministic UUID, display name, brand key, exact quantity/unit, package count, total quantity, creation time. Only confirmed groups with at least two retailers are persisted; unmatched single listings remain raw/normalized listings rather than speculative canonical products. The shortest member title wins display naming, with listing-ID tie-break; it is not generated prose.

`canonical_product_listings`: listing primary key, canonical foreign key, retailer, evidence confidence, matching version, automatic/manual method, reasons, link time. Listing primary key means one active association per listing. Unique `(canonical_product_id, retailer_id)` means at most one listing per retailer. The composite FK `(listing_id, retailer_id)` verifies that the claimed retailer actually owns the listing. SQL also checks confidence/version/method and canonical positive, dimension-consistent quantities/totals.

Groups use complete-link clustering: every pair must auto-match and retailers must remain unique. A–B and B–C do not automatically establish A–C. Ties sort deterministically by score and listing IDs. Duplicate alternatives within one retailer stay unlinked rather than weakening uniqueness. No legitimate within-retailer duplicate equivalence was established in this bounded audit.

Canonical IDs are SHA-256-derived, correctly formatted UUID version 8 values from sorted member listing IDs. Equal membership preserves identity across versions/reruns; changed membership creates a new derived group. Future stable manually curated identities are not promised by this algorithm. Initial reporting validation exposed a nonstandard UUID layout after persistence; the layout was corrected, rebuilt, and covered by a regression test before staging.

Matching version 1 is stored per association. Future behavioral changes increment it. Re-run fresh normalization first, then matching over a complete scope. Obsolete automatic links are removed, changed canonical display/content fields updated, new links inserted and former sampled orphan groups removed. Raw listings, normalizations and price history are preserved. Manual links prevent automatic writes to the entire selected batch; no review/edit UI exists yet.

One atomic Neon HTTP batch locks all retailer identities in stable order, following ingestion/normalization's lock convention. Under READ COMMITTED, subsequent statements see the current state. Raw and normalized snapshots must still equal the evaluated inputs; every mutation repeats this guard and refuses split/manual groups. Concurrent equal runs serialize, deterministic IDs/constraints prevent duplicates, and unchanged values cause zero writes. All future canonical/manual writers must follow the lock convention. No Redis or distributed locks.

## Commands, inspection and validation

```sh
pnpm db:migrate
pnpm match:catalog -- --dry-run --limit=100
pnpm match:catalog -- --limit=100
# Entire current bounded sample:
pnpm match:catalog -- --limit=500
pnpm match:evaluate
```

Both commands use root `.env`/`DATABASE_URL` and public pg_trgm; no retailer fetch occurs. Unknown/duplicate options or invalid bounds fail before connection. Retailer filters are not supported for cross-retailer matching. Dry-run writes no associations. Persisted stale/split/manual scopes return a clear error without mutation. Database errors never print credentials.

Development-only `/dev/matching` is a read-only Server Component. It shows saved canonical products/retailer links, raw/normalized titles, attributes, confidence/version/reasons and the 20 highest-score recomputed reviews. Inspection is bounded to 150 listings and 150 saved links, with the bound explicit on the page. Production returns 404 before any database access. No public search or editing controls were created.

Unit coverage adds candidate blocks, exact brand/dimension/quantity/count/total constraints, containers/variants, missing/weighted/diagnostic evidence, thresholds/reasons, identity preservation, 49 reviewed nonpositive cases, complete-link grouping and UUID format/determinism. PostgreSQL coverage adds pg_trgm real-fixture evaluation, canonical/link creation, concurrent idempotency, primary/retailer/FK/content constraints, stale and split scopes, manual protection, obsolete-link recomputation and transaction rollback. Production smoke coverage adds `/dev/matching` 404.

Integration tests require explicit `TEST_DATABASE_URL`, never implicitly load `.env`, and write only inside a random isolated schema. Apply pg_trgm once to the target test database with the reviewed migration: tests skip `CREATE EXTENSION` so they do not mutate shared public extension objects. Only `public.similarity()` is qualified; tables retain the isolated search path. This milestone's suite uses an explicitly injected one-off test URL, preserving that environment policy.

PostgreSQL pg_trgm supplies deterministic similarity. Remaining limitations include bounded source coverage, imperfect descriptions, correlated manual labels, unproven manufacturer identity, limited recall and no manual review application.

## Exact identity revalidation (Cleanup A)

Public exact identity requires current automatic matching evidence. Previously ingestion could change raw identity while the old link remained eligible, including after normalization and before matching.

An accepted newer ingestion observation atomically sets an existing automatic link's confidence to zero when title, quote unit, package text, source brand or source unit multiplier changes. The fields are exactly those in the normalization fingerprint. A changed persisted normalization also sets automatic confidence to zero, including normalization-version or derived-value corrections; unchanged normalization reruns leave confidence intact. These writes use the existing retailer locks and batch transactions. Price, URL, image, category and availability changes alone do not revoke identity, and replayed observations cannot revoke it.

Zero confidence means the old evidence is no longer valid for the current identity. Links, reasons, canonical records and ordinary history remain stored. The existing public method/version/confidence guard withholds the entire exact group until matching revalidates its complete scope. Normalization alone cannot reauthorize the claim. Matching's existing snapshot checks, complete-link policy and deletion/recreation of changed automatic links restore eligibility only when current evidence qualifies. An incompatible identity may leave the old group unavailable.

Manual links and decisions are preserved by both invalidation writers and matching's existing manual-scope guard. Manual groups remain excluded from automatic public exact comparison under the existing policy. Independent generic/listing history remains available once its own normalization, trusted URL and ordinary-price boundaries pass; failed normalization may temporarily withhold independent metadata too.

Deployment must roll out these writers together, then normalize and match the complete existing automatic catalog to revalidate associations created before this invariant. Out-of-band SQL edits and old writer deployments do not enforce the invariant; future identity writers must apply the same invalidation under retailer locks. No migration or historical-data rewrite is required.
