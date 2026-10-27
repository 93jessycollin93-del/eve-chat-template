import { useState } from "react";
import { startSync } from "./lib/fs";
import { Boot } from "./os/Boot";
import { Desktop } from "./os/Desktop";
import { OsProvider, useOs } from "./os/OsContext";

startSync();

function Shell() {
  const { hostName } = useOs();
  const [booted, setBooted] = useState(false);
  return booted ? <Desktop /> : <Boot host={hostName} onDone={() => setBooted(true)} />;
}

export default function App() {
  return (
    <OsProvider>
      <Shell />
    </OsProvider>
  );
}
