/**
 * The versioncam this repository installed, and whether it can do what the
 * Action asks of it.
 *
 * The Action never runs a versioncam the repository did not install. `npx
 * versioncam` would: with nothing installed, it downloads the latest from
 * npm. `npx --no` refuses to download, but it still asks the registry, and
 * still runs a versioncam installed globally or left in npx's cache, neither
 * of which is the one the repository pinned. So the Action looks where npm,
 * pnpm and Yarn put the binary, from the app's directory up to the
 * repository's root, and runs it by its path.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";

/**
 * The directories from `from` up to `stop`, both included. When `from` is not
 * inside `stop`, or there is no `stop`, they go up to the root.
 */
export function directoriesUp(from, stop) {
  const start = resolve(from);
  const top = stop ? resolve(stop) : null;
  const inside =
    top !== null &&
    (start === top ||
      (!relative(top, start).startsWith("..") &&
        !isAbsolute(relative(top, start))));
  const dirs = [];
  let dir = start;
  for (;;) {
    dirs.push(dir);
    if (inside && dir === top) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/**
 * The nearest `node_modules/.bin/versioncam` at or above `from`, with the
 * directory it was found in; null when there is none.
 */
export function findRecorder(from, stop) {
  for (const dir of directoriesUp(from, stop)) {
    const bin = join(dir, "node_modules", ".bin", "versioncam");
    if (existsSync(bin) && statSync(bin).isFile()) return { bin, root: dir };
  }
  return null;
}

/**
 * The installed version, for the sentence that says it is too old. Read from
 * the package beside the binary rather than through the binary's link, which
 * pnpm writes as a script rather than a link.
 */
export function recorderVersion(root) {
  try {
    const manifest = JSON.parse(
      readFileSync(join(root, "node_modules", "versioncam", "package.json"), "utf8"),
    );
    return manifest.name === "versioncam" && typeof manifest.version === "string"
      ? manifest.version
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether `versioncam --help` lists `publish`. The command arrived in 0.3.0
 * with `--report` on `check` and `render`, which every mode of the Action
 * reads, so it stands for all of 0.3.0: a capability, not a version number,
 * because a build of the recorder that has the command is what matters.
 */
export function hasPublish(help) {
  return /^\s*versioncam publish\b/m.test(help);
}
