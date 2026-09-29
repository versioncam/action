#!/usr/bin/env node
/**
 * The token out of GitHub's answer to an OpenID Connect token request, onto
 * stdout and nowhere else: `{"count":…,"value":"<token>"}` in, the token out.
 *
 * A script rather than a pattern in the shell, so the answer is read as JSON;
 * and one that never repeats what it was given, because an error that quoted
 * its input could quote a token.
 */
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
});
process.stdin.on("end", () => {
  let value;
  try {
    value = JSON.parse(input).value;
  } catch {
    value = undefined;
  }
  if (typeof value !== "string" || value === "") {
    process.stderr.write("GitHub's answer to the token request had no token in it.\n");
    process.exitCode = 1;
    return;
  }
  process.stdout.write(value);
});
