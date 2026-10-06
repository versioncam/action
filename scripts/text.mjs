/**
 * Everything the Action says in Markdown: the pull request comment, the job
 * summary of each mode, and the line a failing job ends with.
 *
 * Pure functions of a report and a little context, so that a test can hold
 * every sentence to this repository's rules: no long dashes, no code block a
 * message can break out of, and nothing longer than GitHub will take.
 */

/** GitHub refuses a comment over 65,536 characters; this leaves room. */
export const COMMENT_LIMIT = 60000;

/** Past this, a failure's message is cut; the job log keeps all of it. */
export const MESSAGE_LIMIT = 2000;

/** What the Action calls the two artifacts it uploads. */
export const FAILURES_ARTIFACT = "versioncam-failures";
export const RENDERS_ARTIFACT = "versioncam-renders";

/** "1 clip", "2 clips". */
export function count(n, noun) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** `.`, `./app/` and `app` as one spelling: `.` and `app`. */
export function directory(workingDirectory) {
  const trimmed = String(workingDirectory ?? "")
    .trim()
    .replace(/^(\.\/)+/, "")
    .replace(/\/+$/, "");
  return trimmed === "" || trimmed === "." ? "." : trimmed;
}

/**
 * The hidden line that finds this Action's comment again on the next run.
 * One per working directory, so two apps checked in one pull request keep a
 * comment each. An HTML comment may not contain two hyphens in a row.
 */
export function marker(workingDirectory) {
  const where = directory(workingDirectory).replace(/-{2,}/g, "-");
  return `<!-- versioncam-action check ${where} -->`;
}

/** The name a failing clip's picture has inside the failures artifact. */
export function pictureName(id) {
  return `${String(id).replace(/[^A-Za-z0-9._-]+/g, "-")}.png`;
}

/** Inline code that holds any text, backticks included. */
export function code(text) {
  const s = String(text);
  const runs = s.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(0, ...runs.map((r) => r.length)) + 1);
  const pad = s.startsWith("`") || s.endsWith("`") ? " " : "";
  return `${fence}${pad}${s}${pad}${fence}`;
}

