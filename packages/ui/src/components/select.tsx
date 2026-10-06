"use client";

import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { Select } from "@base-ui/react/select";
import { cn } from "../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export function ChoiceSelect({
  label,
  value,
  options,
  onValueChange,
  disabled = false,
  compact = false,
  className,
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onValueChange: (value: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <Select.Root<string>
        items={options}
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next !== null) {
            onValueChange(next);
          }
        }}
      >
        <Select.Label className={compact ? "sr-only" : "filter-label"}>{label}</Select.Label>
        <Select.Trigger
          aria-label={label}
          className={cn("choice-trigger", compact && "theme-trigger")}
        >
          <span className="inline-flex items-center gap-1.5">
            {options.find((option) => option.value === value)?.icon}
            <Select.Value className="whitespace-nowrap" />
          </span>
          <Select.Icon className="choice-icon">
            <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner
            className="choice-positioner"
            sideOffset={6}
            align="start"
            alignItemWithTrigger={false}
          >
            <Select.Popup className="choice-popup">
              <Select.List className="choice-list">
                {options.map((option) => (
                  <Select.Item key={option.value} value={option.value} className="choice-option">
                    <Select.ItemText className="inline-flex items-center gap-2">
                      {option.icon}
                      {option.label}
                    </Select.ItemText>
                    <Select.ItemIndicator className="choice-check">
                      <Check aria-hidden="true" size={16} strokeWidth={1.5} />
                    </Select.ItemIndicator>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}
