"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import type { ReactNode } from "react";

/** Keep Link's automatic loading-boundary prefetch and native modified-click behavior. */
export function NavigationLink({
  href,
  className = "",
  children,
  scroll = true,
}: {
  href: string;
  className?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const navigating = useRef(false);
  useEffect(() => {
    if (!pending) navigating.current = false;
  }, [pending]);
  return (
    <>
      <Link
        href={href}
        scroll={scroll}
        className={`navigation-link ${className}`}
        aria-busy={pending}
        aria-disabled={pending || undefined}
        onNavigate={(event) => {
          event.preventDefault();
          if (navigating.current) return;
          navigating.current = true;
          startTransition(() => router.push(href, { scroll }));
        }}
      >
        {children}
      </Link>
      <output className="sr-only">{pending ? "Abriendo página…" : ""}</output>
    </>
  );
}
