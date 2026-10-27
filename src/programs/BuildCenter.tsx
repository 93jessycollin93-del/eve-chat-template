import { Download, ExternalLink, RefreshCw, Rocket } from "lucide-react";
import { useMemo, useState } from "react";
import { BUILD, commitUrl } from "../lib/build-info";
import { formatBytes } from "../lib/bytes";
import type { ProgramProps } from "../os/programs";
import { applyUpdate, checkForUpdate, promptInstall, usePwa } from "../os/pwa";
import { Btn, Card, Notice, ProgramHeader, SourceChip, Stat } from "../ui/ui";

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export default function BuildCenter(_: ProgramProps) {
  const pwa = usePwa();
  const [msg, setMsg] = useState("");
  const [checking, setChecking] = useState(false);
  const url = commitUrl();

  const assets = useMemo(() => {
    const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
    return entries
      .filter((e) => e.name.startsWith(location.origin) && /\.(js|css|woff2|svg|png)(\?|$)/.test(e.name))
      .map((e) => ({
        name: e.name.slice(location.origin.length),
        bytes: e.transferSize || e.encodedBodySize || 0,
        cached: e.transferSize === 0 && e.decodedBodySize > 0,
        ms: Math.round(e.duration),
      }))
      .sort((a, b) => b.bytes - a.bytes);
  }, []);
  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto bg-[#0c1210] p-3 [&>*]:shrink-0">
      <ProgramHeader icon={Rocket} color="#7cffc1" title="BUILD CENTER — the build you are running" chip={<SourceChip>{pwa.needRefresh ? "update ready" : "live"}</SourceChip>} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Version" value={`v${BUILD.version}`} />
        <Stat
          label="Commit"
          value={
            url ? (
              <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline decoration-white/30">
                {BUILD.shortCommit} <ExternalLink size={10} />
              </a>
            ) : (
              BUILD.shortCommit
            )
          }
        />
        <Stat label="Built" value={new Date(BUILD.builtAt).toLocaleDateString()} hint={new Date(BUILD.builtAt).toLocaleTimeString()} />
        <Stat label="Mode" value={pwa.installed ? "Installed app" : "Browser tab"} hint={location.host} />
      </div>

      <Card className="space-y-2">
        <div className="mono text-[11px] font-semibold">Offline &amp; updates</div>
        <div className="mono text-[10px] leading-5 text-white/65">
          <div>Service worker: {!pwa.supported ? "not supported by this browser" : pwa.registered ? "registered" : "not registered (normal in development)"}</div>
          <div>Offline: {pwa.offlineReady ? "ready — the app opens without a connection" : "not cached yet"}</div>
          <div>Update: {pwa.needRefresh ? "a newer version has been downloaded" : "none waiting"}{pwa.lastCheck ? ` (checked ${new Date(pwa.lastCheck).toLocaleTimeString()})` : ""}</div>
          {pwa.error && <div className="text-red-300">Error: {pwa.error}</div>}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {pwa.needRefresh ? (
            <Btn variant="primary" icon={Download} onClick={() => void applyUpdate()}>
              Install update and reload
            </Btn>
          ) : (
            <Btn
              icon={RefreshCw}
              disabled={checking}
              onClick={async () => {
                setChecking(true);
                setMsg(await checkForUpdate().catch((e: unknown) => String(e)));
                setChecking(false);
              }}
            >
              {checking ? "Checking…" : "Check for updates"}
            </Btn>
          )}
        </div>
      </Card>

      <Card className="space-y-2">
        <div className="mono text-[11px] font-semibold">Install on this device</div>
        {pwa.installed ? (
          <div className="mono text-[10px] text-accent">Running as an installed app.</div>
        ) : pwa.canInstall ? (
          <Btn variant="soft" onClick={async () => setMsg(await promptInstall())}>
            Install Sovereign Foundry
          </Btn>
        ) : isIos() ? (
          <div className="mono text-[10px] leading-5 text-white/65">
            On iPhone/iPad: open this page in Safari, tap Share, then “Add to Home Screen”. Installed apps get their own storage that iOS is much less likely to clear.
          </div>
        ) : (
          <div className="mono text-[10px] leading-5 text-white/65">Use your browser menu’s “Install app” or “Add to Home screen”.</div>
        )}
      </Card>

      {msg && <Notice>{msg}</Notice>}

      <Card className="space-y-1.5">
        <div className="mono text-[11px] font-semibold">How deploys work</div>
        <div className="mono text-[10px] leading-5 text-white/65">
          This OS is a static site. Each push to the main branch runs lint, type checks, tests and a production build in CI, and your host (e.g. Vercel) publishes it. Your data never
          leaves this device — deploys only change the app, not your files.
        </div>
      </Card>

      <div className="overflow-hidden rounded-[12px] border border-white/10 bg-black">
        <div className="mono flex justify-between border-b border-white/10 px-3 py-2 text-[9px] text-white/50">
          <span>ASSETS THIS PAGE LOADED</span>
          <span>{nav ? `page ready in ${Math.round(nav.domContentLoadedEventEnd)} ms` : ""}</span>
        </div>
        {assets.length === 0 && <div className="mono px-3 py-2 text-[10px] text-white/40">No asset timings available.</div>}
        {assets.slice(0, 24).map((a) => (
          <div key={a.name} className="mono flex gap-2 border-b border-white/[0.04] px-3 py-1.5 text-[10px]">
            <span className="min-w-0 flex-1 truncate text-[#7cffc1]">{a.name}</span>
            <span className="text-white/60">{a.cached ? "cache" : formatBytes(a.bytes)}</span>
            <span className="w-14 text-right text-white/40">{a.ms} ms</span>
          </div>
        ))}
      </div>
    </div>
  );
}
