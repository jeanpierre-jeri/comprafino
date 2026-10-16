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

`canonical_products`: durable UUID, identity evidence key, display name, brand key, exact quantity/unit, package count, total quantity, creation time. Only confirmed groups with at least two retailers are persisted; unmatched single listings remain raw/normalized listings rather than speculative canonical products. The shortest member title wins display naming, with listing-ID tie-break; it is not generated prose. `identity_key` is nullable for groups created before migration `0014_canonical_identity.sql`.

`canonical_product_listings`: listing primary key, canonical foreign key, retailer, evidence confidence, matching version, automatic/manual method, reasons, link time. Listing primary key means one active association per listing. Unique `(canonical_product_id, retailer_id)` means at most one listing per retailer. The composite FK `(listing_id, retailer_id)` verifies that the claimed retailer actually owns the listing. SQL also checks confidence/version/method and canonical positive, dimension-consistent quantities/totals.

Groups use complete-link clustering: every pair must auto-match and retailers must remain unique. A–B and B–C do not automatically establish A–C. Ties sort deterministically by score and listing IDs. Duplicate alternatives within one retailer stay unlinked rather than weakening uniqueness. No legitimate within-retailer duplicate equivalence was established in this bounded audit.

### Saved-product continuity

Saved strict/preferred lists and `/products/[id]` use the canonical UUID. It must survive an unequivocal retailer expansion. Membership alone previously determined that UUID, so adding a third retailer broke references saved with two. Matching now separates durable identity evidence from changing membership; no list rewrite or redirect is required.

Core's versioned `canonicalIdentityKey` records exact brand, quantity/dimension, package count, total content, pricing basis, the complete sorted identity token set and explicit container evidence. It excludes retailer IDs, membership order and display word order. It does **not** authorize a match: the existing scoring, hard conflicts, complete-link checks and retailer uniqueness must pass first. New/changed container evidence can conservatively prevent continuity even when current matching accepts the group.

Under the existing retailer locks, persistence reuses a predecessor UUID only when:

1. At least two members of the new group already belong to that predecessor.
2. None of the new group's associated members belongs to another predecessor.
3. No member of that predecessor participates in another proposed group (a split).
4. Its stored identity key equals the new group's key. For a legacy null key, **every** old association must still be automatic, current-version and above the matching threshold before the key can be established.

| Change                                                                      | Result                                                                   |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Two equivalent retailers become three or four                               | Keep the UUID, saved entries and original associations.                  |
| Three become two; the removed member forms no other group                   | Keep the UUID if the two anchors and identity evidence remain valid.     |
| Display word order changes with identical identity evidence                 | Revalidate and keep the UUID; revoked links get a new temporal boundary. |
| Variant, brand, quantity, package or explicit container changes             | Use a different identity; never silently point the saved entry at it.    |
| One group splits, two predecessors merge, or fewer than two anchors remain  | Do not select a successor automatically.                                 |
| Stale raw/normalized snapshot, partial prior-group scope or manual decision | Refuse the entire batch without changes.                                 |

When continuity cannot be established, a new opaque UUID version 4 is generated for the proposed group. It is not derived from membership or title: a later split back to the original members must not accidentally resurrect a retired ID. Existing version 8 IDs are preserved when the continuity rules pass; public readers already accept both UUID formats. There is no similarity-based alias, no cross-group history transfer and no unconditional preservation of every former ID. Ordinary orphan cleanup remains limited to the selected prior groups. Existing saved entries stay intact even if their product becomes unavailable; explicit recovery is to select the intended current product, add it with the desired quantity/frequency, then remove the unavailable entry. Already deleted legacy IDs cannot be recovered from title resemblance.

Matching version 1 is stored per association; its comparison rules and thresholds are unchanged by this persistence fix. Future comparison changes increment it. The identity-key format has its own version. Re-run fresh normalization first, then matching over a complete scope. Obsolete associations are removed, retained associations updated in place, changed canonical display/content fields updated, new links inserted and former sampled orphan groups removed. Raw listings, normalizations, ordinary price history and local/cloud list documents are preserved. Manual links prevent automatic writes to the entire selected batch; no review/edit UI exists yet. Persistence reports `linksCreated`, `linksUpdated` and `linksRemoved` separately; incremental/refresh counters include all three.

Retained, still-valid associations keep `linked_at` even if supporting scores/reasons change. A revoked or obsolete association that is revalidated starts at the current transaction time; a newly added retailer gets its own current link time. In particular, existing weekday-advice evidence survives an equivalent expansion while the new retailer cannot inherit earlier daily observations. This change does not rewrite price states, merge retailer series or widen the existing historical query boundaries.

One atomic Neon HTTP batch locks all retailer identities in stable order, following ingestion/normalization's lock convention. Under READ COMMITTED, subsequent statements see the current state. Raw and normalized snapshots must still equal the evaluated inputs; every mutation repeats this guard and refuses split/manual scopes. Continuity is resolved from the locked current associations, not stale `priorGroupId` values read before evaluation. Retained anchors remain present throughout the batch so the resolution is stable between mutations. Concurrent equal runs serialize and reuse the first committed identity even though each evaluation proposed a fresh UUID; unchanged values cause zero writes. Concurrent different expansions refuse the now-incomplete scope and can retry with the complete group. All future canonical/manual writers must follow the lock convention. No Redis or distributed locks.

