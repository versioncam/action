#!/usr/bin/env node
/**
 * Wait for this commit's deployment, and hand its address to versioncam.
 *
 *   node deployment.mjs
 *
 * For an app that doesn't start in a runner, the one place it runs is the
 * preview or production deployment its host makes of each commit: Vercel,
 * and any host that reports to GitHub's Deployments API. The run step reads
 * the address from this step's `url` output and gives it to versioncam as
 * VERSIONCAM_BASE_URL, for the config to read.
 *
 * Which commit: on a pull request, the head of the branch, because that is
 * what the host built; GITHUB_SHA there is the merge commit GitHub made,
 * which nothing deploys. Otherwise GITHUB_SHA.
 *
 * Which deployment: the newest of that commit's whose environment starts
 * with the `deployment` input, ignoring case. A prefix, because a host
 * names environments per project in a monorepo.
 *
 * Or, with `status-context` instead, for a host that reports a commit
 * status rather than a deployment (Netlify: `netlify/<site>/deploy-preview`):
 * the newest status whose context starts with the input, until it is a
 * success, whose `target_url` is then the address. Only a success's: while
 * Netlify's is pending, its `target_url` is Netlify's dashboard.
 *
 * Inputs come from env, never from a template inside a script: the input
 * names, VERSIONCAM_ACTION_DEPLOYMENT, VERSIONCAM_ACTION_STATUS_CONTEXT and
 * VERSIONCAM_ACTION_DEPLOYMENT_TIMEOUT;
 * GitHub's GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, GITHUB_EVENT_PATH
 * and GITHUB_API_URL.
 */
import { error, isMain, readJson, setOutput } from "./actions.mjs";
import { client, GitHubError } from "./github.mjs";

/** How often GitHub is asked. A deployment takes minutes; this is a fraction of one. */
export const POLL_MS = 15_000;

/** The commit the host deployed for this run. */
export function commitOf(env) {
  const head = readJson(env.GITHUB_EVENT_PATH)?.pull_request?.head?.sha;
  return typeof head === "string" && head !== "" ? head : env.GITHUB_SHA;
}

/** Minutes from the input, checked; the default is 15. */
export function timeoutOf(value) {
  const text = String(value ?? "").trim();
  if (text === "") return 15;
  const minutes = Number(text);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error(`deployment-timeout must be a number of minutes above 0, got "${text}".`);
  }
  return minutes;
}

const short = (sha) => String(sha).slice(0, 7);

/**
 * A deployment's state, from its statuses, newest first as GitHub lists
 * them: the address of its newest success, a failure, or still waiting.
 *
 * A success that was later marked inactive is still a success: a host
 * marks the last deployment inactive when a newer one of the environment
 * succeeds, and a re-run of an older job should still find its own
 * commit's deployment, whose own address stays up.
 */
export function stateOf(statuses) {
  const newest = statuses[0];
  if (!newest) return { state: "waiting", detail: "no status yet" };
  if (newest.state === "failure" || newest.state === "error") {
    return { state: "failed", log: newest.log_url || newest.target_url || null };
  }
  const success = statuses.find((s) => s.state === "success");
  if (success && (newest.state === "success" || newest.state === "inactive")) {
    const url = success.environment_url || success.target_url;
    if (url) return { state: "ready", url };
    return { state: "failed", log: null, noUrl: true };
  }
  return { state: "waiting", detail: newest.state };
}

/**
 * Poll until the commit's deployment of `environment` succeeds, fails, or
 * the time is up. Returns its address; throws a sentence for the log.
 */
export async function waitForDeployment({
  github,
  repo,
  sha,
  environment,
  timeoutMs,
  pollMs = POLL_MS,
  now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = (line) => process.stdout.write(`${line}\n`),
}) {
  const started = now();
  const wanted = environment.toLowerCase();
  let said = "";
  let seen = [];
  for (;;) {
    const deployments = await github.call("GET", `/repos/${repo}/deployments?sha=${sha}&per_page=100`);
    const all = Array.isArray(deployments) ? deployments : [];
    seen = [...new Set(all.map((d) => d.environment))];
    // GitHub lists them newest first; sorted anyway, so a reordered answer
    // still picks the newest.
    const matching = all
      .filter((d) => typeof d.environment === "string" && d.environment.toLowerCase().startsWith(wanted))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    const deployment = matching[0];
    let line;
    if (deployment) {
      const statuses = await github.call("GET", `/repos/${repo}/deployments/${deployment.id}/statuses?per_page=100`);
      const found = stateOf(Array.isArray(statuses) ? statuses : []);
      if (found.state === "ready") {
        log(`The ${deployment.environment} deployment of ${short(sha)} is ready after ${seconds(now() - started)}: ${found.url}`);
        return found.url;
      }
      if (found.state === "failed") {
        throw new Error(
          found.noUrl
            ? `The ${deployment.environment} deployment of ${short(sha)} succeeded without an address, so there is nothing to record against. Set the Action's url input instead.`
            : `The ${deployment.environment} deployment of ${short(sha)} failed, so there is nothing to record against.` +
                (found.log ? ` Its log: ${found.log}` : ""),
        );
      }
      line = `Waiting for the ${deployment.environment} deployment of ${short(sha)} (${found.detail}).`;
    } else {
      line = `Waiting for a deployment of ${short(sha)} to an environment starting with "${environment}".`;
    }
    // Said when it changes, not on every poll, so the log stays readable.
    if (line !== said) {
      log(line);
      said = line;
    }
    if (now() - started + pollMs > timeoutMs) break;
    await sleep(pollMs);
  }
  const minutes = Math.round(timeoutMs / 60_000);
  throw new Error(
    `No deployment of ${short(sha)} to an environment starting with "${environment}" was ready within ${minutes} minute${minutes === 1 ? "" : "s"}. ` +
      (seen.length > 0
        ? `GitHub has these environments for this commit: ${seen.join(", ")}. Set the deployment input to the one to record against.`
        : "GitHub has no deployment for this commit at all. Check that your host creates GitHub deployments (Vercel does by default), or set the Action's url input instead."),
  );
}

