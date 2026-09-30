"use client";

import { useSyncExternalStore } from "react";
import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import {
  THEME_STORAGE_KEY,
  isThemePreference,
  nextThemePreference,
  resolveTheme,
  type ThemePreference,
} from "@/lib/ui/theme";

const LABELS: Record<ThemePreference, string> = {
  system: "跟随系统",
  light: "浅色",
  dark: "深色",
};

const ICONS: Record<ThemePreference, LucideIcon> = {
  system: Monitor,
  light: Sun,
  dark: Moon,
};

const THEME_EVENT = "piano-session:theme";

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

function applyTheme(preference: ThemePreference) {
  if (typeof document === "undefined") {
    return;
  }

  document.documentElement.dataset.theme = resolveTheme(
    preference,
    systemPrefersDark(),
  );
}

function subscribe(onStoreChange: () => void) {
  const mediaQuery =
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;

  // When the OS theme flips and we are in "system" mode, re-resolve + repaint.
  const handleMedia = () => {
    if (readPreference() === "system") {
      applyTheme("system");
    }
    onStoreChange();
  };

  window.addEventListener("storage", onStoreChange);
  window.addEventListener(THEME_EVENT, onStoreChange);
  mediaQuery?.addEventListener("change", handleMedia);

  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(THEME_EVENT, onStoreChange);
    mediaQuery?.removeEventListener("change", handleMedia);
  };
}

function readPreference(): ThemePreference {
  if (typeof window === "undefined") {
    return "system";
  }

  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

export function ThemeToggle() {
  const preference = useSyncExternalStore(
    subscribe,
    readPreference,
    () => "system" as ThemePreference,
  );

  function cycleTheme() {
    const next = nextThemePreference(preference);
    applyTheme(next);

    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Persisting the choice is best-effort; the theme still applies in-session.
    }

    window.dispatchEvent(new Event(THEME_EVENT));
  }

  const label = LABELS[preference];
  const Icon = ICONS[preference];

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycleTheme}
      aria-label={`外观：${label}（点击切换）`}
      title={`外观：${label}`}
    >
      <span className="theme-toggle-icon" aria-hidden="true">
        <Icon size={18} strokeWidth={1.8} />
      </span>
      <span className="theme-toggle-label">{label}</span>
    </button>
  );
}
