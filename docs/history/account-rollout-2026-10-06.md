# Account rollout observations — October 6, 2026 (Peru)

These are dated read-only observations, not migration/deployment authorization or proof of real Google sign-in. The intended production URL supplied by the user is [CompraFino](https://comprafino.vercel.app/).

## Remote evidence

- Public `/` and `/list` returned HTTP 200.
- Anonymous `GET /api/auth/get-session` returned HTTP 200 with JSON null and `Cache-Control: no-store`.
- Anonymous `GET /api/list/sync` returned HTTP 401 with `unauthenticated` and `Cache-Control: no-store`.
- GitHub's latest successful Production deployment record pointed to `1635f4b43bb4b8b914e39947fb19c5a6b34a93bf` at October 6, 19:00:14 Peru. Remote `main` matched this revision when inspected. The canonical hostname was not cryptographically linked to that deployment record; the responses establish the public boundary behavior, not a runtime commit identity.
- [CI for that revision](https://github.com/jeanpierre-jeri/comprafino/actions/runs/37549542686) succeeded. [Scheduled discovery](https://github.com/jeanpierre-jeri/comprafino/actions/runs/37542830600) succeeded at October 6, 17:48 Peru. Earlier [refresh](https://github.com/jeanpierre-jeri/comprafino/actions/runs/37501468190) and [discovery](https://github.com/jeanpierre-jeri/comprafino/actions/runs/37512706539) failed. These are workflow conclusions, not assertions about every retailer or listing.

## Configured application database

Read-only metadata inspection found `user`, `session`, `account`, `verification` and `user_shopping_lists`. The Drizzle migration ledger contained SHA-256 hashes matching the checked-in auth migration `0009_grey_husk.sql` and list migration `0010_natural_switch.sql`. No account rows, session tokens or credentials were read/output, and no migration was applied. Correspondence between this configured database and the production hosting connection was not independently verified.

The first read-only health report observed 1,000 retained listings; fresh searchable offers were Tottus 271, Plaza Vea 286 and Metro 294. Tottus/Plaza Vea retailer health was healthy; Metro was delayed and its latest recorded attempt failed. Capacity skips were not measured by that standalone check. These numbers are a dated observation and must not become current operational constants.

## Initial acceptance checklist

Production OAuth client/callback settings, the hosting database connection, authenticated reads/writes and cross-device behavior require a real account acceptance test. Anonymous endpoints cannot prove these. Existing deterministic integration/Chromium tests use owned schemas and real persisted test sessions, never production identities or Google requests.

1. Confirm Vercel production uses the intended migrated database and `BETTER_AUTH_URL=https://comprafino.vercel.app`.
2. Confirm Google's allowed callback is `https://comprafino.vercel.app/api/auth/callback/google`.
3. In a browser with an anonymous item, sign in with Google; verify the item imports and the list shows account synchronization. Use a disposable shopping item.
4. Sign in as the same user on another browser/device; verify that item appears, edit it, and refocus the first browser to verify refresh.
5. Log out; verify account items are withheld and only the remaining anonymous list appears. Remove the disposable item while signed in.
6. Enable Actions failure notifications and verify a manually dispatched health run's summary and notification delivery after publication.

The initial read-only inspection performed no real Google login, application write, repository push or deployment. Subsequent publication and acceptance evidence follows.

## Publication and user acceptance

Commit `0d9ca8ae0364f02ac68fffa9addf42dadc0bcba0` is published on GitHub main. Its [CI run](https://github.com/jeanpierre-jeri/comprafino/actions/runs/37564851676) passed, and Vercel reported a successful Production deployment for that revision. An anonymous mobile browser verified the live homepage, enabled sign-in control, Google login dialog with import explanation and browser-local empty-list page. No OAuth request was initiated by that browser check.

The [manually dispatched Catalog health run](https://github.com/jeanpierre-jeri/comprafino/actions/runs/37565061020) passed at October 6, approximately 22:05 Peru. Its report marked all three retailers healthy, with 1,000 retained listings under the configured 2,000 guard and 950 fresh searchable offers (Tottus 293, Plaza Vea 315, Metro 342). Metro's latest attempt was successful, superseding the earlier failed-attempt observation. Capacity skips were unmeasured, not zero.

The user subsequently confirmed production synchronization: “yes, it works the sync”. This records user-confirmed sync behavior; it does not establish separate results for anonymous import, logout isolation, each cross-device scenario or provider/hosting configuration inspection. Those detailed checks were not individually reported. Notification delivery remains unverified; a successful health run establishes execution and report generation, not failure-notification receipt. No migrations or account settings were changed during verification.
