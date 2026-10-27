import { describe, expect, it } from "vitest";
import { basename, dirname, extname, isWithin, joinPath, normalizePath, topLevel } from "./paths";

describe("paths", () => {
  it("normalizes absolute and relative paths", () => {
    expect(normalizePath("/a//b/./c/")).toBe("/a/b/c");
    expect(normalizePath("c.txt", "/a/b")).toBe("/a/b/c.txt");
    expect(normalizePath("../x", "/a/b")).toBe("/a/x");
    expect(normalizePath("../../..", "/a")).toBe("/");
    expect(normalizePath("")).toBe("/");
  });

  it("splits names", () => {
    expect(basename("/a/b.md")).toBe("b.md");
    expect(dirname("/a/b.md")).toBe("/a");
    expect(dirname("/b.md")).toBe("/");
    expect(extname("/a/b.TAR.GZ")).toBe("gz");
    expect(extname("/a/.folder")).toBe("");
    expect(joinPath("/", "x")).toBe("/x");
    expect(topLevel("/Theory/a.md")).toBe("Theory");
    expect(topLevel("/a.md")).toBe("");
  });

  it("checks containment without prefix confusion", () => {
    expect(isWithin("/Vault/a", "/Vault")).toBe(true);
    expect(isWithin("/Vault", "/Vault")).toBe(true);
    expect(isWithin("/VaultX/a", "/Vault")).toBe(false);
  });
});
