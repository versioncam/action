/**
 * The step scripts as the Action runs them: as processes, with the runner's
 * variables and files, judged by their exit status, their log and what they
 * leave in GITHUB_OUTPUT and GITHUB_STEP_SUMMARY.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
// Its real path: a step resolves the directory it runs in, and on macOS the
// temporary directory is behind a symlink.
const dir = realpathSync(mkdtempSync(join(tmpdir(), "versioncam-steps-test-")));
after(() => rmSync(dir, { recursive: true, force: true }));

/** Run one script as a step; its outputs, summary and log come back. */
function step(script, args, env = {}, input) {
  const output = join(dir, `output-${Math.random().toString(16).slice(2)}`);
  const summary = join(dir, `summary-${Math.random().toString(16).slice(2)}`);
  writeFileSync(output, "");
  writeFileSync(summary, "");
  const ran = spawnSync(process.execPath, [join(here, script), ...args], {
    cwd: env.cwd ?? dir,
    input,
    encoding: "utf8",
    env: {
      PATH: process.env.PATH,
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      RUNNER_TEMP: dir,
      ...env,
    },
  });
  const outputs = {};
  const text = readFileSync(output, "utf8");
  for (const [, name, value] of text.matchAll(/^([\w-]+)<<(\S+)\n([\s\S]*?)\n\2$/gm).map((m) => [m[0], m[1], m[3]])) {
    outputs[name] = value;
  }
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr, outputs, summary: readFileSync(summary, "utf8") };
}

test("setup runs the repository's versioncam to read its help, and hands it on", () => {
  const app = join(dir, "app");
  mkdirSync(join(app, "node_modules", ".bin"), { recursive: true });
  const bin = join(app, "node_modules", ".bin", "versioncam");
  const help = readFileSync(join(here, "fixtures", "help-0.3.0.txt"), "utf8");
  writeFileSync(bin, `#!/bin/sh\ncat <<'HELP'\n${help}HELP\n`);
  chmodSync(bin, 0o755);
  const ran = step("setup.mjs", [], {
    cwd: dir,
    GITHUB_WORKSPACE: dir,
    VERSIONCAM_ACTION_MODE: "check",
    VERSIONCAM_ACTION_WORKING_DIRECTORY: "app",
  });
  assert.equal(ran.status, 0, ran.stdout + ran.stderr);
  assert.equal(ran.outputs.bin, bin);
  assert.ok(existsSync(ran.outputs.dir));
  assert.equal(ran.outputs["storage-state"], "");
});

test("the summary step writes the summary and the headline", () => {
  const checked = step("summary.mjs", [
    "--mode", "check",
    "--report", join(here, "fixtures", "check-fail.json"),
    "--status", "1",
    "--working-directory", "test-app",
  ], { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1" });
  assert.equal(checked.status, 0);
  assert.match(checked.summary, /^### Versioncam: 1 of 1 clip no longer matches the app\n/);
  assert.equal(checked.outputs.headline, "1 of 1 clip no longer matches the app: first.");

});
