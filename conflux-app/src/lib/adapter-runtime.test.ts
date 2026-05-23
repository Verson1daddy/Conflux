import { describe, expect, it } from "vitest";
import {
  buildAdapterRuntimeBadges,
  canCreateAdapter,
  getCreateDisabledReason,
} from "./adapter-runtime";
import type { AdapterAuthStatus } from "@/types";

const status = (overrides: Partial<AdapterAuthStatus> = {}): AdapterAuthStatus => ({
  adapter_id: "codex",
  ready: true,
  message: "Ready",
  login_command: null,
  docs_url: null,
  installed: true,
  authenticated: true,
  runnable: true,
  session_supported: false,
  install_message: "CLI found",
  auth_message: "Authenticated",
  runtime_message: "Runnable",
  session_message: "Session restore is not supported yet",
  ...overrides,
});

describe("adapter-runtime", () => {
  it("disables create while the backend list is only a preview", () => {
    expect(canCreateAdapter(status(), true)).toBe(false);
    expect(getCreateDisabledReason(status(), true)).toBe(
      "Backend unavailable; preview adapters cannot be created."
    );
  });

  it("disables create until runtime detection returns", () => {
    expect(canCreateAdapter(undefined, false)).toBe(false);
    expect(getCreateDisabledReason(undefined, false)).toBe("Checking adapter runtime...");
  });

  it("distinguishes missing binary from missing auth", () => {
    const missingBinary = status({
      ready: false,
      installed: false,
      authenticated: false,
      runnable: false,
      install_message: "Codex CLI not found",
      auth_message: "Auth not checked because CLI is missing",
      runtime_message: "Install the CLI before creating a session",
    });
    const missingAuth = status({
      ready: false,
      installed: true,
      authenticated: false,
      runnable: false,
      install_message: "CLI found",
      auth_message: "OPENAI_API_KEY is not set",
      runtime_message: "Complete login or API key setup before creating a session",
    });

    expect(getCreateDisabledReason(missingBinary, false)).toBe("Codex CLI not found");
    expect(getCreateDisabledReason(missingAuth, false)).toBe("OPENAI_API_KEY is not set");
  });

  it("labels unavailable blocking states without pretending they are ready", () => {
    const missingAuth = status({
      ready: false,
      authenticated: false,
      runnable: false,
      auth_message: "Run codex login",
      runtime_message: "Complete login before creating a session",
    });

    const badges = buildAdapterRuntimeBadges(missingAuth, false);

    expect(badges.find((badge) => badge.id === "authenticated")).toMatchObject({
      label: "Auth Missing",
      tone: "warn",
      ok: false,
    });
    expect(badges.find((badge) => badge.id === "runnable")).toMatchObject({
      label: "Not Runnable",
      tone: "warn",
      ok: false,
    });
  });

  it("allows runnable adapters even when session restore is not supported", () => {
    const runnableWithoutRestore = status({ session_supported: false });

    expect(canCreateAdapter(runnableWithoutRestore, false)).toBe(true);

    const badges = buildAdapterRuntimeBadges(runnableWithoutRestore, false);
    expect(badges.map((badge) => [badge.id, badge.ok])).toEqual([
      ["installed", true],
      ["authenticated", true],
      ["runnable", true],
      ["session", false],
    ]);
    expect(badges.find((badge) => badge.id === "session")).toMatchObject({
      label: "Session Pending",
      tone: "muted",
    });
  });
});
