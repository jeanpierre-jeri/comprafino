export type ShoppingSession =
  | { status: "checking"; accountKnown: boolean }
  | { status: "unavailable"; accountKnown: boolean }
  | { status: "anonymous" }
  | { status: "authenticated"; userId: string; sessionId: string };

export function hasKnownShoppingAccount(session: ShoppingSession): boolean {
  if (session.status === "authenticated") return true;

  if (session.status === "anonymous") return false;

  return session.accountKnown;
}

export function sameShoppingSession(left: ShoppingSession, right: ShoppingSession): boolean {
  if (left.status !== right.status) return false;

  if (left.status === "authenticated" && right.status === "authenticated") {
    return left.userId === right.userId && left.sessionId === right.sessionId;
  }

  return hasKnownShoppingAccount(left) === hasKnownShoppingAccount(right);
}

// Only the identity fields of Better Auth's client result are needed here.
type SessionLookup = {
  data: { user: { id: string }; session: { id: string } } | null;
  isPending: boolean;
  error: unknown;
};

export function resolveShoppingSession(
  auth: SessionLookup,
  accountKnown: boolean,
): ShoppingSession {
  if (auth.data) {
    return { status: "authenticated", userId: auth.data.user.id, sessionId: auth.data.session.id };
  }
  if (auth.isPending) return { status: "checking", accountKnown };
  if (auth.error && accountKnown) return { status: "unavailable", accountKnown };
  return { status: "anonymous" };
}
