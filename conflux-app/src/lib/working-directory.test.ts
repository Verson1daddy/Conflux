import { describe, expect, it } from "vitest";
import {
  normalizePickedWorkingDir,
  pickWorkingDirectory,
  type OpenDirectoryDialog,
} from "./working-directory";

describe("normalizePickedWorkingDir", () => {
  it("keeps a selected directory path", () => {
    expect(normalizePickedWorkingDir("D:\\Projects\\conflux")).toBe("D:\\Projects\\conflux");
  });

  it("trims accidental whitespace around the selected path", () => {
    expect(normalizePickedWorkingDir("  C:\\Users\\zwm  ")).toBe("C:\\Users\\zwm");
  });

  it("ignores canceled or multi-select dialog results", () => {
    expect(normalizePickedWorkingDir(null)).toBeNull();
    expect(normalizePickedWorkingDir(["D:\\Projects\\conflux"])).toBeNull();
  });
});

describe("pickWorkingDirectory", () => {
  it("opens a single-directory picker with the current directory as default", async () => {
    let receivedOptions: unknown;
    const openDialog: OpenDirectoryDialog = async (options) => {
      receivedOptions = options;
      return "D:\\Projects\\conflux";
    };

    const picked = await pickWorkingDirectory(openDialog, " C:\\Users\\zwm ");

    expect(receivedOptions).toEqual({
      directory: true,
      multiple: false,
      defaultPath: "C:\\Users\\zwm",
      title: "Select working directory",
    });
    expect(picked).toBe("D:\\Projects\\conflux");
  });

  it("omits defaultPath when the field is blank", async () => {
    let receivedOptions: unknown;
    const openDialog: OpenDirectoryDialog = async (options) => {
      receivedOptions = options;
      return null;
    };

    const picked = await pickWorkingDirectory(openDialog, "   ");

    expect(receivedOptions).toEqual({
      directory: true,
      multiple: false,
      title: "Select working directory",
    });
    expect(picked).toBeNull();
  });
});
