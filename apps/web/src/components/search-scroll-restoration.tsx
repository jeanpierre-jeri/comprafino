"use client";

import { useEffect } from "react";
import { validatedSearchReturn } from "../lib/search-return";

/** Mount after the result cards, rather than restoring against a loading skeleton. */
export function SearchScrollRestoration() {
  useEffect(() => {
    const destination = validatedSearchReturn(
      `${window.location.pathname}${window.location.search}${window.location.hash}`,
    );

    if (!destination) return undefined;

    const hash = new URL(destination, window.location.origin).hash;

    if (!hash) return undefined;

    const position = Number(hash.slice("#scroll=".length));
    const frame = requestAnimationFrame(() =>
      window.scrollTo({ top: position, behavior: "instant" }),
    );

    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}
