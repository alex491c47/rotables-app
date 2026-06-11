// Shared light/dark preference, persisted so it survives navigating between pages.
const KEY = "ste_theme";
export const getDark = () => {
  try { return localStorage.getItem(KEY) !== "light"; } catch (e) { return true; }
};
export const saveDark = (dark) => {
  try { localStorage.setItem(KEY, dark ? "dark" : "light"); } catch (e) {}
};
