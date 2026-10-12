// Anthropic's structured outputs (output_config.format, type "json_schema") accept only part of
// JSON Schema (platform.claude.com/docs/en/build-with-claude/structured-outputs, read 2026-10-12):
// no minLength/maxLength, no minimum/maximum/multipleOf, minItems only 0 or 1, no other array
// limits, and every object must have additionalProperties: false. Unsupported features return 400.
// So the schema sent is a reduced copy; our own validators still enforce the full rules afterwards.
// "pattern" (our ID formats) is dropped too: the professor schema with patterns was refused on the
// first live call (2026-10-12, HTTP 400 "The compiled grammar is too large"); the structural
// validator checks every ID on every answer, so the patterns are still enforced, just afterwards.
// A union of object shapes told apart by a constant "type" (the director's actions) is FLATTENED
// into one object: "type" from the list of variants, every other field optional. Patterns removed,
// the schema was still refused; flattening the actions was the change the provider accepted (schema
// probe, 2026-10-12). The strict Zod union still rejects a missing, wrong or foreign field afterwards.
// A map (an object whose keys are free, like calc_requests[].inputs) cannot be expressed with
// additionalProperties: false, so it is sent as a list of { name, value } pairs and turned back.

const DROP = new Set(["$schema", "pattern", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "maxItems", "uniqueItems", "propertyNames", "minProperties", "maxProperties"]);

export interface ReducedSchema {
  schema: object;
  /** Paths of maps sent as pairs ("*" for array items), to turn the answer back. */
  mapPaths: string[][];
}

export function toAnthropicSchema(input: object): ReducedSchema {
  const mapPaths: string[][] = [];
  const walk = (node: unknown, path: string[]): unknown => {
    if (Array.isArray(node)) return node.map((x) => walk(x, path));
    if (!node || typeof node !== "object") return node;
    const src = node as Record<string, unknown>;
    // A map: an object with free keys and a value schema. Sent as [{ name, value }].
    if (src.type === "object" && src.additionalProperties && typeof src.additionalProperties === "object" && !src.properties) {
      mapPaths.push(path);
      return {
        type: "array",
        items: { type: "object", properties: { name: { type: "string" }, value: walk(src.additionalProperties, []) }, required: ["name", "value"], additionalProperties: false },
      };
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (DROP.has(k)) continue;
      if (k === "minItems" && typeof v === "number" && v > 1) continue;
      if (k === "oneOf") {
        out.anyOf = (v as unknown[]).map((x) => walk(x, path));
        continue;
      }
      if (k === "properties") {
        out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, sub]) => [name, walk(sub, [...path, name])]));
        continue;
      }
      if (k === "items") {
        out.items = walk(v, [...path, "*"]);
        continue;
      }
      out[k] = walk(v, path);
    }
    if (out.type === "object") out.additionalProperties = false;
    const flat = flattenTagged(out.anyOf);
    if (flat) {
      delete out.anyOf;
      return { ...out, ...flat };
    }
    return out;
  };
  return { schema: walk(input, []) as object, mapPaths };
}

/** A union of closed object shapes, each with a constant "type", as one object; else null. */
function flattenTagged(anyOf: unknown): Record<string, unknown> | null {
  if (!Array.isArray(anyOf) || anyOf.length < 2) return null;
  const variants = anyOf as Array<{ type?: unknown; properties?: Record<string, { const?: unknown }> }>;
  if (!variants.every((v) => v.type === "object" && typeof v.properties?.type?.const === "string")) return null;
  const properties: Record<string, unknown> = { type: { type: "string", enum: variants.map((v) => v.properties!.type!.const) } };
  for (const v of variants)
    for (const [k, sub] of Object.entries(v.properties!)) {
      if (k === "type") continue;
      if (k in properties && JSON.stringify(properties[k]) !== JSON.stringify(sub)) return null; // a clash: leave the union as it is
      properties[k] = sub;
    }
  return { type: "object", properties, required: ["type"], additionalProperties: false };
}

/** Turn the pairs back into maps, so the answer has the shape our validators expect. */
export function fromAnthropicShape(value: unknown, mapPaths: string[][]): unknown {
  const at = (node: unknown, path: string[]): unknown => {
    if (path.length === 0) {
      if (!Array.isArray(node)) return node;
      return Object.fromEntries(node.filter((p) => p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string").map((p) => [(p as { name: string }).name, (p as { value: unknown }).value]));
    }
    const [head, ...rest] = path;
    if (head === "*") return Array.isArray(node) ? node.map((x) => at(x, rest)) : node;
    if (!node || typeof node !== "object" || Array.isArray(node) || !(head! in (node as object))) return node;
    return { ...(node as object), [head!]: at((node as Record<string, unknown>)[head!], rest) };
  };
  return mapPaths.reduce((v, p) => at(v, p), value);
}
