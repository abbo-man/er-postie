const VARIABLE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

export function resolveTemplate(
  input: string,
  variables: Record<string, string>,
): string {
  const generated = new Map<string, string>();
  const expanded = input.replace(
    /\{\{\s*\$(?:uuid|guid)(?::([A-Za-z_][\w.-]*))?\s*\}\}/gi,
    (_, name?: string) => {
      if (!name) return crypto.randomUUID();
      let value = generated.get(name);
      if (!value) {
        value = crypto.randomUUID();
        generated.set(name, value);
      }
      return value;
    },
  );

  const missing = new Set<string>();
  const value = expanded.replace(VARIABLE, (_, name: string) => {
    if (!(name in variables)) {
      missing.add(name);
      return "";
    }
    return variables[name] ?? "";
  });
  if (missing.size > 0) {
    throw new Error(`Missing variables: ${[...missing].join(", ")}`);
  }
  return value;
}

export function getJsonPath(value: unknown, path: string): unknown {
  return path
    .replace(/^\$\.?/, "")
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, part) => {
      if (current === null || typeof current !== "object") return undefined;
      return (current as Record<string, unknown>)[part];
    }, value);
}
