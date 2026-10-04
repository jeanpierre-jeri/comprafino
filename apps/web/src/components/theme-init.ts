// Runs before page content paints. Browser storage is optional; system is the default.
export const themeInit = `(() => {
  let preference = "system";
  try {
    const saved = localStorage.getItem("comprafino-theme");
    if (saved === "light" || saved === "dark") preference = saved;
  } catch {}
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = preference === "system"
    ? matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
    : preference;
})();`;
