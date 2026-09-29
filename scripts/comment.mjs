#!/usr/bin/env node
/**
 * The pull request comment of a check. A failing check writes it, or
 * rewrites the one an earlier run wrote; a passing check rewrites that one to
 * say the clips match again, and writes nothing when there is none, because
 * nobody needs telling that nothing broke.
 *
 *   node comment.mjs --report <file> --status <exit status>
 *     [--artifact-url <url>] [--working-directory <dir>] [--dry-run]
 *
 * `--dry-run` prints what it would do and the comment, and calls nothing.
 * The token comes from GITHUB_TOKEN, and only this step has it.
 */
import {
  flags,
  isMain,
  parseStatus,
  pullRequestNumber,
  readJson,
  runUrl,
  warning,
} from "./actions.mjs";
import { client, upsertComment } from "./github.mjs";
import { checkPassed, commentBody, marker } from "./text.mjs";

export async function comment(argv, env, { out = process.stdout, fetch } = {}) {
  const args = flags(argv);
  const report = readJson(args.report);
  const status = parseStatus(args.status);
  const context = {
    workingDirectory: args["working-directory"] ?? ".",
    artifactUrl: typeof args["artifact-url"] === "string" ? args["artifact-url"] : null,
    runUrl: runUrl(env),
  };
  const failed = status !== 0 || !checkPassed(report);
  const body = commentBody(report, context, { again: !failed });
  const tag = marker(context.workingDirectory);
  const pr = pullRequestNumber(env);
  const where = pr ? `pull request #${pr}` : "the pull request";

  if (args["dry-run"]) {
    out.write(
      `Dry run, nothing sent. ${
        failed
          ? `Would write the comment on ${where}, or rewrite the one marked ${tag}:`
          : `Would rewrite the comment marked ${tag} on ${where}, if there is one, to:`
      }\n\n${body}`,
    );
    return;
  }
  if (env.GITHUB_EVENT_NAME !== "pull_request" || !pr) {
    out.write(
      `No comment: this run is for ${env.GITHUB_EVENT_NAME || "no event"}, not a pull request. The job summary has the result.\n`,
    );
    return;
  }
  if (!env.GITHUB_TOKEN) {
    warning("No comment on the pull request: github-token is empty. The job summary has the result.", out);
    return;
  }

  try {
    const github = client({ api: env.GITHUB_API_URL, token: env.GITHUB_TOKEN, fetch });
    const done = await upsertComment(github, {
      repo: env.GITHUB_REPOSITORY,
      issue: pr,
      marker: tag,
      body,
      create: failed,
    });
    out.write(
      done.action === "none"
        ? `No comment: every clip matches, and no earlier run on ${where} commented.\n`
        : `${done.action === "created" ? "Commented on" : "Rewrote the comment on"} ${where}: ${done.url}\n`,
    );
  } catch (failure) {
    // A comment that could not be written fails nothing: the check's own
    // result is the job's, and the summary says the same.
    warning(
      failure.status === 403
        ? `No comment on ${where}: the job's token may not write to it, which needs \`permissions: pull-requests: write\` and is never given to a pull request from a fork.`
        : `No comment on ${where}: ${String(failure.message).replace(/\.$/, "")}.`,
      out,
    );
  }
}

if (isMain(import.meta.url)) {
  await comment(process.argv.slice(2), process.env);
}
