/** At most two Unicode letter/number initials; punctuation-only names use email. */
export function accountInitials(name: string, email: string) {
  const initials = (value: string) =>
    value
      .trim()
      .split(/\s+/u)
      .map((word) => word.match(/[\p{L}\p{N}]/u)?.[0] ?? "")
      .filter(Boolean)
      .slice(0, 2)
      .join("");
  const value =
    initials(name) || initials((email.split("@")[0] ?? "").replace(/[._-]+/gu, " ")) || "C";
  return Array.from(value.toLocaleUpperCase("es-PE")).slice(0, 2).join("");
}

export function avatarUrl(image: string | null | undefined) {
  if (!image) return undefined;
  try {
    const url = new URL(image);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}
