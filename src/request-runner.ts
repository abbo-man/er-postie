import type {
  AuthSettings,
  KeyValue,
  RequestNode,
} from "./domain";
import { getJsonPath, resolveTemplate } from "./variables";

export interface RunResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  durationMs: number;
  curl: string;
  variables: Record<string, string>;
}

const enabledEntries = (
  entries: KeyValue[],
  variables: Record<string, string>,
): Array<[string, string]> =>
  entries
    .filter((entry) => entry.enabled && entry.key)
    .map((entry) => [
      resolveTemplate(entry.key, variables),
      resolveTemplate(entry.value, variables),
    ]);

export async function runRequest(
  request: RequestNode,
  initialVariables: Record<string, string>,
  auth?: AuthSettings,
): Promise<RunResult> {
  const prepared = prepareRequest(request, initialVariables, auth);
  const startedAt = performance.now();
  const response = await fetch(prepared.url, {
    method: prepared.method,
    headers: prepared.headers,
    body: prepared.body,
  });
  const responseBody = await response.text();
  const responseHeaders = Object.fromEntries(response.headers.entries());

  let parsedBody: unknown;
  if (response.ok) {
    for (const action of request.postActions) {
      if (!action.variable || !action.path) continue;
      let extracted: unknown;
      if (action.source === "header") {
        extracted = response.headers.get(action.path);
      } else {
        parsedBody ??= JSON.parse(responseBody);
        extracted = getJsonPath(parsedBody, action.path);
      }
      if (extracted === undefined || extracted === null) {
        throw new Error(`Could not extract ${action.source} path "${action.path}"`);
      }
      prepared.variables[action.variable] =
        typeof extracted === "string" ? extracted : JSON.stringify(extracted);
    }
  }

  return {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
    body: responseBody,
    durationMs: Math.round(performance.now() - startedAt),
    curl: toCurl(prepared),
    variables: prepared.variables,
  };
}

export function requestToCurl(
  request: RequestNode,
  variables: Record<string, string>,
  auth?: AuthSettings,
): string {
  return toCurl(prepareRequest(request, variables, auth));
}

interface PreparedRequest {
  url: URL;
  method: string;
  headers: Headers;
  body?: string;
  variables: Record<string, string>;
}

function prepareRequest(
  request: RequestNode,
  initialVariables: Record<string, string>,
  auth?: AuthSettings,
): PreparedRequest {
  const variables = { ...initialVariables };
  for (const action of request.preActions) {
    if (!action.variable) continue;
    if (action.remove) delete variables[action.variable];
    else variables[action.variable] = resolveTemplate(action.value, variables);
  }

  const url = new URL(resolveTemplate(request.url, variables));
  for (const [key, value] of enabledEntries(request.query, variables)) {
    url.searchParams.append(key, value);
  }

  const headers = new Headers(enabledEntries(request.headers, variables));
  if (auth) {
    headers.set(
      resolveTemplate(auth.headerName, variables),
      resolveTemplate(auth.value, variables),
    );
  }

  let body: string | undefined;
  if (request.protocol === "graphql") {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify({
      query: resolveTemplate(request.graphqlQuery, variables),
      variables: JSON.parse(
        resolveTemplate(request.graphqlVariables || "{}", variables),
      ) as unknown,
    });
  } else if (!["GET", "HEAD"].includes(request.method) && request.body) {
    body = resolveTemplate(request.body, variables);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  return {
    url,
    method: request.protocol === "graphql" ? "POST" : request.method,
    headers,
    body,
    variables,
  };
}

function toCurl(request: PreparedRequest): string {
  const parts = ["curl", "-X", request.method, quote(request.url.toString())];
  for (const [key, value] of request.headers.entries()) {
    parts.push("-H", quote(`${key}: ${value}`));
  }
  if (request.body !== undefined) {
    parts.push("--data-raw", quote(request.body));
  }
  return parts.join(" ");
}

const quote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`;
