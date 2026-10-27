export const BUILD = {
  version: __APP_VERSION__,
  commit: __COMMIT_SHA__,
  shortCommit: __COMMIT_SHA__ === "unknown" ? "unknown" : __COMMIT_SHA__.slice(0, 7),
  builtAt: __BUILD_TIME__,
  repoUrl: __REPO_URL__,
};

export function commitUrl(): string | null {
  if (!BUILD.repoUrl || BUILD.commit === "unknown") return null;
  return `${BUILD.repoUrl}/commit/${BUILD.commit}`;
}
