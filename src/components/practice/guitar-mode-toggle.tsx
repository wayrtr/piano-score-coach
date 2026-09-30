"use client";

import type { ReactNode } from "react";

type ToggleOption<TValue extends string> = {
  value: TValue;
  label: string;
  icon?: ReactNode;
};

type GuitarModeToggleProps<TValue extends string> = {
  label: string;
  value: TValue;
  options: readonly ToggleOption<TValue>[];
  onChange: (value: TValue) => void;
};

export function GuitarModeToggle<TValue extends string>({
  label,
  value,
  options,
  onChange,
}: GuitarModeToggleProps<TValue>) {
  return (
    <div className="mode-toggle">
      <span className="mode-toggle-label">{label}</span>
      <div className="mode-toggle-buttons" role="group" aria-label={label}>
        {options.map((option) => {
          const isActive = option.value === value;

          return (
            <button
              key={option.value}
              type="button"
              className={`mode-toggle-button${isActive ? " is-active" : ""}`}
              aria-pressed={isActive}
              onClick={() => onChange(option.value)}
            >
              {option.icon ? (
                <span className="mode-toggle-icon" aria-hidden="true">
                  {option.icon}
                </span>
              ) : null}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
