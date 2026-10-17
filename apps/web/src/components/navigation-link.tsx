"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import type { ReactNode } from "react";
import { withSearchReturn } from "../lib/search-return";

/** Keep Link's automatic loading-boundary prefetch and native modified-click behavior. */
export function NavigationLink({
  href,
  className = "",
  children,
  scroll = true,
  captureSearchReturn = false,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  scroll?: boolean;
  captureSearchReturn?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigating = useRef(false);
  useEffect(() => {
    if (!pending) {
      navigating.current = false;
    }
  }, [pending]);

  function navigationDestination() {
    if (!captureSearchReturn) return href;

    const position = Math.max(0, Math.min(9_999_999, Math.round(window.scrollY)));

    return withSearchReturn(
      href,
      `${window.location.pathname}${window.location.search}#scroll=${position}`,
    );
  }

  return (
    <>
      <Link
        href={href}
        scroll={scroll}
        className={`navigation-link ${className}`}
        aria-busy={pending}
        aria-disabled={pending || undefined}
        onClick={(event) => {
          // Modified clicks use the native href rather than onNavigate.
          if (captureSearchReturn) {
            event.currentTarget.href = navigationDestination();
          }
        }}
        onAuxClick={(event) => {
          if (captureSearchReturn && event.button === 1) {
            event.currentTarget.href = navigationDestination();
          }
        }}
        onNavigate={(event) => {
          event.preventDefault();

          if (navigating.current) return;

          navigating.current = true;
          const destination = navigationDestination();
          startTransition(() => router.push(destination, { scroll }));
        }}
      >
        {children}
      </Link>
      <output className="sr-only">{pending ? "Abriendo página…" : ""}</output>
    </>
  );
}
