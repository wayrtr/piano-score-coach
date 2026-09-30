"use client";

import { LiquidGlass, type LiquidGlassProps } from "react-liquid-glass-svg";

export function GlassSurface({ className = "", style, ...props }: LiquidGlassProps) {
  return (
    <LiquidGlass
      glassBorder
      backdropBlur={5}
      displacementScale={70}
      tintColor="var(--glass-tint)"
      {...props}
      className={`glass-surface ${className}`}
      style={{ borderRadius: 28, boxShadow: "var(--glass-shadow)", ...style }}
    />
  );
}
