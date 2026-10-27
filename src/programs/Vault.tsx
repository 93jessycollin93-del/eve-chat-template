import { Download, FilePlus, KeyRound, Lock, Save, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { base64ToBytes, bytesToBase64, formatBytes, tryDecodeText, utf8Encode } from "../lib/bytes";
import { pickFiles, saveToDevice } from "../lib/download";
import { listFiles } from "../lib/fs";
import { changePassphrase, deleteItem, listItems, plaintextVaultFiles, readMeta, saveItem, SEALED_EXT, sealPlaintext, setupVault, type VaultEntry, type VaultItem } from "../lib/vault";
import { DEFAULT_ITERATIONS, passphraseBits, unlockVault, WrongPassphraseError } from "../lib/vault-crypto";
import { AUTO_LOCK_MS, lockVault, setVaultKey, touchVault } from "../lib/vault-session";
import { useFiles, useNow, useToast, useVaultSession } from "../os/hooks";
import type { ProgramProps } from "../os/programs";
import { Btn, Card, inputClass, Notice, ProgramHeader, SourceChip, Spinner } from "../ui/ui";

function Strength({ value }: { value: string }) {
  const bits = passphraseBits(value);
  const label = bits < 40 ? "weak" : bits < 60 ? "fair" : bits < 80 ? "good" : "strong";
  const color = bits < 40 ? "bg-danger" : bits < 60 ? "bg-gold" : "bg-accent";
  return (
    <div className="mono flex items-center gap-2 text-[9px] text-white/55">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, (bits / 100) * 100)}%` }} />
      </div>
      <span>
        ~{bits} bits · {label}
      </span>
    </div>
  );
}

function entrySize(e: VaultEntry): number {
  return e.encoding === "base64" ? base64ToBytes(e.content).length : utf8Encode(e.content).length;
}

function Setup({ plaintextCount }: { plaintextCount: number }) {
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ok = p1.length >= 8 && p1 === p2;
  return (
    <div className="space-y-3">
      <Notice tone="warn">
        {plaintextCount > 0
          ? `${plaintextCount} file(s) in /Vault are currently NOT encrypted. Anyone with this device can read them.`
          : "The vault is not set up yet."}
      </Notice>
      <Card className="space-y-2.5">
        <div className="mono text-[12px] font-semibold">Seal the vault</div>
        <p className="mono text-[10px] leading-5 text-white/60">
          Choose a passphrase. It is turned into an AES-256 key with PBKDF2 ({DEFAULT_ITERATIONS.toLocaleString()} rounds) and never stored. Every file in /Vault is encrypted,
          including its name, and the plaintext copies are deleted.
        </p>
        <input type="password" autoComplete="new-password" value={p1} onChange={(e) => setP1(e.target.value)} placeholder="passphrase (8+ characters; a few random words is best)" className={`${inputClass} w-full`} aria-label="New passphrase" />
        <Strength value={p1} />
        <input type="password" autoComplete="new-password" value={p2} onChange={(e) => setP2(e.target.value)} placeholder="type it again" className={`${inputClass} w-full`} aria-label="Confirm passphrase" />
        {p2 && p1 !== p2 && <div className="mono text-[10px] text-red-300">The two passphrases differ.</div>}
        <Notice tone="danger">There is no recovery. If you forget this passphrase, the vault contents are gone for good. Write it down somewhere safe.</Notice>
        <Btn
          variant="solid-danger"
          disabled={!ok || busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              setVaultKey(await setupVault(p1));
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Deriving key and encrypting…" : "Encrypt vault"}
        </Btn>
        {error && <Notice tone="danger">{error}</Notice>}
      </Card>
    </div>
  );
}

function Unlock({ sealedCount }: { sealedCount: number }) {
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className="flex flex-1 flex-col items-center justify-center gap-4 py-6"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const meta = readMeta(await listFiles());
          if (!meta) throw new Error("Vault metadata is missing.");
          setVaultKey(await unlockVault(meta, pass));
          setPass("");
        } catch (err) {
          setError(err instanceof WrongPassphraseError ? "Wrong passphrase." : err instanceof Error ? err.message : String(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-[16px] border border-danger/30 bg-danger/15">
        <Lock size={28} color="#ff5050" />
      </div>
      <div className="mono text-center">
        <div className="text-[13px] font-semibold">Sovereign Foundry Vault</div>
        <div className="mt-1 text-[10px] text-white/55">
          {sealedCount} encrypted item(s) · AES-256-GCM · PBKDF2-SHA256
        </div>
      </div>
      <div className="flex w-full max-w-[320px] gap-2">
        <input type="password" autoComplete="current-password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} placeholder="passphrase" className={`${inputClass} h-10 min-w-0 flex-1`} aria-label="Passphrase" />
        <button type="submit" disabled={!pass || busy} className="mono h-10 rounded-[10px] bg-danger px-4 text-[11px] font-semibold text-black disabled:opacity-40">
          {busy ? "…" : "Unlock"}
        </button>
      </div>
      {busy && <Spinner label="Deriving key…" />}
      {error && <div className="mono text-[11px] text-red-300" role="alert">{error}</div>}
    </form>
  );
}

function Editor({ item, keyRef, onDone }: { item: VaultItem | null; keyRef: CryptoKey; onDone: (msg?: string) => void }) {
  const [name, setName] = useState(item?.entry?.name ?? "note.md");
  const [content, setContent] = useState(item?.entry?.encoding === "utf8" ? item.entry.content : "");
  const [busy, setBusy] = useState(false);
  const binary = item?.entry?.encoding === "base64";
  return (
    <Card className="space-y-2">
      <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} w-full`} aria-label="Name" disabled={binary} />
      {binary ? (
        <Notice tone="muted">Binary file ({formatBytes(entrySize(item!.entry!))}). Export it to view.</Notice>
      ) : (
        <textarea
          value={content}
          onChange={(e) => {
            setContent(e.target.value);
            touchVault();
          }}
          className="mono h-[180px] w-full resize-y rounded-[8px] border border-white/10 bg-black p-2 text-[11px] leading-5 text-[#ffcccc] outline-none focus:border-danger/40"
          aria-label="Secret contents"
          spellCheck={false}
        />
      )}
      <div className="flex gap-1.5">
        {!binary && (
          <Btn
            variant="soft"
            icon={Save}
            disabled={busy || !name.trim()}
            onClick={async () => {
              setBusy(true);
              const now = Date.now();
              await saveItem(keyRef, item?.id ?? null, {
                name: name.trim(),
                content,
                encoding: "utf8",
                created: item?.entry?.created ?? now,
                modified: now,
              });
              setBusy(false);
              onDone("Encrypted and saved.");
            }}
          >
            Encrypt &amp; save
          </Btn>
        )}
        <Btn onClick={() => onDone()}>Close</Btn>
      </div>
    </Card>
  );
}

