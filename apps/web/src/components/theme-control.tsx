"use client";

import { Monitor, Moon, Sun } from "@comprafino/ui";
import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { createThemeStore, connectThemeStore } from "../lib/theme-store";
import { ChoiceSelect } from "@comprafino/ui/components/select";

export function ThemeControl() {
  const [store] = useState(createThemeStore);
  const choice = useStore(store, (state) => state.choice);
  const selectTheme = useStore(store, (state) => state.select);

  useEffect(() => connectThemeStore(store), [store]);

  return (
    <ChoiceSelect
      compact
      label="Tema"
      value={choice}
      options={[
        {
          value: "system",
          label: "Sistema",
          icon: <Monitor aria-hidden="true" size={16} strokeWidth={1.6} className="shrink-0" />,
        },
        {
          value: "light",
          label: "Claro",
          icon: <Sun aria-hidden="true" size={16} strokeWidth={1.6} className="shrink-0" />,
        },
        {
          value: "dark",
          label: "Oscuro",
          icon: <Moon aria-hidden="true" size={16} strokeWidth={1.6} className="shrink-0" />,
        },
      ]}
      onValueChange={selectTheme}
    />
  );
}
