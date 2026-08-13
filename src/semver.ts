/** Just enough semver to answer one question: is the server asking us to
 * upgrade? Pulling a full semver dependency in for a single comparison
 * would be the larger cost — this handles the `MAJOR.MINOR.PATCH[-pre]`
 * shape the release pipeline actually produces. */

export interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  /** Dot-separated prerelease identifiers, empty for a stable release. */
  readonly prerelease: readonly string[];
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Returns `undefined` rather than throwing: an unparseable version from the
 * server is a "skip the upgrade nag" condition, not a reason to fail the
 * command the user actually ran. */
export const parseVersion = (input: string): Version | undefined => {
  const match = VERSION_PATTERN.exec(input.trim());
  if (match === null) return undefined;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split("."),
  };
};

/** Per semver §11: numeric identifiers compare numerically, alphanumerics
 * lexically, numeric sorts below alphanumeric, and a longer identifier list
 * wins when all shared fields tie. */
const comparePrerelease = (a: readonly string[], b: readonly string[]): number => {
  // A version with no prerelease outranks one that has any.
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;

  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (left === right) continue;

    const leftNumeric = /^\d+$/.test(left);
    const rightNumeric = /^\d+$/.test(right);

    if (leftNumeric && rightNumeric) return Number(left) - Number(right);
    if (leftNumeric) return -1;
    if (rightNumeric) return 1;
    return left < right ? -1 : 1;
  }

  return a.length - b.length;
};

/** Negative when `a` precedes `b`, positive when it follows, zero on equal. */
export const compareVersions = (a: Version, b: Version): number =>
  a.major !== b.major
    ? a.major - b.major
    : a.minor !== b.minor
      ? a.minor - b.minor
      : a.patch !== b.patch
        ? a.patch - b.patch
        : comparePrerelease(a.prerelease, b.prerelease);

/** True when `latest` is strictly newer than `current`. Unparseable input on
 * either side answers false — see `parseVersion`. */
export const isUpgradeAvailable = (current: string, latest: string): boolean => {
  const parsedCurrent = parseVersion(current);
  const parsedLatest = parseVersion(latest);
  if (parsedCurrent === undefined || parsedLatest === undefined) return false;
  return compareVersions(parsedLatest, parsedCurrent) > 0;
};
