/** Scrubbing for anything that might reach a log line, a `--verbose` dump, or
 * an error message. The CLI holds a session bearer token and shells out to
 * `gh`, so both an `Authorization` header and a `ghp_…` token can plausibly
 * end up inside a string we're about to print. */

const MASK = "[redacted]";

/** Header names whose value is never printable, matched case-insensitively.
 * Kept as an allow-nothing list rather than a heuristic — a header either
 * carries a credential or it doesn't. */
const SECRET_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

export const isSecretHeader = (name: string): boolean => SECRET_HEADERS.has(name.toLowerCase());

/** Token shapes we know how to spot in free text. Ordered widest-first so a
 * longer match isn't partially consumed by a narrower pattern. */
const TOKEN_PATTERNS: readonly RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, // GitHub PAT / OAuth / server / refresh
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, // GitHub fine-grained PAT
  /\bsk-[A-Za-z0-9-]{20,}\b/g, // Generic provider secret key
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi, // Inline Authorization value
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, // JWT
];

/** Replaces every known credential shape in `text`. This is a safety net for
 * output that's already been assembled, not a substitute for keeping secrets
 * out of the string in the first place. */
export const redactSecrets = (text: string): string =>
  TOKEN_PATTERNS.reduce((scrubbed, pattern) => scrubbed.replace(pattern, MASK), text);

/** Rewrites `user:pass@host` and any credential-ish query parameter, leaving
 * the rest of the URL legible so it's still useful in a log. Input that
 * isn't a URL is passed through the free-text scrubber instead. */
export const redactUrl = (input: string): string => {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return redactSecrets(input);
  }

  if (url.username !== "" || url.password !== "") {
    url.username = url.username === "" ? "" : MASK;
    url.password = url.password === "" ? "" : MASK;
  }

  for (const key of [...url.searchParams.keys()]) {
    if (/token|secret|key|password|signature/i.test(key)) {
      url.searchParams.set(key, MASK);
    }
  }

  return url.toString();
};

/** Header map safe to print: secret headers are masked wholesale, everything
 * else still gets a pass through the token scrubber in case a credential was
 * copied somewhere it shouldn't have been. */
export const redactHeaders = (headers: Readonly<Record<string, string>>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      isSecretHeader(name) ? MASK : redactSecrets(value),
    ]),
  );
