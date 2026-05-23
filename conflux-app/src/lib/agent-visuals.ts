import type { AgentStatus } from "@/types";

export interface ColorPreset {
  id: string;
  color: string;
  name: string;
}

export const CARD_COLOR_PRESETS: ColorPreset[] = [
  { id: "ice-blue", color: "#B8D4E3", name: "Ice Blue" },
  { id: "amber", color: "#FFB800", name: "Amber" },
  { id: "mint", color: "#5FD47F", name: "Mint" },
  { id: "rose", color: "#FF6B6B", name: "Rose" },
  { id: "lavender", color: "#C8B5E3", name: "Lavender" },
  { id: "peach", color: "#E3C0A8", name: "Peach" },
  { id: "gold", color: "#D4C88A", name: "Gold" },
  { id: "sky", color: "#7FC8FF", name: "Sky" },
];

export const DEFAULT_CARD_ACCENT_COLOR = CARD_COLOR_PRESETS[0].color;
export const DEFAULT_ADAPTER_IDENTITY_COLOR = "#8A8A8A";

const ADAPTER_IDENTITY_COLORS: Record<string, string> = {
  "claude-code": "#B8D4E3",
  codex: "#FFB800",
  aider: "#8EA4B8",
  opencode: "#C9B894",
};

export function adapterIdentityColor(adapterId: string): string {
  return ADAPTER_IDENTITY_COLORS[adapterId] ?? DEFAULT_ADAPTER_IDENTITY_COLOR;
}

export function resolveCardAccentColor(
  instanceId: string,
  cardColors: Map<string, string>
): string {
  return cardColors.get(instanceId) ?? DEFAULT_CARD_ACCENT_COLOR;
}

export interface CardStatusMeta {
  label: string;
  color: string;
  background: string;
  border: string;
}

export const CARD_STATUS_META: Record<AgentStatus, CardStatusMeta> = {
  idle: {
    label: "Idle",
    color: "#8A8F98",
    background: "rgba(138,143,152,0.12)",
    border: "rgba(138,143,152,0.22)",
  },
  thinking: {
    label: "Thinking",
    color: "#B8D4E3",
    background: "rgba(184,212,227,0.12)",
    border: "rgba(184,212,227,0.22)",
  },
  coding: {
    label: "Coding",
    color: "#34C759",
    background: "rgba(52,199,89,0.12)",
    border: "rgba(52,199,89,0.22)",
  },
  waiting_permission: {
    label: "Approval",
    color: "#FFB800",
    background: "rgba(255,184,0,0.12)",
    border: "rgba(255,184,0,0.24)",
  },
  done: {
    label: "Done",
    color: "#7FC8FF",
    background: "rgba(127,200,255,0.12)",
    border: "rgba(127,200,255,0.22)",
  },
  error: {
    label: "Error",
    color: "#FF6B6B",
    background: "rgba(255,107,107,0.12)",
    border: "rgba(255,107,107,0.24)",
  },
};

export function resolveCardStatusMeta(status: AgentStatus): CardStatusMeta {
  return CARD_STATUS_META[status] ?? CARD_STATUS_META.idle;
}
