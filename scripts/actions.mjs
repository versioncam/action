/**
 * The few things a step says to the runner, written the way the runner reads
 * them: outputs, the job summary, and annotations.
 *
 * GitHub's toolkit does this for JavaScript actions. This one is composite,
 * so its scripts would otherwise need a dependency for twenty lines, and the
 * repository's rule is that it has none.
 */
import { appendFileSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

/**
 * A workflow command's data, escaped so that a message cannot end the
 * command early or start another one on a new line.
 */
export function escapeData(text) {
  return String(text)
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
}

/** An error annotation on the run, and a line in the log. */
export function error(message, out = process.stdout) {
  out.write(`::error::${escapeData(message)}\n`);
}

/** A warning annotation: something the Action could not do, which fails nothing. */
export function warning(message, out = process.stdout) {
  out.write(`::warning::${escapeData(message)}\n`);
}

/**
 * A step output. Every value is written in the multi-line form, with a
 * delimiter the value does not contain, so a list of paths or a sentence
 * with a newline in it arrives whole.
 */
export function setOutput(name, value, file = process.env.GITHUB_OUTPUT) {
  if (!file) return;
  const text = String(value);
  let delimiter;
  do {
    delimiter = `versioncam_${randomBytes(8).toString("hex")}`;
  } while (text.includes(delimiter));
  appendFileSync(file, `${name}<<${delimiter}\n${text}\n${delimiter}\n`);
}

/**
 * Markdown for the job summary. Outside a runner there is no summary file,
 * and the text goes to the log instead, which is where a person running a
 * script by hand is looking.
 */
export function appendSummary(markdown, file = process.env.GITHUB_STEP_SUMMARY) {
  const text = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  if (file) appendFileSync(file, text);
  else process.stdout.write(text);
}

/** `--name value` flags, the only kind these scripts take. */
export function flags(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const name = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      values[name] = true;
    } else {
      values[name] = next;
      i++;
    }
  }
  return values;
}

/**
 * A report the recorder wrote, or null when there is none: the command
 * stopped before writing it, or was never run. A report that is there and
 * unreadable is null too; the command's own output says what went wrong.
 */
export function readJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** A command's exit status as the run step recorded it; null when unknown. */
export function parseStatus(value) {
  if (value === undefined || value === null || value === true) return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** This run's page, from the variables every job has; null outside a runner. */
export function runUrl(env = process.env) {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = env;
  return server && repo && run ? `${server}/${repo}/actions/runs/${run}` : null;
}

/** The pull request this run is for, from the event's payload; null otherwise. */
export function pullRequestNumber(env = process.env) {
  const event = readJson(env.GITHUB_EVENT_PATH);
  const number = event?.pull_request?.number;
  return Number.isInteger(number) ? number : null;
}

/**
 * What the event's payload says of the repository: its default branch, and
 * whether it is private. The runner's variables name the branch this run is
 * on, which on a pull request is not the default one. Null for whatever the
 * payload does not say, and for both outside a runner.
 */
export function repositoryOf(env = process.env) {
  const repository = readJson(env.GITHUB_EVENT_PATH)?.repository;
  const branch = repository?.default_branch;
  return {
    defaultBranch: typeof branch === "string" && branch !== "" ? branch : null,
    private: typeof repository?.private === "boolean" ? repository.private : null,
  };
}

/** Whether a module is the script node was asked to run, not an import. */
export function isMain(moduleUrl) {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return pathToFileURL(realpathSync(script)).href === moduleUrl;
  } catch {
    return false;
  }
}
