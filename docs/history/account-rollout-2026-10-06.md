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

## Remaining acceptance

Production OAuth client/callback settings, the hosting database connection, authenticated reads/writes and cross-device behavior require a real account acceptance test. Anonymous endpoints cannot prove these. Existing deterministic integration/Chromium tests use owned schemas and real persisted test sessions, never production identities or Google requests.

1. Confirm Vercel production uses the intended migrated database and `BETTER_AUTH_URL=https://comprafino.vercel.app`.
2. Confirm Google's allowed callback is `https://comprafino.vercel.app/api/auth/callback/google`.
3. In a browser with an anonymous item, sign in with Google; verify the item imports and the list shows account synchronization. Use a disposable shopping item.
4. Sign in as the same user on another browser/device; verify that item appears, edit it, and refocus the first browser to verify refresh.
5. Log out; verify account items are withheld and only the remaining anonymous list appears. Remove the disposable item while signed in.
6. Enable Actions failure notifications and verify a manually dispatched health run's summary and notification delivery after publication.

No real Google login, application write, repository push or deployment was performed during this review. Local changes and publication should be reviewed separately.
