#!/usr/bin/env node
/**
 * What the Action uploads, from the report: the picture of the page each
 * failing clip stopped on, copied under the clip's name. Writes the `files`
 * output, one path a line, which is what actions/upload-artifact takes.
 *
 *   node files.mjs --mode check --report <file> --into <dir>
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { flags, isMain, readJson, setOutput } from "./actions.mjs";
import { pictureName } from "./text.mjs";

export function artifactFiles(mode, report, into) {
  if (!report) return [];
  if (mode === "check") {
    const files = [];
    for (const clip of report.clips ?? []) {
      if (clip.status !== "fail" || !clip.picture || !existsSync(clip.picture)) continue;
      // Every picture is called failure.png where the recorder left it. Under
      // the clip's name, one picture in the artifact says which clip it is.
      mkdirSync(into, { recursive: true });
      const copy = join(into, pictureName(clip.id));
      copyFileSync(clip.picture, copy);
      files.push(copy);
    }
    return files;
  }
  return [];
}

if (isMain(import.meta.url)) {
  const args = flags(process.argv.slice(2));
  const files = artifactFiles(args.mode, readJson(args.report), args.into);
  setOutput("files", files.join("\n"));
  process.stdout.write(
    files.length === 0
      ? "Nothing to upload.\n"
      : `To upload:\n${files.map((f) => `  ${f}`).join("\n")}\n`,
  );
}
