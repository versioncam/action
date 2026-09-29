import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { directoriesUp, findRecorder, hasPublish, recorderVersion } from "./recorder.mjs";
import { INSTALL, prepare } from "./setup.mjs";

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
const root = mkdtempSync(join(tmpdir(), "versioncam-recorder-test-"));
after(() => rmSync(root, { recursive: true, force: true }));

/** A repository with an app in apps/web and versioncam where `at` says. */
function repository(name, { at = "apps/web", version = "0.3.0" } = {}) {
  const repo = join(root, name);
  mkdirSync(join(repo, "apps", "web"), { recursive: true });
  if (at !== null) {
    const bin = join(repo, at, "node_modules", ".bin");
    mkdirSync(bin, { recursive: true });
    mkdirSync(join(repo, at, "node_modules", "versioncam"), { recursive: true });
    writeFileSync(
      join(repo, at, "node_modules", "versioncam", "package.json"),
      JSON.stringify({ name: "versioncam", version }),
    );
    writeFileSync(join(bin, "versioncam"), "#!/bin/sh\n");
    chmodSync(join(bin, "versioncam"), 0o755);
  }
  return repo;
}

const helpOf = (version) => () => ({
  ok: true,
  stdout: fixture(version === "0.2.0" ? "help-0.2.0.txt" : "help-0.3.0.txt"),
  stderr: "",
});

function env(repo, extra = {}) {
  return {
    GITHUB_WORKSPACE: repo,
    RUNNER_TEMP: join(root, "temp"),
    VERSIONCAM_ACTION_MODE: "check",
    VERSIONCAM_ACTION_WORKING_DIRECTORY: "apps/web",
    VERSIONCAM_ACTION_INSTALL_BROWSER: "true",
    VERSIONCAM_ACTION_COMMENT: "true",
    ...extra,
  };
}
mkdirSync(join(root, "temp"), { recursive: true });

test("the search goes up to the repository's root and no further", () => {
  assert.deepEqual(directoriesUp("/w/repo/apps/web", "/w/repo"), [
    "/w/repo/apps/web",
    "/w/repo/apps",
    "/w/repo",
  ]);
  // Outside the checkout, or with no checkout, it goes to the root.
  assert.deepEqual(directoriesUp("/elsewhere/app", "/w/repo"), ["/elsewhere/app", "/elsewhere", "/"]);
  assert.deepEqual(directoriesUp("/a", null), ["/a", "/"]);
});

test("the app's own versioncam is found, or one hoisted to the repository's root", () => {
  const own = repository("own");
  assert.equal(findRecorder(join(own, "apps/web"), own).root, join(own, "apps/web"));
  const hoisted = repository("hoisted", { at: "." });
  assert.equal(findRecorder(join(hoisted, "apps/web"), hoisted).root, hoisted);
  const none = repository("none", { at: null });
  assert.equal(findRecorder(join(none, "apps/web"), none), null);
});

test("the version is read from the package beside the binary", () => {
  const repo = repository("versioned", { version: "0.3.1" });
  assert.equal(recorderVersion(join(repo, "apps/web")), "0.3.1");
  assert.equal(recorderVersion(join(root, "nowhere")), null);
});

test("0.3.0's help lists publish, and 0.2.0's does not", () => {
  assert.equal(hasPublish(fixture("help-0.3.0.txt")), true);
  assert.equal(hasPublish(fixture("help-0.2.0.txt")), false);
  // A sentence that merely mentions the word is not the command.
  assert.equal(hasPublish("run versioncam check, then publish it"), false);
});

test("setup hands on the repository's versioncam and a directory of the run's own", () => {
  const repo = repository("ready");
  const outputs = prepare(env(repo), { cwd: repo, help: helpOf("0.3.0") });
  assert.equal(outputs.bin, join(repo, "apps/web/node_modules/.bin/versioncam"));
  assert.ok(statSync(outputs.dir).isDirectory());
  assert.ok(outputs.dir.startsWith(join(root, "temp")));
  assert.equal(outputs["storage-state"], "");
});

test("setup writes a saved session where only this user can read it", () => {
  const repo = repository("session");
  const session = '{"cookies":[],"origins":[]}';
  const outputs = prepare(env(repo, { VERSIONCAM_ACTION_STORAGE_STATE: session }), {
    cwd: repo,
    help: helpOf("0.3.0"),
  });
  assert.equal(readFileSync(outputs["storage-state"], "utf8"), session);
  assert.equal(statSync(outputs["storage-state"]).mode & 0o777, 0o600);
});

test("setup stops with one sentence for each thing that is wrong", () => {
  const repo = repository("stops");
  const stops = (extra, help = helpOf("0.3.0"), where = repo) => {
    try {
      prepare(env(where, extra), { cwd: where, help });
    } catch (stop) {
      return stop.message;
    }
    assert.fail("setup did not stop");
  };

  assert.equal(stops({ VERSIONCAM_ACTION_MODE: "record" }), 'mode must be check, not "record".');
  assert.equal(stops({ VERSIONCAM_ACTION_COMMENT: "yes" }), 'comment must be true or false, not "yes".');
  assert.equal(
    stops({ VERSIONCAM_ACTION_WORKING_DIRECTORY: "apps/api" }),
    'working-directory "apps/api" is not a directory in this checkout: run actions/checkout first, and give the path from the repository\'s root.',
  );

  const empty = repository("empty", { at: null });
  assert.equal(
    stops({}, helpOf("0.3.0"), empty),
    `No versioncam is installed in apps/web: add it to the app with \`${INSTALL}\`, and install the app's dependencies before this step.`,
  );

  const old = repository("old", { version: "0.2.0" });
  assert.equal(
    stops({}, helpOf("0.2.0"), old),
    `The versioncam in apps/web is 0.2.0, and this Action needs 0.3.0 or later: update it with \`${INSTALL}\`.`,
  );
});

test("a storage state that is not JSON is refused without being repeated", () => {
  const repo = repository("secret");
  const secret = "not json, and secret-cookie-value";
  try {
    prepare(env(repo, { VERSIONCAM_ACTION_STORAGE_STATE: secret }), { cwd: repo, help: helpOf("0.3.0") });
    assert.fail("setup did not stop");
  } catch (stop) {
    assert.match(stop.message, /^storage-state is not JSON/);
    assert.ok(!stop.message.includes("secret-cookie-value"));
  }
});

