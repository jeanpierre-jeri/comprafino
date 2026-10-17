/** Only the local search page may be used as a detail's return destination. */
export function validatedSearchReturn(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 4096 ||
    !/^\/search(?:[?#]|$)/u.test(value) ||
    value.includes("\\") ||
    value
      .split("")
      .some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127)
  ) {
    return null;
  }

  const destination = new URL(value, "https://comprafino.invalid");

  if (
    destination.pathname !== "/search" ||
    (destination.hash && !/^#scroll=\d{1,7}$/u.test(destination.hash))
  ) {
    return null;
  }

  return `${destination.pathname}${destination.search}${destination.hash}`;
}

export function withSearchReturn(path: string, returnTo: unknown): string {
  const destination = validatedSearchReturn(returnTo);

  if (!destination) return path;

  const url = new URL(path, "https://comprafino.invalid");
  url.searchParams.set("returnTo", destination);

  return `${url.pathname}${url.search}${url.hash}`;
}
