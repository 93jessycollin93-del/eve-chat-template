# Sovereign Foundry

A local-first personal OS that runs in your browser. Your files, an encrypted vault, a journal, paper backups, and a private AI that runs on your own hardware. No account, no server, no cloud AI.

It started as a single Claude artifact, the "Cybernetic OS". This repo rebuilds it as a real, tested, installable app: every program does what it says, and nothing is simulated.

## What each program actually does

| Program | What it does | Built on |
| --- | --- | --- |
| **System32 Terminal** | A shell over your files: `ls cd cat echo > >> touch mkdir mv cp rm -r tree find grep wc du df sha256sum open history`, tab completion, and a y/n prompt before deleting | IndexedDB |
| **Compression Engine** | Compress or decompress any text or file as gzip, zlib or raw deflate; shows the real ratio and verifies the round trip with SHA-256 | Compression Streams API |
| **Foam Explorer** | Your storage drawn as bubbles: one per file, sized by its bytes; tap folders to zoom in | d3 circle packing |
| **Singularity Viewer** | One SHA-256 fingerprint of every file and memory pod; detects changes, compares two devices, verifies backup files | WebCrypto |
| **TheoryPad** | Text editor for any file, autosaves, picks up edits made in other windows or tabs | IndexedDB |
| **Build Center** | The running version and commit, offline and update status, install to home screen, and the assets this page loaded | Service worker |
| **Artifact Forge** | Keeps HTML artifacts and runs them in a sandbox that cannot read your files | Sandboxed iframe |
| **Brutal/Beautiful Logger** | A journal where each entry pairs a hard truth with its reframe; saved as a file, exports to Markdown | `/Logs/brutal_beautiful.jsonl` |
| **Secret Box Vault** | Encrypts files and notes with a passphrase; names are encrypted too; locks itself after 5 minutes idle | AES-256-GCM + PBKDF2 |
| **Kernel Monitor** | Open windows as processes you can end, live frame rate and main-thread lag, memory and storage, and a button to make storage persistent | Performance + Storage APIs |
| **Memory Map** | Where your bytes live; full JSON backup and restore with fingerprint check; Bonsai memory pods; restore paper backups by camera, photo or text | IndexedDB, QR |
| **File Explorer** | Browse, import (text or binary), preview images, rename, delete, download, print small files as QR paper backups | IndexedDB |
| **Bonsai.exe** | Chat with a model on your own computer through Ollama; streams tokens; saves each exchange as a memory pod and can read recent pods back | Ollama |

### What changed from the original artifact

The artifact labelled some features `REAL` and others `SIMULATED`. Several `REAL` labels were not accurate either:

- **The vault was not encrypted.** It unlocked with any password containing "sovereign" and stored everything in plain text. It now uses AES-256-GCM, with a key derived from your passphrase (PBKDF2-SHA256, 600,000 rounds) that is never stored.
- **The QR codes could not be scanned back.** The hand-written encoder skipped alignment patterns and cut data off at about 62 bytes. Backups now use a standard QR library, a Base45 encoding sized for QR, and a checksum on every set. Old `F|…` text fragments still import.
- **Compression could fall back silently.** If the browser lacked Compression Streams, it returned the input unchanged and still reported success. It now says so.
- **Bonsai's "remembers pods" was only in the prompt.** Recent pods are now sent to the model when memory is on.
- **Several features were scripted.** The GCP deploy log, the kernel process list, the foam bubbles and the boot hardware ("Quantum Foam QF-9000", "64 ZB") are now real measurements. The boot screen probes this device; Kernel Monitor shows your open windows and live metrics.

Your writing is kept as starter files: the theory notes, the master prompt (it is encrypted when you set up the vault), and the three brutal/beautiful entries.

## Keeping your data safe

Everything lives in this browser's IndexedDB on this device. That gives you privacy, but it also means:

1. **Back up.** Memory Map → *Export full backup* gives you a JSON file with a fingerprint. Restoring checks the file has not been modified.
2. **Make storage persistent.** Kernel Monitor → *Make storage persistent* asks the browser not to evict your data. On iPhone, add the app to your Home Screen first: Safari can clear storage for sites you have not visited recently, but installed apps are much safer.
3. **Do not forget your vault passphrase.** There is no recovery.

**What the vault protects:** files at rest on the device and inside backups, including their names. **What it does not:** a compromised or malware-infected device while the vault is unlocked, or a weak passphrase.

## Running Bonsai (your local AI)

1. Install [Ollama](https://ollama.com).
2. Create the Bonsai model: `ollama create bonsai -f bridge/Modelfile` (based on `llama3.2:3b`). Or pick any installed model in the app.
3. Start the bridge in front of Ollama:
   ```bash
   BONSAI_KEY=$(openssl rand -hex 16) npm run bridge
   ```
   The bridge (`bridge/bonsai-bridge.mjs`, no dependencies) listens on `127.0.0.1:11435` and requires the key in an `X-Bonsai-Key` header. It answers the browser's CORS checks, so you do not need to set `OLLAMA_ORIGINS`, and it only exposes the chat endpoints.
4. In Bonsai.exe, set the endpoint to `http://localhost:11435` and paste the key.

**From your phone:** an https page cannot call a plain `http://` address on your network, so put the bridge behind an https tunnel:

```bash
cloudflared tunnel --url http://localhost:11435
```

Then paste the `https://….trycloudflare.com` URL and your key into Bonsai on the phone. Always use a key when the bridge is reachable from outside your computer; the bridge refuses to start on a network address without one.

Bridge settings: `BONSAI_PORT` (11435), `BONSAI_HOST` (127.0.0.1), `OLLAMA_URL` (http://127.0.0.1:11434), and `BONSAI_ORIGINS` (comma-separated, default `*`).

## Develop

Requires Node 20.19+.

```bash
npm install
npm run dev        # http://localhost:5173
npm run check      # lint + typecheck + tests + production build (what CI runs)
```

The project is React 19, TypeScript, Vite and Tailwind CSS 4, plus Vitest with `fake-indexeddb`. The service worker comes from `vite-plugin-pwa`.

```
src/lib/       storage, crypto, compression, backup, shell, Ollama client (unit-tested)
src/os/        boot, window manager, desktop, launcher, PWA state
src/programs/  the 13 programs (each loaded on demand)
src/ui/        shared components and QR helpers
bridge/        Bonsai bridge proxy, its tests, and the Ollama Modelfile
```

## Deploy

It is a static site: `npm run build` writes `dist/`. Any static host works. On Vercel, `vercel.json` pins the Vite build and output folder, so an existing project from the old template deploys without changing settings. The build records the commit it came from, and Build Center shows it. Set `VITE_REPO_URL` to make the commit link point at your repository.

Deploying only changes the app. Your files stay on each device.