function Unlocked({ cryptoKey, plaintextCount, lastActivity }: { cryptoKey: CryptoKey; plaintextCount: number; lastActivity: number }) {
  const { files } = useFiles();
  const now = useNow(1000);
  const [items, setItems] = useState<VaultItem[] | null>(null);
  const [editing, setEditing] = useState<VaultItem | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const [np1, setNp1] = useState("");
  const [np2, setNp2] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast(5000);

  useEffect(() => {
    let cancelled = false;
    listItems(cryptoKey).then((list) => !cancelled && setItems(list));
    return () => {
      cancelled = true;
    };
  }, [cryptoKey, files]);

  const remaining = Math.max(0, AUTO_LOCK_MS - (now.getTime() - lastActivity));

  return (
    <div className="space-y-3" onPointerDown={touchVault} onKeyDown={touchVault}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Btn variant="soft" icon={FilePlus} onClick={() => setEditing("new")}>
          New secret note
        </Btn>
        <Btn
          icon={Upload}
          onClick={async () => {
            const picked = await pickFiles({ multiple: true });
            for (const f of picked) {
              const bytes = new Uint8Array(await f.arrayBuffer());
              const text = tryDecodeText(bytes);
              await saveItem(cryptoKey, null, {
                name: f.name,
                content: text ?? bytesToBase64(bytes),
                encoding: text === null ? "base64" : "utf8",
                mime: f.type || undefined,
                created: Date.now(),
                modified: Date.now(),
              });
            }
            if (picked.length) showToast(`Encrypted ${picked.length} file(s). They were never stored unencrypted.`);
          }}
        >
          Add files
        </Btn>
        <Btn icon={KeyRound} onClick={() => setChanging((c) => !c)}>
          Change passphrase
        </Btn>
        <Btn variant="danger" icon={Lock} onClick={lockVault}>
          Lock now
        </Btn>
        <span className="mono ml-auto text-[9px] text-white/45">auto-locks in {Math.floor(remaining / 60000)}:{String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0")}</span>
      </div>

      {plaintextCount > 0 && (
        <Notice tone="warn">
          {plaintextCount} plaintext file(s) were added to /Vault from elsewhere and are not encrypted.{" "}
          <button
            className="underline"
            onClick={async () => {
              const n = await sealPlaintext(cryptoKey);
              showToast(`Sealed ${n} file(s); plaintext copies deleted.`);
            }}
          >
            Seal them now
          </button>
        </Notice>
      )}

      {changing && (
        <Card className="space-y-2">
          <div className="mono text-[11px] font-semibold">New passphrase</div>
          <input type="password" autoComplete="new-password" value={np1} onChange={(e) => setNp1(e.target.value)} placeholder="new passphrase" className={`${inputClass} w-full`} aria-label="New passphrase" />
          <Strength value={np1} />
          <input type="password" autoComplete="new-password" value={np2} onChange={(e) => setNp2(e.target.value)} placeholder="again" className={`${inputClass} w-full`} aria-label="Confirm new passphrase" />
          <Btn
            variant="solid-danger"
            disabled={busy || np1.length < 8 || np1 !== np2}
            onClick={async () => {
              setBusy(true);
              try {
                setVaultKey(await changePassphrase(cryptoKey, np1));
                setNp1("");
                setNp2("");
                setChanging(false);
                showToast("Passphrase changed. Everything was re-encrypted in one step.");
              } catch (err) {
                showToast(err instanceof Error ? err.message : String(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Re-encrypting…" : "Re-encrypt everything"}
          </Btn>
        </Card>
      )}

      {toast && <Notice>{toast}</Notice>}

      {editing && <Editor key={editing === "new" ? "new" : editing.id} item={editing === "new" ? null : editing} keyRef={cryptoKey} onDone={(m) => { setEditing(null); if (m) showToast(m); }} />}

      {items === null ? (
        <Spinner label="Decrypting…" />
      ) : items.length === 0 ? (
        <div className="mono rounded-[12px] border border-dashed border-white/10 p-4 text-[11px] text-white/45">The vault is empty. Add a secret note or a file.</div>
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-2 rounded-[10px] border border-white/10 bg-white/[0.04] p-2.5">
              <div className="mono min-w-0 flex-1">
                <div className="truncate text-[11px]">{item.entry?.name ?? `${item.id}${SEALED_EXT}`}</div>
                <div className="text-[9px] text-white/50">
                  {item.entry ? `${formatBytes(entrySize(item.entry))} · modified ${new Date(item.entry.modified).toLocaleString()}` : item.error}
                </div>
              </div>
              {item.entry && (
                <>
                  <Btn onClick={() => setEditing(item)}>{item.entry.encoding === "utf8" ? "Open" : "Info"}</Btn>
                  <Btn
                    icon={Download}
                    aria-label="Export decrypted"
                    onClick={async () => {
                      const e = item.entry!;
                      const data = e.encoding === "base64" ? base64ToBytes(e.content) : e.content;
                      const r = await saveToDevice(e.name.split("/").pop() || "secret", data, e.mime);
                      if (r.method !== "cancelled") showToast("Exported a DECRYPTED copy to your device. Keep it safe.");
                    }}
                  >
                    <span className="sr-only">Export</span>
                  </Btn>
                </>
              )}
              {confirmDelete === item.id ? (
                <Btn
                  variant="solid-danger"
                  onClick={async () => {
                    await deleteItem(item.id);
                    setConfirmDelete(null);
                  }}
                >
                  Delete forever?
                </Btn>
              ) : (
                <Btn variant="danger" icon={Trash2} aria-label="Delete" onClick={() => setConfirmDelete(item.id)}>
                  <span className="sr-only">Delete</span>
                </Btn>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Vault(_: ProgramProps) {
  const { files, loading } = useFiles();
  const session = useVaultSession();
  const meta = readMeta(files);
  const plaintext = plaintextVaultFiles(files).length;
  const sealedCount = files.filter((f) => f.path.endsWith(SEALED_EXT)).length;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-[#0f0c0c] p-3 [&>*]:shrink-0">
      <ProgramHeader
        icon={meta ? Lock : ShieldAlert}
        color="#ff5050"
        title="SECRET BOX VAULT"
        chip={<SourceChip tone={!meta ? "danger" : session.key ? "warn" : "accent"}>{!meta ? "NOT ENCRYPTED" : session.key ? "UNLOCKED" : "AES-256-GCM"}</SourceChip>}
      />
      {loading ? (
        <Spinner label="Reading vault…" />
      ) : !meta ? (
        <Setup plaintextCount={plaintext} />
      ) : !session.key ? (
        <Unlock sealedCount={sealedCount} />
      ) : (
        <Unlocked cryptoKey={session.key} plaintextCount={plaintext} lastActivity={session.lastActivity} />
      )}
      <div className="mono mt-auto text-[9px] leading-4 text-white/35">
        The key exists only in memory while unlocked. Backups contain only ciphertext. Lost passphrases cannot be recovered.
      </div>
    </div>
  );
}
