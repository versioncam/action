#!/usr/bin/env node
/**
 * The job summary of any mode, and the outputs that come from its report:
 * `urls` for publish, and `headline`, the line the Action's last step fails
 * the job with, escaped for the workflow command it goes into.
 *
 *   node summary.mjs --mode check --report <file> --status <exit status>
 *     [--artifact-url <url>] [--working-directory <dir>]
 */
import {
  appendSummary,
  escapeData,
  flags,
  isMain,
  parseStatus,
  readJson,
  runUrl,
  setOutput,
} from "./actions.mjs";
import { headline, livingUrls, summaryText } from "./text.mjs";

if (isMain(import.meta.url)) {
  const args = flags(process.argv.slice(2));
  const mode = args.mode;
  const report = readJson(args.report);
  const context = {
    workingDirectory: args["working-directory"] ?? ".",
    artifactUrl: typeof args["artifact-url"] === "string" ? args["artifact-url"] : null,
    runUrl: runUrl(),
  };
  appendSummary(summaryText(mode, report, context));
  if (mode === "publish") setOutput("urls", livingUrls(report));
  setOutput("headline", escapeData(headline(mode, report, parseStatus(args.status))));
}
