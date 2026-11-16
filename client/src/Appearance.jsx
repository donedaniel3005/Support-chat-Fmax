import React, { createContext, useContext, useEffect, useState } from 'react';
import { APPEARANCE_KEY, validPreference, resolveAppearance } from './appearance-model.mjs';
import './appearance.css';
const AppearanceContext = createContext(null);
export function AppearanceProvider({ children }) {
  const [preference, setPreference] = useState(() => {
    try { return validPreference(localStorage.getItem(APPEARANCE_KEY)); } catch { return 'system'; }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  const resolved = resolveAppearance(preference, systemDark);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const changed = event => setSystemDark(event.matches);
    media.addEventListener('change', changed);
    const stored = event => { if (event.key === APPEARANCE_KEY || event.key === null) setPreference(validPreference(event.newValue)); };
    window.addEventListener('storage', stored);
    return () => { media.removeEventListener('change', changed); window.removeEventListener('storage', stored); };
  }, []);
  // Apply synchronously in the click handler, so the entire interface changes together.
  function choose(value) {
    const next = validPreference(value);
    document.documentElement.dataset.appearance = resolveAppearance(next, systemDark);
    document.documentElement.style.colorScheme = resolveAppearance(next, systemDark);
    setPreference(next);
    try { localStorage.setItem(APPEARANCE_KEY, next); } catch { /* Appearance remains usable when browser storage is unavailable. */ }
  }
  useEffect(() => {
    document.documentElement.dataset.appearance = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  return <AppearanceContext.Provider value={{ preference, resolved, choose }}>{children}</AppearanceContext.Provider>;
}
function ModeIcon({ mode }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{mode === 'light' ? <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></> : mode === 'dark' ? <path d="M20.5 13A8.5 8.5 0 0 1 11 3.5 8.5 8.5 0 1 0 20.5 13Z"/> : <><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/></>}</svg>;
}
export function AppearanceControl() {
  const appearance = useContext(AppearanceContext);
  if (!appearance) return null;
  return <div className="appearance-control" role="group" aria-label="Color mode">{['light', 'dark', 'system'].map(mode => <button type="button" key={mode} aria-label={`${mode[0].toUpperCase() + mode.slice(1)} mode`} aria-pressed={appearance.preference === mode} title={`${mode[0].toUpperCase() + mode.slice(1)} mode`} onClick={() => appearance.choose(mode)}><ModeIcon mode={mode}/></button>)}</div>;
}