/** A fenced block that no line of the message can close early. */
export function block(text) {
  const s = String(text);
  const runs = s.match(/`+/g) ?? [];
  const fence = "`".repeat(Math.max(2, ...runs.map((r) => r.length)) + 1);
  return `${fence}text\n${s}\n${fence}`;
}

/** A message as the Action shows it: trimmed, and cut when it is very long. */
export function message(text) {
  const s = String(text ?? "").trim() || "(no message)";
  if (s.length <= MESSAGE_LIMIT) return s;
  return `${s.slice(0, MESSAGE_LIMIT)}\n[cut here: the job log has the whole message]`;
}

/** Text for a table cell: one line, and no pipe to end the cell early. */
function cell(text) {
  return String(text).replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

function link(label, url) {
  return url ? `[${label}](${url})` : label;
}

/**
 * The last line: what was done where, and the run that did it. `did` is the
 * start of the sentence: "Checked with versioncam 0.3.0 in".
 */
function footer(did, context) {
  const run = context.runUrl ? ` (${link("the run", context.runUrl)})` : "";
  return `<sub>${did} ${code(directory(context.workingDirectory))}${run}.</sub>`;
}

function checkedWith(recorder) {
  return recorder ? `Checked with versioncam ${recorder} in` : "Checked in";
}

/**
 * Where a failing clip stopped: the step as a person counts the lines of the
 * clip, from 1 at `s.open`. The report's index counts from 0, as the
 * timeline's `steps` do, so the step shown is the index plus one.
 */
export function stoppedAt(clip) {
  const at = typeof clip.t === "number" ? `, ${clip.t.toFixed(1)} s in` : "";
  if (clip.step && Number.isInteger(clip.step.index)) {
    return `stopped at step ${clip.step.index + 1}, ${code(clip.step.call)}${at}`;
  }
  if (clip.step === null) return `stopped before its first step${at}`;
  return `stopped${at}`;
}

function failedSection(clip, context) {
  const lines = [`**${code(clip.id)}** ${stoppedAt(clip)}:`, "", block(message(clip.message))];
  if (clip.picture) {
    const name = code(pictureName(clip.id));
    lines.push(
      "",
      context.artifactUrl
        ? `The page when it stopped: ${name} in ${link(FAILURES_ARTIFACT, context.artifactUrl)}.`
        : `The page when it stopped: ${name} (not uploaded).`,
    );
  }
  return lines.join("\n");
}

/** A mode's command ended without writing its report. */
function unfinished(command, context) {
  const log = context.runUrl ? link("The job log", context.runUrl) : "The job log";
  return `${code(`versioncam ${command}`)} stopped before it wrote its report. ${log} says why.`;
}

/**
 * The check, as the comment and the job summary both say it. `again` is for
 * the comment a passing run rewrites: the one that said clips had failed.
 */
export function checkText(report, context, { again = false } = {}) {
  if (!report) {
    return [
      "### Versioncam: the check did not finish",
      "",
      unfinished("check", context),
    ].join("\n");
  }

  const clips = report.clips ?? [];
  const failed = clips.filter((clip) => clip.status === "fail");
  const passed = clips.filter((clip) => clip.status !== "fail");

  if (failed.length === 0) {
    return [
      `### Versioncam: every clip matches the app${again ? " again" : ""}`,
      "",
      clips.length === 0
        ? "No clips were checked."
        : `${count(clips.length, "clip")} checked: ${passed.map((c) => code(c.id)).join(", ")}.`,
      "",
      footer(checkedWith(report.recorder), context),
    ].join("\n");
  }

  const verb = failed.length === 1 ? "matches" : "match";
  const head = [
    `### Versioncam: ${failed.length} of ${count(clips.length, "clip")} no longer ${verb} the app`,
  ];
  const tail = [];
  if (passed.length > 0) {
    tail.push(`Still matching: ${passed.map((c) => code(c.id)).join(", ")}.`, "");
  }
  tail.push(footer(checkedWith(report.recorder), context));

  // Every failing clip in full, until the text would be too long for a
  // comment; the job log names the rest.
  const budget =
    COMMENT_LIMIT - 500 - [...head, ...tail].join("\n").length;
  const sections = [];
  let used = 0;
  for (const clip of failed) {
    const section = failedSection(clip, context);
    if (used + section.length + 2 > budget) break;
    sections.push(section);
    used += section.length + 2;
  }
  const untold = failed.slice(sections.length);
  if (untold.length > 0) {
    sections.push(
      `And ${count(untold.length, "more clip")} failed. The job log has every one.`,
    );
  }

  return [...head, "", ...sections.flatMap((s) => [s, ""]), ...tail].join("\n");
}

/** The comment itself: the marker, then the check's text. */
export function commentBody(report, context, options) {
  return `${marker(context.workingDirectory)}\n${checkText(report, context, options)}\n`;
}

/** Whether a check report says every clip passed. */
export function checkPassed(report) {
  return Boolean(report) && (report.clips ?? []).every((c) => c.status !== "fail");
}

function basename(path) {
  return String(path).split(/[\\/]/).pop();
}

/** The render, for the job summary: each clip and its files. */
export function renderText(report, context) {
  if (!report) {
    return ["### Versioncam: nothing rendered", "", unfinished("render", context)].join("\n");
  }
  const rendered = report.rendered ?? [];
  const failed = report.failed ?? [];
  const title =
    rendered.length === 0
      ? "### Versioncam: nothing rendered"
      : `### Versioncam: ${count(rendered.length, "clip")} rendered` +
        (failed.length > 0 ? `, ${failed.length} failed` : "");
  const lines = [title, ""];

  if (rendered.length > 0) {
    lines.push("| Clip | Files |", "|---|---|");
    for (const clip of rendered) {
      const files = (clip.files ?? []).map((f) => code(basename(f))).join(", ");
      lines.push(`| ${cell(code(clip.id))} | ${cell(files)} |`);
    }
    lines.push("");
    if (report.sequence) {
      lines.push(`Stitched into one piece: ${code(basename(report.sequence))}.`, "");
    }
    lines.push(
      context.artifactUrl
        ? `Every file is in ${link(RENDERS_ARTIFACT, context.artifactUrl)}. A contact sheet shows eight frames of its clip at a glance.`
        : "The files were not uploaded.",
      "",
    );
  }
  for (const failure of failed) {
    lines.push(`**${code(failure.id)}** did not render:`, "", block(message(failure.message)), "");
  }
  lines.push(footer("Rendered in", context));
  return lines.join("\n");
}

/**
 * Whether the service said what a broken clip's pages play meanwhile. One
 * that says it keeps those pages quiet about the break, and the clip is
 * called broken; an older one, whose pages still say the clip is stale,
 * gives no `playing`, and its own word stays. A clip that never passed comes
 * with null, which is an answer too: JSON has no undefined.
 */
function namesPlaying(version) {
  return version.playing !== undefined;
}

/** What a published version's row says beside its check. */
function publishedNote(version) {
  const notes = [version.check];
  if (version.unchanged) notes.push("unchanged");
  if (version.stale) notes.push(namesPlaying(version) ? "broken" : "stale");
  if (version.refused) notes.push(`not stored: ${version.refused}`);
  return notes.join(", ");
}

/** The months, as a day in a sentence names them. */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * A time the service gave, ISO 8601 in UTC, as a sentence names its day:
 * "3 October", or "3 October 2025" when it is not the year of `now`. In UTC,
 * as the service keeps it and a runner's clock runs. Null for anything that
 * is not such a time, since `Date` makes a day of almost any string.
 */
export function dayOf(time, now) {
  if (typeof time !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(time)) return null;
  const at = new Date(time);
  if (Number.isNaN(at.getTime())) return null;
  const day = `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
  const year = at.getUTCFullYear();
  return now instanceof Date && now.getUTCFullYear() !== year ? `${day} ${year}` : day;
}

/**
 * An address from the service as the summary may print it: http or https,
 * and parsed, so that a space or another scheme never reaches the Markdown.
 * Null for anything else, and the line that would have linked it says less.
 */
function address(text) {
  if (typeof text !== "string") return null;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** A sentence that ends with an address when there is one, and a full stop when there is not. */
function pointing(sentence, url) {
  return url ? `${sentence}: ${url}` : `${sentence}.`;
}

/**
 * A version as a person names it: seven characters of its commit, as
 * version.cam's own pages do. The service's name for it, an id, only when
 * there is no commit to shorten.
 */
function versionName(playing) {
  if (typeof playing.commit === "string" && /^[0-9a-f]{7,}$/i.test(playing.commit)) {
    return playing.commit.slice(0, 7);
  }
  return typeof playing.version === "string" && playing.version !== "" ? playing.version : null;
}

/**
 * A clip broken on the default branch, and what its pages play meanwhile:
 * the last version that passed, or nothing, for a clip that never passed.
 * The service's `stale` is the default branch's word whichever branch this
 * run published, so the branch named is the default one, as the event names
 * it; a pull request's run is told that main is broken, not its own branch.
 */
function brokenLine(version, context) {
  const branch = context.defaultBranch ? code(context.defaultBranch) : "the default branch";
  const said = `**${code(version.clip)}** is broken on ${branch}.`;
  const playing = version.playing;
  if (!playing || typeof playing !== "object") {
    return `${said} No version of it has passed yet, so nothing plays.`;
  }
  const day = dayOf(playing.recordedAt, context.now);
  const name = versionName(playing);
  const which = day ? `the version from ${day}` : "the last version that passed";
  return `${said} Your pages keep playing ${which}${name ? ` (${code(name)})` : ""}.`;
}

/**
 * What the service says of the project as a whole, once each and only when
 * it says it: on a plan that tells nobody, what Pro would do about the clips
 * just named broken (on a publish with none, there is nothing for it to
 * do); that private clips play on no public page, and where that changes;
 * and where the project is managed. An older service, or a versioncam whose
 * report leaves these fields out, says none of them.
 */
function projectLines(report, broken, context) {
  const manage = address(report.manage);
  const page = manage ? manage.href.replace(/\/+$/, "") : null;
  // A page of the project's own, from its path: a query or a fragment on
  // the project's address belongs to that address, not to its settings.
  const settings = manage ? `${manage.origin}${manage.pathname.replace(/\/+$/, "")}/settings` : null;
  const lines = [];
  if (report.alerts === false && broken > 0) {
    const [owner] = String(report.project ?? "").split("/");
    const upgrade = manage
      ? `${manage.origin}/upgrade${owner ? `?account=${encodeURIComponent(owner)}` : ""}`
      : null;
    const them = broken === 1 ? "it is" : "they are";
    lines.push(
      pointing(`Pro tells your team by email or Slack and keeps track until ${them} fixed`, upgrade),
    );
  }
  if (report.visibility === "private") {
    // Like the repository only when the event says the repository is
    // private: the owner of a public one may have closed its clips.
    const like = context.repositoryPrivate === true ? ", like the repository" : "";
    lines.push(
      `These clips are private${like}. ` +
        pointing("To show them on a public page, make them public or unlisted", settings),
    );
  }
  if (page) lines.push(`Manage this project: ${page}`);
  return lines;
}

/**
 * The publish, for the job summary: each clip's living URL, then what the
 * service says beyond the table, each line only when its answer carries what
 * the line needs. For those lines `context` adds what the event says of the
 * repository, `defaultBranch` and `repositoryPrivate`, and `now`, for
 * whether a day needs its year.
 */
export function publishText(report, context) {
  if (!report) {
    return ["### Versioncam: nothing published", "", unfinished("publish", context)].join("\n");
  }
  const versions = report.versions ?? [];
  const lines = [
    `### Versioncam: ${count(versions.length, "clip")} published`,
    "",
    `To ${code(report.project)} on ${report.api}.`,
    "",
  ];
  if (versions.length > 0) {
    lines.push("| Clip | Living URL | This version | Check |", "|---|---|---|---|");
    for (const version of versions) {
      lines.push(
        `| ${cell(code(version.clip))} | ${cell(version.url)} | ${cell(link(version.version, version.versionUrl))} | ${cell(publishedNote(version))} |`,
      );
    }
    lines.push("");
  }
  const broken = versions.filter((version) => version.stale && namesPlaying(version));
  for (const version of broken) lines.push(brokenLine(version, context), "");
  for (const line of projectLines(report, broken.length, context)) lines.push(line, "");
  lines.push(footer("Published from", context));
  return lines.join("\n");
}

/** The living URLs of a publish, one a line: the `urls` output. */
export function livingUrls(report) {
  return (report?.versions ?? []).map((v) => v.url).filter(Boolean).join("\n");
}

/** The summary of any mode. */
export function summaryText(mode, report, context) {
  if (mode === "render") return renderText(report, context);
  if (mode === "publish") return publishText(report, context);
  return checkText(report, context);
}

/**
 * The one line a failing job ends with, as an annotation on the run. Empty
 * when the command succeeded.
 */
export function headline(mode, report, status) {
  if (status === 0) return "";
  if (!report) return `versioncam ${mode} did not finish; its output above says why.`;
  if (mode === "check") {
    const clips = report.clips ?? [];
    const failed = clips.filter((c) => c.status === "fail");
    const verb = failed.length === 1 ? "matches" : "match";
    if (failed.length > 0) {
      return `${failed.length} of ${count(clips.length, "clip")} no longer ${verb} the app: ${failed.map((c) => c.id).join(", ")}.`;
    }
  }
  if (mode === "render") {
    const failed = report.failed ?? [];
    if (failed.length > 0) {
      return `${count(failed.length, "clip")} did not render: ${failed.map((f) => f.id).join(", ")}.`;
    }
  }
  return `versioncam ${mode} failed; its output above says why.`;
}