### Migration and rollout

Migration `0014_canonical_identity.sql` adds one nullable text column, with no default, data rewrite, ID replacement or list/history update. The generated SQL and schema snapshot are reviewable in the repository. Tests apply it only inside owned random schemas with explicit `TEST_DATABASE_URL`.

The backfill is **lazy and bounded**: when a complete group is next matched, the guarded transaction establishes a missing key only from still-valid existing associations. It uses the existing complete-scope limits (up to 5,000 listings per matching block), without a catalog-wide SQL guess or title-based rewrite. Existing read eligibility does not depend on the new column, so untouched products and lists remain readable. An already revoked legacy group has no trusted historic key and cannot receive continuity merely because its present members agree; it requires explicit product reselection if its reference changes.

For deployment, pause acquisition/matching writers, apply the reviewed additive migration, deploy all matching writer entry points together, then resume them. The application must not run the new persistence code before the column exists. Normal `derive:catalog` processing backfills groups as their inputs change; it does not revisit already-checkpointed groups solely to fill this column. For a known complete catalog/sample of at most 5,000 rows, `match:catalog -- --dry-run --limit=N` followed by the same complete scope without `--dry-run` can proactively establish keys. Never increase/truncate a scope blindly when it cuts a prior group. There is no mandatory global rewrite.

Do not resume older membership-only matching writers as a rollback: they can break saved references again. Keep writers paused while reverting or correcting the application; the additive column can remain. Applying this migration to an application/production database, deployment and catalog backfill there are separate operational actions; they are not performed by the code change or tests.

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

Unit coverage includes candidate blocks, exact brand/dimension/quantity/count/total constraints, containers/variants, missing/weighted/diagnostic evidence, thresholds/reasons, identity-key invariance, 49 reviewed nonpositive cases and complete-link grouping. PostgreSQL coverage includes pg_trgm real-fixture evaluation, canonical/link creation, concurrent idempotency, primary/retailer/FK/content constraints, stale and split scopes, manual protection, obsolete-link recomputation and transaction rollback. Continuity regressions exercise strict/preferred evaluation, unchanged persisted list documents/revisions, old product lookup, legacy keys, expansion/contraction, ambiguous split/merge, expansion followed by a split back to old membership, incompatible variants, competing scopes, positive-price/tri-state boundaries and historical link cutoffs. Production smoke coverage includes `/dev/matching` 404.

Integration tests require explicit `TEST_DATABASE_URL`, never implicitly load `.env`, and write only inside a random isolated schema. Apply pg_trgm once to the target test database with the reviewed migration: tests skip `CREATE EXTENSION` so they do not mutate shared public extension objects. Only `public.similarity()` is qualified; tables retain the isolated search path. This milestone's suite uses an explicitly injected one-off test URL, preserving that environment policy.

PostgreSQL pg_trgm supplies deterministic similarity. Remaining limitations include bounded source coverage, imperfect descriptions, correlated manual labels, unproven manufacturer identity, limited recall and no manual review application.

## Exact identity revalidation (Cleanup A)

Public exact identity requires current automatic matching evidence. Previously ingestion could change raw identity while the old link remained eligible, including after normalization and before matching.

An accepted newer ingestion observation atomically sets an existing automatic link's confidence to zero when title, quote unit, package text, source brand or source unit multiplier changes. The fields are exactly those in the normalization fingerprint. A changed persisted normalization also sets automatic confidence to zero, including normalization-version or derived-value corrections; unchanged normalization reruns leave confidence intact. These writes use the existing retailer locks and batch transactions. Price, URL, image, category and availability changes alone do not revoke identity, and replayed observations cannot revoke it.

Zero confidence means the old evidence is no longer valid for the current identity. Links, reasons, canonical records and ordinary history remain stored. The existing public method/version/confidence guard withholds the entire exact group until matching revalidates its complete scope. Normalization alone cannot reauthorize the claim. Matching's snapshot checks, complete-link policy and guarded association updates restore eligibility only when current evidence qualifies. An incompatible identity may leave the old group unavailable.

Manual links and decisions are preserved by both invalidation writers and matching's existing manual-scope guard. Manual groups remain excluded from automatic public exact comparison under the existing policy. Independent generic/listing history remains available once its own normalization, trusted URL and ordinary-price boundaries pass; failed normalization may temporarily withhold independent metadata too.

Deployment must roll out these writers together, then normalize and match the complete existing automatic catalog to revalidate associations created before this invariant. Out-of-band SQL edits and old writer deployments do not enforce the invariant; future identity writers must apply the same invalidation under retailer locks. No migration or historical-data rewrite is required.

Scheduled acquisition uses incremental complete-block matching and fingerprint/version checkpoints. It expands prior canonical groups before mutation and evaluates only candidates satisfying the existing automatic identity prerequisites, in bounded SQL batches. Broad uncertain/review candidates remain in the existing audit path. Manual links and stale snapshots stay protected. `derive:catalog` is the large-catalog processing path; full `match:catalog` review scopes remain bounded to 5,000. See [catalog expansion](catalog-expansion.md).
