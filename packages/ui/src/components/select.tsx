"use client";

import { Select } from "@base-ui/react/select";
import { cn } from "../lib/utils";

export interface SelectOption {
  value: string;
  label: string;
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
          if (next !== null) onValueChange(next);
        }}
      >
        <Select.Label className={compact ? "sr-only" : "filter-label"}>{label}</Select.Label>
        <Select.Trigger
          aria-label={label}
          className={cn("choice-trigger", compact && "theme-trigger")}
        >
          <Select.Value className="whitespace-nowrap" />
          <Select.Icon className="choice-icon">
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="m4 6 4 4 4-4"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
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
                    <Select.ItemText>{option.label}</Select.ItemText>
                    <Select.ItemIndicator className="choice-check">
                      <svg
                        aria-hidden="true"
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="m3 8 3 3 7-7"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
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
