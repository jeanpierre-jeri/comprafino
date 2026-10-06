import { createStore } from "zustand/vanilla";

type Theme = "system" | "light" | "dark";

type ThemeState = { choice: Theme; select: (value: string) => void };

const storageKey = "comprafino-theme";

function preference(value: string | null): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

function applyTheme(choice: Theme) {
  document.documentElement.dataset.themePreference = choice;
  let resolved = choice;

  if (choice === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  document.documentElement.dataset.theme = resolved;
}

export function createThemeStore() {
  return createStore<ThemeState>()((set) => ({
    choice: "system",
    select: (value) => {
      const choice = preference(value);

      try {
        if (choice === "system") {
          localStorage.removeItem(storageKey);
        } else {
          localStorage.setItem(storageKey, choice);
        }
      } catch {
        // Theme changes remain usable when browser storage is unavailable.
      }

      applyTheme(choice);
      set({ choice });
      window.dispatchEvent(new Event(storageKey));
    },
  }));
}

export function connectThemeStore(store: ReturnType<typeof createThemeStore>) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");

  function refresh() {
    const choice = preference(document.documentElement.dataset.themePreference ?? null);
    applyTheme(choice);
    store.setState({ choice });
  }

  function storageChanged(event: StorageEvent) {
    if (event.key !== storageKey && event.key !== null) return;

    const choice = preference(event.newValue);
    applyTheme(choice);
    store.setState({ choice });
  }

  refresh();
  media.addEventListener("change", refresh);
  window.addEventListener(storageKey, refresh);
  window.addEventListener("storage", storageChanged);

  return () => {
    media.removeEventListener("change", refresh);
    window.removeEventListener(storageKey, refresh);
    window.removeEventListener("storage", storageChanged);
  };
}
