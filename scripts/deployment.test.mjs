import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { commitOf, deployment, stateOf, timeoutOf, waitForDeployment, waitForStatus } from "./deployment.mjs";
import { client } from "./github.mjs";

const dir = mkdtempSync(join(tmpdir(), "versioncam-deployment-test-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const HEAD = "1111111aaaaaaa";
const MERGE = "2222222bbbbbbb";

/**
 * GitHub's Deployments API, in memory: `script` is what it answers on each
 * poll, a list of deployments with their statuses, so a test can have a
 * deployment appear, wait and finish.
 */
function fakeGitHub(script) {
  let poll = 0;
  const calls = [];
  const fetch = async (url, init) => {
    const { pathname, searchParams } = new URL(url);
    calls.push(`${init.method} ${pathname}${searchParams.get("sha") ? `?sha=${searchParams.get("sha")}` : ""}`);
    // The statuses asked for after a poll's list belong to that poll.
    const at = pathname.endsWith("/statuses") ? poll - 1 : poll;
    const now = script[Math.min(at, script.length - 1)];
    const answer = (value, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    const statuses = pathname.match(/\/deployments\/(\d+)\/statuses$/);
    if (statuses) {
      const found = now.find((d) => d.id === Number(statuses[1]));
      return answer(found?.statuses ?? []);
    }
    if (pathname.endsWith("/deployments")) {
      poll += 1;
      return answer(now.map(({ statuses: _, ...d }) => d));
    }
    return answer({ message: "Not Found" }, 404);
  };
  return { fetch, calls, github: client({ token: "t", fetch }) };
}

/** A clock the test moves, and a sleep that moves it. */
function clock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

const preview = (id, statuses, environment = "Preview", created = `2026-11-10T10:0${id}:00Z`) => ({
  id,
  environment,
  created_at: created,
  statuses,
});

test("on a pull request the commit is the branch's head, not the merge commit", () => {
  const event = join(dir, "pull_request.json");
  writeFileSync(event, JSON.stringify({ pull_request: { head: { sha: HEAD } } }));
  assert.equal(commitOf({ GITHUB_EVENT_PATH: event, GITHUB_SHA: MERGE }), HEAD);
  const push = join(dir, "push.json");
  writeFileSync(push, JSON.stringify({ after: MERGE }));
  assert.equal(commitOf({ GITHUB_EVENT_PATH: push, GITHUB_SHA: MERGE }), MERGE);
});

test("waits while the deployment builds, then hands on its environment_url", async () => {
  const gh = fakeGitHub([
    [],
    [preview(1, [{ state: "pending" }])],
    [preview(1, [{ state: "in_progress" }, { state: "pending" }])],
    [
      preview(1, [
        { state: "success", environment_url: "https://app-abc123.vercel.app", target_url: "https://vercel.com/team/app/abc" },
        { state: "pending" },
      ]),
    ],
  ]);
  const lines = [];
  const url = await waitForDeployment({
    github: gh.github,
    repo: "o/r",
    sha: HEAD,
    environment: "Preview",
    timeoutMs: 15 * 60_000,
    ...clock(),
    log: (line) => lines.push(line),
  });
  assert.equal(url, "https://app-abc123.vercel.app");
  assert.equal(gh.calls[0], `GET /repos/o/r/deployments?sha=${HEAD}`);
  // One line per change, not one per poll.
  assert.deepEqual(lines, [
    'Waiting for a deployment of 1111111 to an environment starting with "Preview".',
    "Waiting for the Preview deployment of 1111111 (pending).",
    "Waiting for the Preview deployment of 1111111 (in_progress).",
    "The Preview deployment of 1111111 is ready after 45 s: https://app-abc123.vercel.app",
  ]);
});

test("takes target_url when the status has no environment_url", () => {
  assert.deepEqual(stateOf([{ state: "success", environment_url: "", target_url: "https://x.test" }]), {
    state: "ready",
    url: "https://x.test",
  });
});

test("a success later marked inactive is still the commit's deployment", () => {
  assert.deepEqual(
    stateOf([{ state: "inactive" }, { state: "success", environment_url: "https://old.test" }, { state: "pending" }]),
    { state: "ready", url: "https://old.test" },
  );
});

test("matches the environment as a prefix, ignoring case, and takes the newest", async () => {
  // A monorepo's host names one environment per project.
  const gh = fakeGitHub([
    [
      preview(1, [{ state: "success", environment_url: "https://web-1.test" }], "Preview - web", "2026-11-10T10:01:00Z"),
      preview(2, [{ state: "success", environment_url: "https://docs-old.test" }], "Preview - docs", "2026-11-10T10:02:00Z"),
      preview(3, [{ state: "success", environment_url: "https://docs-new.test" }], "Preview - docs", "2026-11-10T10:03:00Z"),
      preview(4, [{ state: "success", environment_url: "https://prod.test" }], "Production - docs", "2026-11-10T10:04:00Z"),
    ],
  ]);
  const url = await waitForDeployment({
    github: gh.github,
    repo: "o/r",
    sha: HEAD,
    environment: "preview - DOCS",
    timeoutMs: 60_000,
    ...clock(),
    log: () => undefined,
  });
  assert.equal(url, "https://docs-new.test");
});

test("a failed deployment fails the step, with its log", async () => {
  const gh = fakeGitHub([[preview(1, [{ state: "failure", log_url: "https://vercel.com/team/app/abc/logs" }])]]);
  await assert.rejects(
    waitForDeployment({
      github: gh.github,
      repo: "o/r",
      sha: HEAD,
      environment: "Preview",
      timeoutMs: 60_000,
      ...clock(),
      log: () => undefined,
    }),
    {
      message:
        "The Preview deployment of 1111111 failed, so there is nothing to record against. Its log: https://vercel.com/team/app/abc/logs",
    },
  );
});

test("the time running out names the environments GitHub does have", async () => {
  const gh = fakeGitHub([[preview(1, [{ state: "success", environment_url: "https://p.test" }], "Production")]]);
  const time = clock();
  await assert.rejects(
    waitForDeployment({
      github: gh.github,
      repo: "o/r",
      sha: HEAD,
      environment: "Preview",
      timeoutMs: 2 * 60_000,
      ...time,
      log: () => undefined,
    }),
    {
      message:
        'No deployment of 1111111 to an environment starting with "Preview" was ready within 2 minutes. GitHub has these environments for this commit: Production. Set the deployment input to the one to record against.',
    },
  );
  // It stopped at the deadline, not after it.
  assert.ok(time.now() <= 2 * 60_000);
});

test("with no deployment at all, it says the host may not create them", async () => {
  const gh = fakeGitHub([[]]);
  await assert.rejects(
    waitForDeployment({
      github: gh.github,
      repo: "o/r",
      sha: HEAD,
      environment: "Preview",
      timeoutMs: 60_000,
      ...clock(),
      log: () => undefined,
    }),
    /GitHub has no deployment for this commit at all\. Check that your host creates GitHub deployments/,
  );
});

test("the timeout is minutes, 15 by default, and nothing else", () => {
  assert.equal(timeoutOf(""), 15);
  assert.equal(timeoutOf(undefined), 15);
  assert.equal(timeoutOf("2.5"), 2.5);
  assert.throws(() => timeoutOf("soon"), /deployment-timeout must be a number of minutes above 0, got "soon"/);
  assert.throws(() => timeoutOf("0"), /above 0/);
});

test("the step writes the address as its url output", async () => {
  const event = join(dir, "pr.json");
  writeFileSync(event, JSON.stringify({ pull_request: { head: { sha: HEAD } } }));
  const output = join(dir, "output");
  writeFileSync(output, "");
  const gh = fakeGitHub([[preview(1, [{ state: "success", environment_url: "https://app.test" }])]]);
  const saved = process.env.GITHUB_OUTPUT;
  process.env.GITHUB_OUTPUT = output;
  const write = process.stdout.write;
  process.stdout.write = () => true;
  try {
    await deployment(
      {
        VERSIONCAM_ACTION_DEPLOYMENT: "Preview",
        GITHUB_REPOSITORY: "o/r",
        GITHUB_SHA: MERGE,
        GITHUB_EVENT_PATH: event,
        GITHUB_TOKEN: "t",
      },
      { fetch: gh.fetch },
    );
  } finally {
    process.stdout.write = write;
    process.env.GITHUB_OUTPUT = saved;
  }
  assert.match(readFileSync(output, "utf8"), /^url<<(\S+)\nhttps:\/\/app\.test\n\1\n$/);
  assert.equal(gh.calls[0], `GET /repos/o/r/deployments?sha=${HEAD}`);
});

test("action.yml waits only for a check without a url, and an explicit url wins", () => {
  const yml = readFileSync(fileURLToPath(new URL("../action.yml", import.meta.url)), "utf8");
  assert.match(
    yml,
    /if: \(inputs\.deployment != '' \|\| inputs\.status-context != ''\) && inputs\.url == '' && inputs\.mode == 'check'/,
  );
  assert.match(yml, /VERSIONCAM_ACTION_URL: \$\{\{ inputs\.url \|\| steps\.deployment\.outputs\.url \}\}/);
});

/** A commit's statuses, in memory, one list per poll, newest first as GitHub gives them. */
function fakeStatuses(script) {
  let poll = 0;
  const fetch = async (url) => {
    const { pathname } = new URL(url);
    assert.match(pathname, /^\/repos\/o\/r\/commits\/\w+\/statuses$/);
    const now = script[Math.min(poll, script.length - 1)];
    poll += 1;
    return new Response(JSON.stringify(now), { status: 200, headers: { "content-type": "application/json" } });
  };
  return client({ token: "t", fetch });
}

test("waits for Netlify's status, and takes the address only from its success", async () => {
  // As Netlify reported on a real pull request on 2026-11-10: pending points
  // at Netlify's dashboard, success at the preview.
  const context = "netlify/vite-docs-main/deploy-preview";
  const github = fakeStatuses([
    [{ context: "ci/test", state: "success", target_url: "https://ci.test", created_at: "2026-11-10T10:00:00Z" }],
    [
      { context, state: "pending", target_url: "https://app.netlify.com/projects/vite-docs-main/deploys/6af2", created_at: "2026-11-10T10:01:00Z" },
    ],
    [
      { context, state: "success", target_url: "https://deploy-preview-24060--vite-docs-main.netlify.app", created_at: "2026-11-10T10:02:00Z" },
      { context, state: "pending", target_url: "https://app.netlify.com/projects/vite-docs-main/deploys/6af2", created_at: "2026-11-10T10:01:00Z" },
    ],
  ]);
  const lines = [];
  const url = await waitForStatus({
    github,
    repo: "o/r",
    sha: HEAD,
    context: "netlify/vite-docs-main/",
    timeoutMs: 60_000,
    ...clock(),
    log: (line) => lines.push(line),
  });
  assert.equal(url, "https://deploy-preview-24060--vite-docs-main.netlify.app");
  assert.deepEqual(lines, [
    'Waiting for a status of 1111111 whose context starts with "netlify/vite-docs-main/".',
    "Waiting for netlify/vite-docs-main/deploy-preview of 1111111 (pending).",
    "netlify/vite-docs-main/deploy-preview of 1111111 is ready after 30 s: https://deploy-preview-24060--vite-docs-main.netlify.app",
  ]);
});

test("a failed status fails the step, and running out of time names the contexts there are", async () => {
  const failed = fakeStatuses([
    [{ context: "netlify/site/deploy-preview", state: "failure", target_url: "https://app.netlify.com/x", created_at: "1" }],
  ]);
  await assert.rejects(
    waitForStatus({ github: failed, repo: "o/r", sha: HEAD, context: "netlify/", timeoutMs: 60_000, ...clock(), log: () => undefined }),
    { message: "The status netlify/site/deploy-preview of 1111111 says the deploy failed, so there is nothing to record against. Its page: https://app.netlify.com/x" },
  );
  const other = fakeStatuses([[{ context: "ci/test", state: "success", target_url: "https://ci.test", created_at: "1" }]]);
  await assert.rejects(
    waitForStatus({ github: other, repo: "o/r", sha: HEAD, context: "netlify/", timeoutMs: 60_000, ...clock(), log: () => undefined }),
    /The commit has these statuses: ci\/test\. Set the status-context input to the one your host reports\./,
  );
});

test("deployment and status-context together are refused", async () => {
  await assert.rejects(
    deployment({ VERSIONCAM_ACTION_DEPLOYMENT: "Preview", VERSIONCAM_ACTION_STATUS_CONTEXT: "netlify/", GITHUB_SHA: HEAD }),
    /not both/,
  );
});