/**
 * Poll until the commit's newest status whose context starts with
 * `context` succeeds, fails, or the time is up. Returns its `target_url`;
 * throws a sentence for the log.
 */
export async function waitForStatus({
  github,
  repo,
  sha,
  context,
  timeoutMs,
  pollMs = POLL_MS,
  now = Date.now,
  sleep = (ms) => new Promise((done) => setTimeout(done, ms)),
  log = (line) => process.stdout.write(`${line}\n`),
}) {
  const started = now();
  const wanted = context.toLowerCase();
  let said = "";
  let seen = [];
  for (;;) {
    const statuses = await github.call("GET", `/repos/${repo}/commits/${sha}/statuses?per_page=100`);
    const all = Array.isArray(statuses) ? statuses : [];
    seen = [...new Set(all.map((s) => s.context))];
    const status = all
      .filter((s) => typeof s.context === "string" && s.context.toLowerCase().startsWith(wanted))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    let line;
    if (status?.state === "success") {
      if (!status.target_url) {
        throw new Error(
          `The status ${status.context} of ${short(sha)} succeeded without an address, so there is nothing to record against. Set the Action's url input instead.`,
        );
      }
      log(`${status.context} of ${short(sha)} is ready after ${seconds(now() - started)}: ${status.target_url}`);
      return status.target_url;
    }
    if (status?.state === "failure" || status?.state === "error") {
      throw new Error(
        `The status ${status.context} of ${short(sha)} says the deploy failed, so there is nothing to record against.` +
          (status.target_url ? ` Its page: ${status.target_url}` : ""),
      );
    }
    line = status
      ? `Waiting for ${status.context} of ${short(sha)} (${status.state}).`
      : `Waiting for a status of ${short(sha)} whose context starts with "${context}".`;
    if (line !== said) {
      log(line);
      said = line;
    }
    if (now() - started + pollMs > timeoutMs) break;
    await sleep(pollMs);
  }
  const minutes = Math.round(timeoutMs / 60_000);
  throw new Error(
    `No status of ${short(sha)} whose context starts with "${context}" succeeded within ${minutes} minute${minutes === 1 ? "" : "s"}. ` +
      (seen.length > 0
        ? `The commit has these statuses: ${seen.join(", ")}. Set the status-context input to the one your host reports.`
        : "The commit has no status at all. Check that your host reports to GitHub, or set the Action's url input instead."),
  );
}

function seconds(ms) {
  const s = Math.round(ms / 1000);
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
}

export async function deployment(env, { fetch } = {}) {
  const environment = String(env.VERSIONCAM_ACTION_DEPLOYMENT ?? "").trim();
  const context = String(env.VERSIONCAM_ACTION_STATUS_CONTEXT ?? "").trim();
  if (environment && context) {
    throw new Error("Give the Action deployment or status-context, not both: each is a way to find the address.");
  }
  const minutes = timeoutOf(env.VERSIONCAM_ACTION_DEPLOYMENT_TIMEOUT);
  const github = client({ api: env.GITHUB_API_URL, token: env.GITHUB_TOKEN, fetch });
  const where = { github, repo: env.GITHUB_REPOSITORY, sha: commitOf(env), timeoutMs: minutes * 60_000 };
  const url = context
    ? await waitForStatus({ ...where, context })
    : await waitForDeployment({ ...where, environment });
  setOutput("url", url);
}

if (isMain(import.meta.url)) {
  deployment(process.env).catch((e) => {
    if (e instanceof GitHubError && (e.status === 403 || e.status === 404)) {
      const [what, permission] = process.env.VERSIONCAM_ACTION_STATUS_CONTEXT
        ? ["commit statuses", "statuses: read"]
        : ["deployments", "deployments: read"];
      error(
        `GitHub didn't let this job read the repository's ${what} (${e.message}). Add \`${permission}\` to the job's permissions.`,
      );
    } else {
      error(e.message);
    }
    process.exit(1);
  });
}
