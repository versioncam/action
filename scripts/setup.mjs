#!/usr/bin/env node
/**
 * The Action's first step: everything that can be wrong before versioncam
 * runs, each said in one sentence, before any time goes on a browser.
 *
 * The inputs arrive as VERSIONCAM_ACTION_* variables, the only way a
 * composite action hands its inputs to a script. The step writes three
 * outputs: `bin`, the repository's own versioncam; `dir`, a directory of this
 * run's own under the runner's temporary directory, where the report goes;
 * and `storage-state`, the path of the saved session written there, when one
 * was given.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { error, isMain, setOutput } from "./actions.mjs";
import { findRecorder, hasPublish, recorderVersion } from "./recorder.mjs";

export const MODES = ["check"];
export const INSTALL = "npm i -D versioncam@latest";

/** A problem the Action stops for, in the sentence it stops with. */
class Stop extends Error {}

/** "check", "check or render", "check, render or publish". */
function oneOf(words) {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
}

/** `versioncam --help`, run the way the Action will run everything else. */
function runHelp(bin, cwd) {
  try {
    const stdout = execFileSync(bin, ["--help"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 120_000,
    });
    return { ok: true, stdout, stderr: "" };
  } catch (failure) {
    return {
      ok: false,
      status: failure.status ?? failure.signal ?? failure.code,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
    };
  }
}

/** A directory as a sentence names it: relative to the checkout when inside it. */
function named(dir, workspace) {
  const rel = relative(workspace, dir);
  if (rel === "") return "the repository's root";
  return rel.startsWith("..") || isAbsolute(rel) ? dir : rel;
}

/**
 * Everything the step checks, in the order a person would want to hear
 * about it: the inputs, then the directory, then the recorder. Returns the
 * outputs, or throws the sentence to stop with.
 */
export function prepare(env, { cwd = process.cwd(), help = runHelp } = {}) {
  const mode = env.VERSIONCAM_ACTION_MODE ?? "";
  if (!MODES.includes(mode)) {
    throw new Stop(`mode must be ${oneOf(MODES)}, not "${mode}".`);
  }
  for (const [input, value] of [
    ["install-browser", env.VERSIONCAM_ACTION_INSTALL_BROWSER],
  ]) {
    if (value !== undefined && !/^(true|false)$/i.test(value)) {
      throw new Stop(`${input} must be true or false, not "${value}".`);
    }
  }

  // Parsed now, and never quoted: a parser's message would repeat what it
  // choked on, which here is a signed-in session.
  const session = (env.VERSIONCAM_ACTION_STORAGE_STATE ?? "").trim();
  if (session !== "") {
    try {
      JSON.parse(session);
    } catch {
      throw new Stop(
        "storage-state is not JSON: give it the contents of the session file `versioncam login` saved, from a secret, not the file's path.",
      );
    }
  }

  const given = env.VERSIONCAM_ACTION_WORKING_DIRECTORY || ".";
  const app = resolve(cwd, given);
  let isDirectory = false;
  try {
    isDirectory = statSync(app).isDirectory();
  } catch {
    isDirectory = false;
  }
  if (!isDirectory) {
    throw new Stop(
      `working-directory "${given}" is not a directory in this checkout: run actions/checkout first, and give the path from the repository's root.`,
    );
  }

  const workspace = env.GITHUB_WORKSPACE || cwd;
  const found = findRecorder(app, env.GITHUB_WORKSPACE || null);
  if (!found) {
    throw new Stop(
      `No versioncam is installed in ${named(app, workspace)}: add it to the app with \`${INSTALL}\`, and install the app's dependencies before this step.`,
    );
  }
  const where = named(found.root, workspace);
  const ran = help(found.bin, app);
  if (!ran.ok) {
    process.stderr.write(ran.stdout + ran.stderr);
    throw new Stop(
      `The versioncam in ${where} did not run: \`versioncam --help\` ended with ${ran.status}, and its output is above.`,
    );
  }
  if (!hasPublish(ran.stdout)) {
    const version = recorderVersion(found.root);
    throw new Stop(
      version
        ? `The versioncam in ${where} is ${version}, and this Action needs 0.3.0 or later: update it with \`${INSTALL}\`.`
        : `The versioncam in ${where} is older than 0.3.0, which this Action needs: update it with \`${INSTALL}\`.`,
    );
  }

  const dir = mkdtempSync(join(env.RUNNER_TEMP || tmpdir(), "versioncam-"));
  let storageState = "";
  if (session !== "") {
    // Readable by this user only, and removed by the Action's last step.
    storageState = join(dir, "storage-state.json");
    writeFileSync(storageState, session, { mode: 0o600 });
  }
  return { bin: found.bin, dir, "storage-state": storageState };
}

if (isMain(import.meta.url)) {
  try {
    const outputs = prepare(process.env);
    for (const [name, value] of Object.entries(outputs)) setOutput(name, value);
    process.stdout.write(`versioncam: ${outputs.bin}\n`);
  } catch (stop) {
    if (!(stop instanceof Stop)) throw stop;
    error(stop.message);
    process.exitCode = 1;
  }
}
