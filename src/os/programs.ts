import {
  Box,
  Cpu,
  Diamond,
  FileText,
  Folder,
  Hammer,
  HardDrive,
  Layers,
  Leaf,
  Lock,
  Rocket,
  Scale,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export type ProgramId =
  | "terminal"
  | "compression"
  | "foam"
  | "singularity"
  | "theorypad"
  | "build"
  | "forge"
  | "logger"
  | "vault"
  | "kernel"
  | "memory"
  | "explorer"
  | "bonsai";

export interface ProgramProps {
  windowId: string;
  /** Optional launch arguments, e.g. `{ path }` for TheoryPad. */
  args?: Record<string, string>;
}

export interface ProgramInfo {
  title: string;
  short: string;
  icon: LucideIcon;
  color: string;
  desc: string;
  keywords: string;
  component: LazyExoticComponent<ComponentType<ProgramProps>>;
}

export const PROGRAMS: Record<ProgramId, ProgramInfo> = {
  terminal: {
    title: "System32 Terminal.exe",
    short: "Terminal",
    icon: Terminal,
    color: "#00FF88",
    desc: "Shell for your files",
    keywords: "cmd shell command line ls cat",
    component: lazy(() => import("../programs/Terminal")),
  },
  compression: {
    title: "Compression Engine.exe",
    short: "Compression",
    icon: Box,
    color: "#00FF88",
    desc: "gzip / deflate, verified",
    keywords: "zip gzip deflate compress decompress",
    component: lazy(() => import("../programs/Compression")),
  },
  foam: {
    title: "Foam Explorer.exe",
    short: "Foam",
    icon: Layers,
    color: "#5ee9ff",
    desc: "Your storage as bubbles",
    keywords: "bubbles map visualize disk usage",
    component: lazy(() => import("../programs/Foam")),
  },
  singularity: {
    title: "Singularity Viewer.dll",
    short: "Singularity",
    icon: Diamond,
    color: "#ff7ad1",
    desc: "One fingerprint for everything",
    keywords: "hash sha256 integrity verify fingerprint",
    component: lazy(() => import("../programs/Singularity")),
  },
  theorypad: {
    title: "TheoryPad.md",
    short: "TheoryPad",
    icon: FileText,
    color: "#ffe66a",
    desc: "Text editor, autosaves",
    keywords: "editor notes text markdown write",
    component: lazy(() => import("../programs/TheoryPad")),
  },
  build: {
    title: "Build Center",
    short: "Build",
    icon: Rocket,
    color: "#7cffc1",
    desc: "Version, offline & updates",
    keywords: "deploy version update install offline pwa",
    component: lazy(() => import("../programs/BuildCenter")),
  },
  forge: {
    title: "Artifact Forge",
    short: "Forge",
    icon: Hammer,
    color: "#ff8c42",
    desc: "Keep & run HTML artifacts",
    keywords: "artifact html run sandbox",
    component: lazy(() => import("../programs/ArtifactForge")),
  },
  logger: {
    title: "Brutal/Beautiful Logger",
    short: "Logger",
    icon: Scale,
    color: "#a78bfa",
    desc: "Brutal / beautiful journal",
    keywords: "journal diary log reframe",
    component: lazy(() => import("../programs/Logger")),
  },
  vault: {
    title: "Secret Box Vault",
    short: "Vault",
    icon: Lock,
    color: "#ff5050",
    desc: "AES-256 encrypted files",
    keywords: "secret encrypt password private",
    component: lazy(() => import("../programs/Vault")),
  },
  kernel: {
    title: "Kernel Monitor",
    short: "Kernel",
    icon: Cpu,
    color: "#00FF88",
    desc: "Live system & storage health",
    keywords: "task manager process performance fps memory storage persist",
    component: lazy(() => import("../programs/KernelMonitor")),
  },
  memory: {
    title: "Memory Map",
    short: "Memory",
    icon: HardDrive,
    color: "#5ee9ff",
    desc: "Storage, pods & backups",
    keywords: "backup restore export import qr paper pods",
    component: lazy(() => import("../programs/MemoryMap")),
  },
  explorer: {
    title: "File Explorer",
    short: "Explorer",
    icon: Folder,
    color: "#ffd27a",
    desc: "Browse & import files",
    keywords: "files folders browse upload",
    component: lazy(() => import("../programs/FileExplorer")),
  },
  bonsai: {
    title: "Bonsai.exe",
    short: "Bonsai",
    icon: Leaf,
    color: "#7cff9a",
    desc: "Private AI on your hardware",
    keywords: "ai chat ollama llm assistant",
    component: lazy(() => import("../programs/Bonsai")),
  },
};

export const PROGRAM_IDS = Object.keys(PROGRAMS) as ProgramId[];

export function isProgramId(value: string): value is ProgramId {
  return value in PROGRAMS;
}
