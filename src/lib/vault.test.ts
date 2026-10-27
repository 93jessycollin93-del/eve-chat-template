import { beforeEach, describe, expect, it } from "vitest";
import { resetDbForTests } from "./db";
import { listFiles, readFile, writeText } from "./fs";
import { changePassphrase, deleteItem, listItems, META_PATH, plaintextVaultFiles, readMeta, saveItem, sealPlaintext, setupVault } from "./vault";
import { passphraseBits, unlockVault, WrongPassphraseError } from "./vault-crypto";

const ITER = 1000; // keep tests fast; the app uses 600,000

beforeEach(resetDbForTests);

describe("vault", () => {
  it("encrypts existing plaintext on setup and removes the plaintext", async () => {
    await writeText("/Vault/secret.md", "the master prompt");
    await writeText("/Vault/sub/deep.txt", "deep");
    await writeText("/Other/public.txt", "public");
    const key = await setupVault("correct horse battery", ITER);

    const files = await listFiles();
    expect(plaintextVaultFiles(files)).toEqual([]);
    expect(await readFile("/Vault/secret.md")).toBeUndefined();
    expect(await readFile("/Other/public.txt")).toBeTruthy();
    const raw = files.filter((f) => f.path.endsWith(".sealed")).map((f) => f.content).join("");
    expect(raw).not.toContain("master prompt");
    expect(raw).not.toContain("secret.md"); // names are encrypted too

    const items = await listItems(key);
    expect(items.map((i) => i.entry?.name)).toEqual(["secret.md", "sub/deep.txt"]);
    expect(items[0].entry?.content).toBe("the master prompt");
  });

  it("refuses the wrong passphrase", async () => {
    await setupVault("right", ITER);
    const meta = readMeta(await listFiles())!;
    await expect(unlockVault(meta, "wrong")).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(unlockVault(meta, "right")).resolves.toBeTruthy();
    await expect(setupVault("again", ITER)).rejects.toThrow(/already/);
  });

  it("adds, edits, deletes, and re-seals late plaintext", async () => {
    const key = await setupVault("pw", ITER);
    const id = await saveItem(key, null, { name: "a.txt", content: "1", encoding: "utf8", created: 1, modified: 1 });
    await saveItem(key, id, { name: "a.txt", content: "2", encoding: "utf8", created: 1, modified: 2 });
    expect((await listItems(key))[0].entry?.content).toBe("2");
    await writeText("/Vault/late.txt", "late");
    expect(await sealPlaintext(key)).toBe(1);
    expect((await listItems(key)).map((i) => i.entry?.name)).toEqual(["a.txt", "late.txt"]);
    await deleteItem(id);
    expect(await listItems(key)).toHaveLength(1);
  });

  it("changes the passphrase and re-encrypts everything", async () => {
    await writeText("/Vault/k.md", "keep me");
    const oldKey = await setupVault("old", ITER);
    const newKey = await changePassphrase(oldKey, "new", ITER);
    const meta = readMeta(await listFiles())!;
    await expect(unlockVault(meta, "old")).rejects.toBeInstanceOf(WrongPassphraseError);
    const key = await unlockVault(meta, "new");
    expect((await listItems(key))[0].entry?.content).toBe("keep me");
    expect((await listItems(newKey))[0].entry?.content).toBe("keep me");
    expect((await listItems(oldKey))[0].entry).toBeNull();
    expect(await readFile(META_PATH)).toBeTruthy();
  });

  it("rates passphrase strength", () => {
    expect(passphraseBits("")).toBe(0);
    expect(passphraseBits("aaaa")).toBeLessThan(passphraseBits("Tr0ub4dor&3-horse"));
  });
});
