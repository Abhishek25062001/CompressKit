/**
 * The list of files in the bundled web build, written next to it by `scripts/sync-web.mjs` as
 * `build-files.json`. After Android unpacks the build, the app checks the result against this
 * list, so a file the packaging step dropped or cut short is reported by name at startup instead
 * of surfacing later as one tool that mysteriously fails.
 */

/** A path relative to the web folder, and its size in bytes. */
export type BuildFile = [path: string, size: number];

/** Reads `build-files.json`. Returns null when the text is not such a list. */
export function parseBuildFiles(json: string): BuildFile[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const files: BuildFile[] = [];
  for (const entry of parsed) {
    if (
      !Array.isArray(entry) ||
      typeof entry[0] !== 'string' ||
      typeof entry[1] !== 'number'
    )
      return null;
    files.push([entry[0], entry[1]]);
  }
  return files;
}

/**
 * Compares the list with what is on the device. `sizeOf` returns a file's size, or null when it
 * is not there. Each problem is a short line naming the file.
 */
export async function findUnpackProblems(
  files: BuildFile[],
  sizeOf: (path: string) => Promise<number | null>,
): Promise<string[]> {
  const problems: string[] = [];
  for (const [path, size] of files) {
    const found = await sizeOf(path);
    if (found === null) problems.push(`${path} is missing`);
    else if (found !== size)
      problems.push(`${path} is ${found} bytes, expected ${size}`);
  }
  return problems;
}

/** One sentence for the startup screen: the first few problems, and how many more there are. */
export function describeUnpackProblems(problems: string[]): string {
  const shown = problems.slice(0, 3).join('; ');
  const more = problems.length > 3 ? `; and ${problems.length - 3} more` : '';
  return `The tools did not unpack completely: ${shown}${more}.`;
}
