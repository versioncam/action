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
import { NEEDS_ID_TOKEN } from "./setup.mjs";

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

test("setup stops a publishing job without id-token: write with the one sentence", () => {
  const ran = step("setup.mjs", [], { VERSIONCAM_ACTION_MODE: "publish" });
  assert.equal(ran.status, 1);
  assert.equal(ran.stdout, `::error::${NEEDS_ID_TOKEN}\n`);
  assert.deepEqual(ran.outputs, {});
});

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

test("the token comes out of GitHub's answer, and nothing else does", () => {
  const ok = step("oidc.mjs", [], {}, JSON.stringify({ count: 1, value: "header.payload.sig" }));
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, "header.payload.sig");

  const bad = step("oidc.mjs", [], {}, '{"message":"eyJ-secret-looking-thing"');
  assert.equal(bad.status, 1);
  assert.equal(bad.stdout, "");
  assert.ok(!bad.stderr.includes("eyJ"));
});

test("a failing check's picture is uploaded under the clip's name", () => {
  const picture = join(dir, "recordings", "first", "failure.png");
  mkdirSync(join(dir, "recordings", "first"), { recursive: true });
  writeFileSync(picture, "png");
  const report = join(dir, "check.json");
  const failing = JSON.parse(readFileSync(join(here, "fixtures", "check-fail.json"), "utf8"));
  failing.clips[0].picture = picture;
  failing.clips.push({ id: "second", status: "pass" });
  writeFileSync(report, JSON.stringify(failing));

  const ran = step("files.mjs", ["--mode", "check", "--report", report, "--into", join(dir, "failures")]);
  assert.equal(ran.status, 0);
  assert.equal(ran.outputs.files, join(dir, "failures", "first.png"));
  assert.equal(readFileSync(join(dir, "failures", "first.png"), "utf8"), "png");
});

test("every file a render made is uploaded, and a missing report uploads nothing", () => {
  const out = join(dir, "out");
  mkdirSync(out, { recursive: true });
  const files = ["first.mp4", "first.webm", "first-poster.png", "first-sheet.png"].map((f) => join(out, f));
  for (const file of files) writeFileSync(file, "x");
  const report = join(dir, "render.json");
  writeFileSync(report, JSON.stringify({ outputDir: out, rendered: [{ id: "first", files }], sequence: null, failed: [] }));

  const ran = step("files.mjs", ["--mode", "render", "--report", report, "--into", join(dir, "unused")]);
  assert.equal(ran.outputs.files, files.join("\n"));

  const none = step("files.mjs", ["--mode", "render", "--report", "", "--into", join(dir, "unused")]);
  assert.equal(none.outputs.files, "");
  assert.match(none.stdout, /Nothing to upload/);
});

test("the summary step writes the summary, the headline and, for publish, the URLs", () => {
  const checked = step("summary.mjs", [
    "--mode", "check",
    "--report", join(here, "fixtures", "check-fail.json"),
    "--status", "1",
    "--artifact-url", "https://github.com/o/r/actions/runs/1/artifacts/2",
    "--working-directory", "test-app",
  ], { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "1" });
  assert.equal(checked.status, 0);
  assert.match(checked.summary, /^### Versioncam: 1 of 1 clip no longer matches the app\n/);
  assert.equal(checked.outputs.headline, "1 of 1 clip no longer matches the app: first.");

  const published = step("summary.mjs", ["--mode", "publish", "--report", join(here, "fixtures", "publish.json"), "--status", "0"]);
  assert.equal(published.outputs.headline, "");
  assert.equal(published.outputs.urls.split("\n").length, 2);
  assert.match(published.summary, /\| Clip \| Living URL \| This version \| Check \|/);
});

test("the summary step names the default branch and the repository's privacy as the event gives them", () => {
  // A pull request's run, on a repository whose default branch is trunk:
  // the broken clip is trunk's, whatever branch the run is on.
  const event = join(dir, "event-pull-request.json");
  writeFileSync(
    event,
    JSON.stringify({ pull_request: { number: 3 }, repository: { default_branch: "trunk", private: true } }),
  );
  const published = step(
    "summary.mjs",
    ["--mode", "publish", "--report", join(here, "fixtures", "publish-broken.json"), "--status", "0"],
    { GITHUB_EVENT_PATH: event, GITHUB_REF_NAME: "3/merge", GITHUB_HEAD_REF: "rename-the-button" },
  );
  assert.equal(published.status, 0, published.stdout + published.stderr);
  assert.match(published.summary, /^\*\*`add-a-book`\*\* is broken on `trunk`\. Your pages keep playing/m);
  assert.match(published.summary, /^These clips are private, like the repository\./m);
  assert.equal(published.outputs.urls.split("\n").length, 3);
});
