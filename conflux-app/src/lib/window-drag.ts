import { getCurrentWindow } from "@tauri-apps/api/window";

export async function startCurrentWindowDrag(): Promise<void> {
  try {
    await getCurrentWindow().startDragging();
  } catch {
    // Browser previews and non-Tauri test environments cannot start native window drags.
  }
}
