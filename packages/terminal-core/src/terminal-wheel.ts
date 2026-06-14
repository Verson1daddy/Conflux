export function shouldStopTerminalWheelPropagation(
  event: Pick<WheelEvent, "ctrlKey" | "metaKey">,
  interactive: boolean,
): boolean {
  return interactive && !event.ctrlKey && !event.metaKey;
}
