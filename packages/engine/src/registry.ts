import { ConceptSeed, SceneManifest, REVIEW_LABEL } from "@aili/schemas";

// Scene registry loading. Input is the parsed JSON of each file (the caller reads the files);
// output is either valid scenes or a list of readable errors. Nothing invalid gets through.

export interface RegistryResult {
  scenes: SceneManifest[];
  errors: string[];
}

export function validateRegistry(
  rawScenes: Array<{ file: string; data: unknown }>,
  rawConcepts: unknown,
  opts: { allowTestFixtures?: boolean } = {},
): RegistryResult {
  const errors: string[] = [];
  const conceptsParsed = ConceptSeed.array().safeParse(rawConcepts);
  if (!conceptsParsed.success) errors.push(`concepts: ${conceptsParsed.error.issues.map((i) => i.message).join("; ")}`);
  const conceptIds = new Set(conceptsParsed.success ? conceptsParsed.data.map((c) => c.id) : []);

  const scenes: SceneManifest[] = [];
  for (const { file, data } of rawScenes) {
    const parsed = SceneManifest.safeParse(data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) errors.push(`${file}: ${issue.path.join(".") || "(scene)"}: ${issue.message}`);
      continue;
    }
    const s = parsed.data;
    if (s.test_fixture && !opts.allowTestFixtures) {
      errors.push(`${file}: "${s.id}" is a test fixture and is refused outside development`);
      continue;
    }
    for (const c of s.teaches) if (!conceptIds.has(c)) errors.push(`${file}: teaches unknown concept "${c}"`);
    if (scenes.some((o) => o.id === s.id)) errors.push(`${file}: duplicate scene ID "${s.id}"`);
    else scenes.push(s);
  }
  return { scenes: errors.length ? [] : scenes, errors };
}

/**
 * Which scenes a build may show. Production excludes drafts unless the dev flag is set
 * (NEXT_PUBLIC_AILI_INCLUDE_DRAFTS=1). A draft that is shown is always labelled as a draft.
 */
export function visibleScenes(scenes: SceneManifest[], opts: { includeDrafts: boolean }): SceneManifest[] {
  return scenes.filter((s) => s.review_status !== "draft" || opts.includeDrafts);
}

export const includeDraftsFromEnv = (env: Record<string, string | undefined>) => env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS === "1";

/** The label every scene carries in the UI: "Draft (not expert-reviewed)" for drafts. */
export const reviewLabel = (s: Pick<SceneManifest, "review_status">) => REVIEW_LABEL[s.review_status];
