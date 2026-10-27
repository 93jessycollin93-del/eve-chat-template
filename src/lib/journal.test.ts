import { describe, expect, it } from "vitest";
import { journalToMarkdown, parseJournal, serializeJournal } from "./journal";

describe("journal", () => {
  it("round-trips and skips damaged lines", () => {
    const entries = [
      { id: "1", t: "2025-01-02T00:00:00.000Z", brutal: "b1", beautiful: "" },
      { id: "2", t: "2025-01-01T00:00:00.000Z", brutal: "", beautiful: "y2" },
    ];
    const text = serializeJournal(entries) + "{broken\n";
    const parsed = parseJournal(text);
    expect(parsed.map((e) => e.id)).toEqual(["1", "2"]); // newest first
    expect(journalToMarkdown(parsed)).toContain("_(not written yet)_");
  });
});
