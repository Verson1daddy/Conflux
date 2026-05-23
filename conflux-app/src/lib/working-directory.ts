export interface OpenDirectoryOptions {
  directory: true;
  multiple: false;
  defaultPath?: string;
  title: string;
}

export type OpenDirectoryDialog = (
  options: OpenDirectoryOptions
) => Promise<unknown>;

export function normalizePickedWorkingDir(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export async function pickWorkingDirectory(
  openDialog: OpenDirectoryDialog,
  currentWorkingDir: string
): Promise<string | null> {
  const trimmedCurrentDir = currentWorkingDir.trim();
  const selected = await openDialog({
    directory: true,
    multiple: false,
    ...(trimmedCurrentDir.length > 0 ? { defaultPath: trimmedCurrentDir } : {}),
    title: "Select working directory",
  });
  return normalizePickedWorkingDir(selected);
}
