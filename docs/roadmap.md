# Roadmap

Milestone 19B implements [authenticated persistence backend/API](shopping-list-persistence.md), with migration 0010 generated for review. Milestone 19C implements client merge, synchronization, safe account transitions and remote-authoritative UI; application migration/deployment remains separately authorized.

## Current capabilities

Bounded Tottus, Plaza Vea and Metro acquisition; scheduled refresh and demand discovery; independent normalization and conservative exact matching; public exact/generic search and retailer listing detail; separate CMR benefits; ordinary history with prospective observation coverage; anonymous browser-local and authenticated synchronized recurring lists and current one/two/three-store basket comparisons. See the [current engineering guide](../README.md).

## Current reliability and technical work

The repository hardening/cleanup program is complete: Cleanups A/B/C and the final unused-route/core-surface review resolve F01–F04, F06–F17 and F19. The [October 5 audit](engineering-audit.md#final-remediation-status--october-5-2026) preserves original evidence and final remediation status. Feature work may resume under separately agreed scope.

## Operations and account acceptance

Read-only [catalog health monitoring](catalog-health.md) is implemented with scheduled and post-acquisition Actions checks, using existing refresh/offer policies and explicit capacity-skip evidence. Publication and notification delivery remain separate. [Dated account rollout observations](history/account-rollout-2026-10-06.md) verify anonymous production endpoints and scoped migration metadata; real Google login and cross-device acceptance remain unverified.

## Next measured work

The catalog capacity review raises the admission/read guard to 2,000 listings; see [capacity evidence and limits](catalog-budget.md#reviewed-expansion-to-2000-listings). Further growth requires another performance review. F18 remains consciously deferred: optional query/read optimization requires measurement before implementation. Measure actual successful workflow duration and a stable multi-day price-change rate before quota or monthly storage decisions. These are future technical work, not unfinished cleanup; preserve the guard until a deliberate review supports a change.

## Deferred product work

Milestone 19A implements the [Google auth foundation](auth.md), with its migration generated for review and no remote deployment established. Public browsing remains public; 19C adds synchronized account lists while preserving anonymous lists. Additional account operations, import-marker recovery UI and alerts remain later work.

Purchase-timing recommendations require sufficient trustworthy history and a separate design. Further source/category expansion requires validated evidence and reviewed capacity; no expansion is scheduled here. Client caching, complex form tooling, queues, dedicated workers and search infrastructure require demonstrated requirements.

## Historical milestones

Completed milestone chronology and original acceptance notes are preserved in [engineering notes captured October 5](history/engineering-notes-2026-10-05.md#original-docsroadmapmd). The [history index](history/README.md) links reviewed validation, benchmark and catalog evidence. Historical counts and approval instructions describe those sessions only.
