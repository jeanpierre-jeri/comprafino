"use client";

import { useSyncExternalStore } from "react";
import { ChoiceSelect } from "@comprafino/ui/components/select";

type Theme = "system" | "light" | "dark";
const storageKey = "comprafino-theme";
function preference(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}
function applyTheme(choice: Theme) {
  document.documentElement.dataset.themePreference = choice;
  document.documentElement.dataset.theme =
    choice === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : choice;
}
function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const update = () => {
    applyTheme(preference(document.documentElement.dataset.themePreference ?? null));
    callback();
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== storageKey && event.key !== null) return;
    applyTheme(preference(event.newValue));
    callback();
  };
  media.addEventListener("change", update);
  window.addEventListener("comprafino-theme", update);
  window.addEventListener("storage", storage);
  return () => {
    media.removeEventListener("change", update);
    window.removeEventListener("comprafino-theme", update);
    window.removeEventListener("storage", storage);
  };
}
function snapshot(): Theme {
  return preference(document.documentElement.dataset.themePreference ?? null);
}
function serverSnapshot(): Theme {
  return "system";
}

export function ThemeControl() {
  const choice = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  return (
    <ChoiceSelect
      compact
      label="Tema"
      value={choice}
      options={[
        { value: "system", label: "Sistema" },
        { value: "light", label: "Claro" },
        { value: "dark", label: "Oscuro" },
      ]}
      onValueChange={(value) => {
        const next = preference(value);
        try {
          if (next === "system") localStorage.removeItem(storageKey);
          else localStorage.setItem(storageKey, next);
        } catch {
          /* Theme still works when browser storage is unavailable. */
        }
        applyTheme(next);
        window.dispatchEvent(new Event("comprafino-theme"));
      }}
    />
  );
}
