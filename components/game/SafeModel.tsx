"use client";
import { Component, type ReactNode } from "react";
import { PLACEHOLDER_FIGHTERS, type FighterDef } from "@/lib/fighters";

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn(`[game] ${this.props.label} failed to load, using a fallback: ${e instanceof Error ? e.message : e}`);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * A fighter GLB (or one of its clips) that 404s / fails to parse must not take the whole canvas down.
 * Level 1: the full fighter. Level 2: the same model without separate clips (procedural moves). Level 3: the
 * Boltbox placeholder wearing the fighter's name and colour.
 */
export function SafeModel({ def, render }: { def: FighterDef; render: (d: FighterDef) => ReactNode }) {
  const bare: FighterDef = { ...def, animUrls: undefined };
  const stand: FighterDef = { ...PLACEHOLDER_FIGHTERS[0], id: def.id, name: def.name, color: def.color };
  return (
    <Boundary key={def.id} label={def.name} fallback={<Boundary label={`${def.name} (model)`} fallback={render(stand)}>{render(bare)}</Boundary>}>
      {render(def)}
    </Boundary>
  );
}
