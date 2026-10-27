# Sovereign Foundry — notes for coding agents

A local-first browser OS (React 19 + TypeScript + Vite + Tailwind 4). All user data lives in IndexedDB on the device; there is no backend. The only server-side piece is the optional Bonsai bridge in `bridge/`, which the user runs on their own computer.

## Rules

- **Nothing fake.** Every number, status and log line shown to the user must come from a real measurement or real data. If a browser does not support something, say so in the UI; never fall back silently or invent a value.
- **Everything is a file.** Program data goes in the filesystem (`src/lib/fs.ts`) so that backups, the Singularity fingerprint, search and the terminal all see it. Memory pods are the one exception (their own IndexedDB store, still included in backups and the fingerprint).
- **Never weaken the vault.** Keys stay in memory only (`src/lib/vault-session.ts`). Plaintext must never be written to `/Vault` by app code. Multi-file vault changes go through one atomic `applyBatch`.
- **Destructive actions need confirmation** (delete, restore over existing files).
- Keep the original voice: titles like `System32 Terminal.exe` and the user's theory notes are part of the product.
- Mobile matters: the owner mostly uses an iPhone. Check layouts at 390px wide, use pointer events (not mouse-only), and respect the safe-area insets.

## Commands

```bash
npm run dev      # local dev server
npm run check    # lint + typecheck + unit tests + build — run before every push
npm run bridge   # Bonsai bridge (needs BONSAI_KEY)
```

Put logic in `src/lib/` with Vitest tests next to it (`*.test.ts`); keep components thin. Programs are registered in `src/os/programs.ts` and lazy-loaded.
