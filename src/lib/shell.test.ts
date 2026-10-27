import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { listFiles, readFile, writeText } from "./fs";
import { complete, runCommand, tokenize, type ShellEnv } from "./shell";

const env = (cwd = "/"): ShellEnv => ({ cwd, host: "Jessy", history: [] });

beforeEach(resetDbForTests);

describe("shell", () => {
  it("tokenizes quotes and redirects", () => {
    expect(tokenize(`echo "hello world">a.txt`)).toEqual(["echo", "hello world", ">", "a.txt"]);
    expect(tokenize("echo x >> 'my file'")).toEqual(["echo", "x", ">>", "my file"]);
    expect(() => tokenize('echo "oops')).toThrow(/Unclosed/);
  });

  it("writes, appends, lists and reads files", async () => {
    await runCommand("mkdir Notes", env());
    const cd = await runCommand("cd Notes", env());
    expect(cd.cwd).toBe("/Notes");
    await runCommand('echo "line one" > a.txt', env("/Notes"));
    await runCommand("echo line two >> a.txt", env("/Notes"));
    expect((await readFile("/Notes/a.txt"))?.content).toBe("line one\nline two\n");
    expect((await runCommand("cat a.txt", env("/Notes"))).output).toEqual(["line one", "line two"]);
    const ls = await runCommand("ls /Notes", env());
    expect(ls.output.join("\n")).toContain("a.txt");
    expect((await runCommand("wc /Notes/a.txt", env())).output[0]).toMatch(/^2 lines, 4 words, 18 bytes/);
  });

  it("asks before deleting and needs -r for folders", async () => {
    await writeText("/Box/x.txt", "x");
    await expect(runCommand("rm Box", env())).rejects.toThrow(/-r/);
    await expect(runCommand("rm /", env())).rejects.toThrow(/Refusing/);
    const r = await runCommand("rm -r Box", env());
    expect(r.confirm?.prompt).toMatch(/1 file/);
    expect(await listFiles()).toHaveLength(1); // nothing deleted until confirmed
    await r.confirm!.run();
    expect(await listFiles()).toHaveLength(0);
    await writeText("/Vault/.vault.json", "{}");
    expect((await runCommand("rm /Vault/.vault.json", env())).confirm?.prompt).toMatch(/WARNING/);
  });

  it("greps, finds, hashes, and moves", async () => {
    await writeText("/T/theory.md", "Brutal but beautiful\nPassion not obsession");
    expect((await runCommand("grep passion", env())).output).toEqual(["/T/theory.md:2: Passion not obsession"]);
    expect((await runCommand("find theory", env())).output).toEqual(["/T/theory.md"]);
    expect((await runCommand("sha256sum /T/theory.md", env())).output[0]).toMatch(/^[0-9a-f]{64} {2}\/T\/theory.md$/);
    await runCommand("mv /T/theory.md /T/renamed.md", env());
    expect(await readFile("/T/renamed.md")).toBeTruthy();
    await expect(runCommand("frobnicate", env())).rejects.toThrow(/not a command/);
  });

  it("tab-completes names", async () => {
    await writeText("/Theory/cybernetic_theory.md", "x");
    await writeText("/Theory/brutal.txt", "x");
    const files = await listFiles();
    expect(complete("cat /The", files, "/")).toBe("cat /Theory/");
    expect(complete("cat cy", files, "/Theory")).toBe("cat cybernetic_theory.md");
  });
});
