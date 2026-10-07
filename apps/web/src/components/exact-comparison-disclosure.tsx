"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown } from "@comprafino/ui";
import { Button } from "@comprafino/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@comprafino/ui/components/collapsible";

/** Only the disclosure is interactive; its product cards are rendered on the server. */
export function ExactComparisonDisclosure({
  preview,
  children,
  remainingCount,
}: {
  preview: ReactNode;
  children: ReactNode;
  remainingCount: number;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const content = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      // The opening control disappears. Keep keyboard focus on the newly revealed results.
      content.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus({ preventScroll: true });
    }
  }, [open]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      {preview}
      {!open && (
        <div className="mt-3 flex justify-center">
          <CollapsibleTrigger
            aria-controls={panelId}
            aria-label={`Ver más comparaciones (${remainingCount})`}
            render={<Button variant="ghost" size="icon" className="size-11" />}
          >
            <ChevronDown data-icon="inline-end" aria-hidden="true" />
          </CollapsibleTrigger>
        </div>
      )}
      <CollapsibleContent id={panelId} keepMounted>
        <div ref={content} className="pt-5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
