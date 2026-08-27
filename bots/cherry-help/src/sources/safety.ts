const SENSITIVE_LINE_PATTERN =
  /\b(xoxb|xapp|sk_live|sk_test|ghp_|github_pat_|password\s*=|secret\s*=|token\s*=|api[_\s-]?key\s*=|client[_\s-]?secret\s*=|signing[_\s-]?secret\s*=)\b/i;

export function redactSensitiveLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => !SENSITIVE_LINE_PATTERN.test(line))
    .join('\n');
}
