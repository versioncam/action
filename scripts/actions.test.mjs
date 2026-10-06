import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import {
  escapeData,
  flags,
  parseStatus,
  pullRequestNumber,
  readJson,
  repositoryOf,
  runUrl,
  setOutput,
} from "./actions.mjs";

const dir = mkdtempSync(join(tmpdir(), "versioncam-actions-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

test("a workflow command's data cannot end the command or start another", () => {
  assert.equal(escapeData("50% done\r\n::warning::x"), "50%25 done%0D%0A::warning::x");
});

test("an output is written whole, even with newlines, behind a delimiter it does not contain", () => {
  const file = join(dir, "output");
  writeFileSync(file, "");
  setOutput("files", "/a/one.png\n/a/two.png", file);
  setOutput("result", "pass", file);
  const text = readFileSync(file, "utf8");
  const [, name, delimiter, value] = text.match(/^(files)<<(\S+)\n([\s\S]*?)\n\2\n/);
  assert.equal(name, "files");
  assert.equal(value, "/a/one.png\n/a/two.png");
  assert.ok(!value.includes(delimiter));
  assert.match(text, /result<<(\S+)\npass\n\1\n$/);
});

test("flags take a value, an empty value, or stand alone", () => {
  assert.deepEqual(flags(["--report", "", "--status", "1", "--dry-run"]), {
    report: "",
    status: "1",
    "dry-run": true,
  });
});

test("an exit status is a number, or unknown", () => {
  assert.equal(parseStatus("0"), 0);
  assert.equal(parseStatus("1"), 1);
  assert.equal(parseStatus(""), null);
  assert.equal(parseStatus(undefined), null);
  assert.equal(parseStatus("x"), null);
});

test("a report that is not there, or not JSON, is null", () => {
  assert.equal(readJson(""), null);
  assert.equal(readJson(join(dir, "missing.json")), null);
  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{");
  assert.equal(readJson(broken), null);
});

test("the run's page and the pull request come from the runner's variables", () => {
  assert.equal(
    runUrl({ GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "7" }),
    "https://github.com/o/r/actions/runs/7",
  );
  assert.equal(runUrl({}), null);
  const event = join(dir, "event.json");
  writeFileSync(event, JSON.stringify({ pull_request: { number: 12 } }));
  assert.equal(pullRequestNumber({ GITHUB_EVENT_PATH: event }), 12);
  writeFileSync(event, JSON.stringify({ ref: "refs/heads/main" }));
  assert.equal(pullRequestNumber({ GITHUB_EVENT_PATH: event }), null);
});

test("the repository's default branch and privacy come from the event, or are unknown", () => {
  const event = join(dir, "event-repository.json");
  writeFileSync(event, JSON.stringify({ repository: { default_branch: "trunk", private: false } }));
  assert.deepEqual(repositoryOf({ GITHUB_EVENT_PATH: event }), { defaultBranch: "trunk", private: false });
  // A payload without a repository, one that says it oddly, and no payload.
  writeFileSync(event, JSON.stringify({ schedule: "0 6 * * *" }));
  assert.deepEqual(repositoryOf({ GITHUB_EVENT_PATH: event }), { defaultBranch: null, private: null });
  writeFileSync(event, JSON.stringify({ repository: { default_branch: "", private: "yes" } }));
  assert.deepEqual(repositoryOf({ GITHUB_EVENT_PATH: event }), { defaultBranch: null, private: null });
  assert.deepEqual(repositoryOf({}), { defaultBranch: null, private: null });
});
