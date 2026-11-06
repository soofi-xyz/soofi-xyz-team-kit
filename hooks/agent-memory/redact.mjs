// Replaces secret values with [REDACTED:<kind>] before a message leaves the machine.
// Patterns are deliberately broad: a false positive costs a few characters of memory,
// a false negative leaks a credential into the shared graph.

const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i;

const PATTERNS = [
  ["private_key", /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g],
  // Connect credential bodies: {"profile": ..., "values": {...}} carry partner secrets.
  ["credential_values", /("values"\s*:\s*)\{[^{}]*\}/g, 1],
  ["aws_access_key_id", /\b(?:AKIA|ASIA|AROA|AIDA)[0-9A-Z]{16}\b/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["github_token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g],
  ["slack_token", /\bxox[abprse]-[A-Za-z0-9-]{10,}/g],
  ["api_key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g],
  ["google_api_key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["google_oauth_token", /\b(?:ya29\.[0-9A-Za-z_-]{20,}|1\/\/0[0-9A-Za-z_-]{20,})/g],
  ["bearer_token", /(\bBearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, 1],
  ["url_password", /(\b[a-z][a-z0-9+.-]{0,30}:\/\/[^\s:@/]+:)[^\s@/]+(?=@)/gi, 1],
  // key = value, key: value, "key": "value", x-api-key: value header.
  [
    "secret_assignment",
    /((?:["']?)(?:[A-Za-z0-9_-]{0,40}(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|private[_-]?key(?:[_-]?id)?|client[_-]?secret|x-api-key|authorization|credential))(?:["']?)\s*[:=]\s*)("[^"\s]{4,}"|'[^'\s]{4,}'|[^\s"',;}{)]{6,})/gi,
    1,
  ],
  // --token value, --password value command-line flags.
  ["secret_flag", /(--[A-Za-z0-9-]{0,40}(?:password|secret|token|api-key)\s+)([^\s-][^\s]{5,})/gi, 1],
];

// Values that must never reach the graph even when they match no pattern:
// the Prism key itself and every secret-looking environment variable.
export function knownSecretValues(env = process.env, extra = []) {
  const values = new Set(extra.filter((value) => typeof value === "string" && value.length >= 8));
  for (const [name, value] of Object.entries(env)) {
    if (typeof value === "string" && value.length >= 8 && SECRET_ENV_NAME.test(name)) values.add(value);
  }
  // Longest first, so a secret that contains another is replaced whole.
  return [...values].sort((a, b) => b.length - a.length);
}

export function redact(text, secrets = []) {
  if (typeof text !== "string" || text.length === 0) return { text: text ?? "", count: 0 };
  let count = 0;
  let out = text;
  for (const secret of secrets) {
    if (!out.includes(secret)) continue;
    const parts = out.split(secret);
    count += parts.length - 1;
    out = parts.join("[REDACTED:env_secret]");
  }
  for (const [kind, pattern, keepGroup] of PATTERNS) {
    out = out.replace(pattern, (match, ...groups) => {
      const kept = keepGroup ? groups[keepGroup - 1] : "";
      const value = match.slice(kept.length);
      if (value.startsWith("[REDACTED:") || value.startsWith('"[REDACTED:')) return match;
      count += 1;
      return `${kept}[REDACTED:${kind}]`;
    });
  }
  return { text: out, count };
}
