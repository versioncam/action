import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { comment } from "./comment.mjs";
import { client, findComment, GitHubError, upsertComment } from "./github.mjs";

/**
 * GitHub's issue comments, in memory, behind a fetch that records every call.
 */
function fakeGitHub(existing = [], { status = 200 } = {}) {
  const comments = existing.map((body, i) => ({ id: 100 + i, body, html_url: `https://github.com/o/r/pull/3#issuecomment-${100 + i}` }));
  const calls = [];
  const fetch = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    calls.push({ method: init.method, path: pathname, headers: init.headers, body: init.body });
    const answer = (code, value) =>
      new Response(JSON.stringify(value), { status: code, headers: { "content-type": "application/json" } });
    if (status !== 200) return answer(status, { message: "Resource not accessible by integration" });
    if (init.method === "GET") {
      const page = Number(searchParams.get("page"));
      return answer(200, comments.slice((page - 1) * 100, page * 100));
    }
    if (init.method === "POST") {
      const created = { id: 100 + comments.length, body: JSON.parse(init.body).body, html_url: `https://github.com/o/r/pull/3#issuecomment-${100 + comments.length}` };
      comments.push(created);
      return answer(201, created);
    }
    if (init.method === "PATCH") {
      const id = Number(pathname.split("/").pop());
      const found = comments.find((c) => c.id === id);
      found.body = JSON.parse(init.body).body;
      return answer(200, found);
    }
    return answer(404, { message: "Not Found" });
  };
  return { comments, calls, fetch };
}

const MARK = "<!-- versioncam-action check test-app -->";

test("the first failing run writes a comment", async () => {
  const gh = fakeGitHub(["looks good to me"]);
  const github = client({ api: "https://api.github.com", token: "t0ken", fetch: gh.fetch });
  const done = await upsertComment(github, { repo: "o/r", issue: 3, marker: MARK, body: `${MARK}\nfailed`, create: true });
  assert.equal(done.action, "created");
  assert.equal(gh.comments.length, 2);
  assert.deepEqual(gh.calls.map((c) => `${c.method} ${c.path}`), [
    "GET /repos/o/r/issues/3/comments",
    "POST /repos/o/r/issues/3/comments",
  ]);
  const { headers } = gh.calls[1];
  assert.equal(headers.authorization, "Bearer t0ken");
  assert.equal(headers["x-github-api-version"], "2022-11-28");
});

test("a later run rewrites the comment instead of adding another", async () => {
  const gh = fakeGitHub(["first!", `${MARK}\nfailed once`]);
  const github = client({ token: "t", fetch: gh.fetch });
  const done = await upsertComment(github, { repo: "o/r", issue: 3, marker: MARK, body: `${MARK}\nfailed twice`, create: true });
  assert.equal(done.action, "edited");
  assert.equal(gh.comments.length, 2);
  assert.equal(gh.comments[1].body, `${MARK}\nfailed twice`);
  assert.equal(gh.calls.at(-1).path, "/repos/o/r/issues/comments/101");
});

test("a passing run rewrites a comment that is there, and writes none otherwise", async () => {
  const quiet = fakeGitHub(["unrelated"]);
  const none = await upsertComment(client({ token: "t", fetch: quiet.fetch }), { repo: "o/r", issue: 3, marker: MARK, body: "passes", create: false });
  assert.equal(none.action, "none");
  assert.equal(quiet.calls.length, 1);

  const loud = fakeGitHub([`${MARK}\nfailed`]);
  const edited = await upsertComment(client({ token: "t", fetch: loud.fetch }), { repo: "o/r", issue: 3, marker: MARK, body: `${MARK}\npasses again`, create: false });
  assert.equal(edited.action, "edited");
  assert.equal(loud.comments[0].body, `${MARK}\npasses again`);
});

test("the marker is found on a later page, and another app's marker is not it", async () => {
  const bodies = Array.from({ length: 130 }, (_, i) => `comment ${i}`);
  bodies[5] = "<!-- versioncam-action check apps/admin -->\nother app";
  bodies[120] = `${MARK}\nthis one`;
  const gh = fakeGitHub(bodies);
  const found = await findComment(client({ token: "t", fetch: gh.fetch }), { repo: "o/r", issue: 3, marker: MARK });
  assert.equal(found.id, 220);
  assert.equal(gh.calls.length, 2);
});

test("GitHub's refusal comes back with its status, and without the token", async () => {
  const gh = fakeGitHub([], { status: 403 });
  const github = client({ token: "s3cret", fetch: gh.fetch });
  await assert.rejects(
    upsertComment(github, { repo: "o/r", issue: 3, marker: MARK, body: "x", create: true }),
    (error) => error instanceof GitHubError && error.status === 403 && !error.message.includes("s3cret"),
  );
});

const dir = mkdtempSync(join(tmpdir(), "versioncam-comment-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const fixture = new URL("./fixtures/check-fail.json", import.meta.url).pathname;

function prEnv(extra = {}) {
  const event = join(dir, "event.json");
  writeFileSync(event, JSON.stringify({ pull_request: { number: 3 } }));
  return {
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_EVENT_PATH: event,
    GITHUB_REPOSITORY: "o/r",
    GITHUB_TOKEN: "t",
    GITHUB_API_URL: "https://api.github.com",
    ...extra,
  };
}

function capture() {
  let text = "";
  return { write: (chunk) => (text += chunk), get text() { return text; } };
}

test("the comment step writes the failing check's text on the pull request", async () => {
  const gh = fakeGitHub();
  const out = capture();
  await comment(["--report", fixture, "--status", "1", "--working-directory", "test-app"], prEnv(), { out, fetch: gh.fetch });
  assert.match(out.text, /^Commented on pull request #3: https:\/\/github\.com\/o\/r\/pull\/3#issuecomment-100\n$/);
  assert.ok(gh.comments[0].body.startsWith(`${MARK}\n### Versioncam: 1 of 1 clip no longer matches the app`));
});

test("a push is not a pull request: no call, a line in the log", async () => {
  const gh = fakeGitHub();
  const out = capture();
  await comment(["--report", fixture, "--status", "1"], prEnv({ GITHUB_EVENT_NAME: "push" }), { out, fetch: gh.fetch });
  assert.equal(gh.calls.length, 0);
  assert.match(out.text, /^No comment: this run is for push, not a pull request\./);
});

test("a token that may not comment is a warning, never a failure", async () => {
  const gh = fakeGitHub([], { status: 403 });
  const out = capture();
  await comment(["--report", fixture, "--status", "1"], prEnv(), { out, fetch: gh.fetch });
  assert.match(out.text, /^::warning::No comment on pull request #3: .*`permissions: pull-requests: write`/);
});

test("a dry run prints the comment and calls nothing", async () => {
  const gh = fakeGitHub();
  const out = capture();
  await comment(["--dry-run", "--report", fixture, "--status", "1", "--working-directory", "test-app"], prEnv(), { out, fetch: gh.fetch });
  assert.equal(gh.calls.length, 0);
  assert.match(out.text, /^Dry run, nothing sent\. Would write the comment on pull request #3/);
  assert.ok(out.text.includes(`${MARK}\n### Versioncam: 1 of 1 clip no longer matches the app`));
});
