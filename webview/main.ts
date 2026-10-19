import "./style.css";
import type {
  Example,
  KeyValue,
  PostAction,
  PreAction,
  RequestNode,
} from "../src/domain";
import type { RunResult } from "../src/request-runner";

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void;
};

const vscode = acquireVsCodeApi();
const app = document.querySelector<HTMLElement>("#app");
let request: RequestNode;
let environmentName = "No environment";
let lastResult: RunResult | undefined;

window.addEventListener("message", ({ data }) => {
  if (data.type === "load") {
    request = data.request as RequestNode;
    environmentName = data.environmentName as string;
    render();
  } else if (data.type === "response") {
    lastResult = data.result as RunResult;
    renderResponse();
  } else if (data.type === "error") {
    renderError(data.message as string);
  } else if (data.type === "examples") {
    request.examples = data.examples as Example[];
    renderExamples();
  } else if (data.type === "composeExample") {
    document.querySelector("#examples-section")?.setAttribute("open", "");
    input("example-name").focus();
  } else if (data.type === "showExample") {
    const example = request.examples.find((item) => item.id === data.exampleId);
    if (example) showSaved(example);
  }
});

vscode.postMessage({ type: "ready" });

function render(): void {
  if (!app) return;
  app.innerHTML = `
    <div class="toolbar">
      <input id="name" value="${escape(request.name)}" aria-label="Request name">
      <span class="muted">${escape(environmentName)}</span>
      <div>
        <button class="secondary" id="copy-curl">Copy cURL</button>
        <button class="secondary" id="save">Save</button>
        <button id="send">Send</button>
      </div>
    </div>
    <div class="request-line">
      <select id="protocol">
        <option value="http" ${selected(request.protocol === "http")}>HTTP</option>
        <option value="graphql" ${selected(request.protocol === "graphql")}>GraphQL</option>
      </select>
      <select id="method" class="${request.protocol === "graphql" ? "hidden" : ""}">
        ${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]
          .map((method) => `<option ${selected(request.method === method)}>${method}</option>`)
          .join("")}
      </select>
      <input id="url" value="${escape(request.url)}" placeholder="{{baseUrl}}/users" aria-label="URL">
    </div>
    ${keyValueSection("Query parameters", "query", request.query)}
    ${keyValueSection("Headers", "headers", request.headers)}
    <details open>
      <summary>Authentication</summary>
      <div class="row">
        <select id="auth-mode">
          ${["inherit", "enabled", "disabled"]
            .map((mode) => `<option ${selected(request.auth.mode === mode)}>${mode}</option>`)
            .join("")}
        </select>
        <input id="auth-header" value="${escape(request.auth.headerName)}" placeholder="Authorization">
        <input id="auth-value" value="${escape(request.auth.value)}" placeholder="Bearer {{token}}">
      </div>
    </details>
    <details open id="http-body" class="${request.protocol === "graphql" ? "hidden" : ""}">
      <summary>JSON body</summary>
      <p class="muted">{{$uuid}} inserts a new UUID on send. {{$uuid:name}} repeats the same one in this body.</p>
      ${jsonEditor("body", request.body, '{"id":"{{$uuid}}"}')}
    </details>
    <details open id="graphql-body" class="${request.protocol === "graphql" ? "" : "hidden"}">
      <summary>GraphQL</summary>
      <label>Query</label>
      <textarea id="graphql-query" spellcheck="false">${escape(request.graphqlQuery)}</textarea>
      <label>Variables JSON</label>
      ${jsonEditor("graphql-variables", request.graphqlVariables, "{}")}
    </details>
    ${preActionsSection(request.preActions)}
    ${postActionsSection(request.postActions)}
    <details id="examples-section">
      <summary>Examples</summary>
      <div class="row">
        <input id="example-name" placeholder="Example name">
        <input id="example-status" value="200" inputmode="numeric" aria-label="Status">
      </div>
      ${jsonEditor("example-body", "", "Response body")}
      <button class="secondary" id="add-example">Add example</button>
      <div id="examples"></div>
    </details>
    <section class="response">
      <div class="response-meta">
        <strong>Response</strong>
        <span id="response-status" class="grow muted">Not sent</span>
      </div>
      <pre id="response-body"></pre>
    </section>`;
  bind();
  renderExamples();
  if (lastResult) renderResponse();
}

function bind(): void {
  byId("protocol").addEventListener("change", () => {
    sync();
    render();
  });
  byId("save").addEventListener("click", () => send("save"));
  byId("send").addEventListener("click", () => send("send"));
  byId("copy-curl").addEventListener("click", () => send("copyCurl"));
  document.querySelectorAll<HTMLTextAreaElement>("textarea.json-input").forEach(bindJsonEditor);
  byId("add-example").addEventListener("click", () => {
    const name = input("example-name").value.trim();
    const rawStatus = input("example-status").value.trim();
    const status = Number(rawStatus);
    const body = textarea("example-body")?.value ?? "";
    if (!name || !rawStatus || !Number.isInteger(status)) return;
    const headers =
      lastResult &&
      lastResult.status === status &&
      body === pretty(lastResult.body)
        ? lastResult.headers
        : {};
    vscode.postMessage({ type: "addExample", name, status, body, headers });
    input("example-name").value = "";
  });
  document.querySelectorAll<HTMLElement>("[data-add]").forEach((button) =>
    button.addEventListener("click", () => {
      sync();
      const target = button.dataset.add;
      if (target === "query" || target === "headers") {
        request[target].push({
          id: crypto.randomUUID(),
          key: "",
          value: "",
          enabled: true,
        });
      } else if (target === "preActions") {
        request.preActions.push({
          id: crypto.randomUUID(),
          variable: "",
          value: "",
          remove: false,
        });
      } else if (target === "postActions") {
        request.postActions.push({
          id: crypto.randomUUID(),
          variable: "",
          source: "json",
          path: "",
        });
      }
      render();
    }),
  );
  document.querySelectorAll<HTMLElement>("[data-remove]").forEach((button) =>
    button.addEventListener("click", () => {
      sync();
      const [target, index] = button.dataset.remove!.split(":");
      if (target === "query" || target === "headers") {
        request[target].splice(Number(index), 1);
      } else if (target === "preActions") {
        request.preActions.splice(Number(index), 1);
      } else if (target === "postActions") {
        request.postActions.splice(Number(index), 1);
      }
      render();
    }),
  );
}

function send(type: "save" | "send" | "copyCurl"): void {
  sync();
  vscode.postMessage({ type, request });
  if (type === "send") {
    text("response-status", "Sending…");
    text("response-body", "");
  }
}

function sync(): void {
  request.name = input("name").value.trim() || "Untitled request";
  request.protocol = select("protocol").value as RequestNode["protocol"];
  request.method = select("method").value as RequestNode["method"];
  request.url = input("url").value;
  request.auth = {
    mode: select("auth-mode").value as RequestNode["auth"]["mode"],
    headerName: input("auth-header").value,
    value: input("auth-value").value,
  };
  request.body = textarea("body")?.value ?? request.body;
  request.graphqlQuery = textarea("graphql-query")?.value ?? request.graphqlQuery;
  request.graphqlVariables =
    textarea("graphql-variables")?.value ?? request.graphqlVariables;
  request.query = readKeyValues("query");
  request.headers = readKeyValues("headers");
  request.preActions = readPreActions();
  request.postActions = readPostActions();
}

function readKeyValues(name: "query" | "headers"): KeyValue[] {
  return [...document.querySelectorAll<HTMLElement>(`[data-row="${name}"]`)].map(
    (row) => ({
      id: row.dataset.id!,
      enabled: row.querySelector<HTMLInputElement>('[data-field="enabled"]')!.checked,
      key: row.querySelector<HTMLInputElement>('[data-field="key"]')!.value,
      value: row.querySelector<HTMLInputElement>('[data-field="value"]')!.value,
    }),
  );
}

function readPreActions(): PreAction[] {
  return [...document.querySelectorAll<HTMLElement>('[data-row="preActions"]')].map(
    (row) => ({
      id: row.dataset.id!,
      variable: field(row, "variable"),
      value: field(row, "value"),
      remove: row.querySelector<HTMLInputElement>('[data-field="remove"]')!.checked,
    }),
  );
}

function readPostActions(): PostAction[] {
  return [
    ...document.querySelectorAll<HTMLElement>('[data-row="postActions"]'),
  ].map((row) => ({
    id: row.dataset.id!,
    variable: field(row, "variable"),
    source: field(row, "source") as PostAction["source"],
    path: field(row, "path"),
  }));
}

function keyValueSection(
  title: string,
  name: "query" | "headers",
  entries: KeyValue[],
): string {
  return `<details>
    <summary>${title}</summary>
    <div class="rows">${entries
      .map(
        (entry, index) => `<div class="row" data-row="${name}" data-id="${entry.id}">
          <input type="checkbox" data-field="enabled" ${checked(entry.enabled)}>
          <input data-field="key" value="${escape(entry.key)}" placeholder="Key">
          <input data-field="value" value="${escape(entry.value)}" placeholder="Value">
          <button class="secondary icon" data-remove="${name}:${index}" title="Remove">×</button>
        </div>`,
      )
      .join("")}</div>
    <button class="secondary" data-add="${name}">Add</button>
  </details>`;
}

function preActionsSection(actions: PreAction[]): string {
  return `<details>
    <summary>Pre-request automations</summary>
    <div class="rows">${actions
      .map(
        (action, index) => `<div class="row" data-row="preActions" data-id="${action.id}">
          <input data-field="variable" value="${escape(action.variable)}" placeholder="Variable">
          <input data-field="value" value="${escape(action.value)}" placeholder="Template value">
          <label><input type="checkbox" data-field="remove" ${checked(action.remove)}> Remove</label>
          <button class="secondary icon" data-remove="preActions:${index}">×</button>
        </div>`,
      )
      .join("")}</div>
    <button class="secondary" data-add="preActions">Add</button>
  </details>`;
}

function postActionsSection(actions: PostAction[]): string {
  return `<details>
    <summary>Post-request automations</summary>
    <div class="rows">${actions
      .map(
        (action, index) => `<div class="row" data-row="postActions" data-id="${action.id}">
          <input data-field="variable" value="${escape(action.variable)}" placeholder="Save as variable">
          <select data-field="source">
            <option value="json" ${selected(action.source === "json")}>JSON path</option>
            <option value="header" ${selected(action.source === "header")}>Header</option>
          </select>
          <input data-field="path" value="${escape(action.path)}" placeholder="data.token or header name">
          <button class="secondary icon" data-remove="postActions:${index}">×</button>
        </div>`,
      )
      .join("")}</div>
    <button class="secondary" data-add="postActions">Add</button>
  </details>`;
}

function renderResponse(): void {
  if (!lastResult) return;
  byId("response-status").classList.remove("error");
  text(
    "response-status",
    `${lastResult.status} ${lastResult.statusText} · ${lastResult.durationMs} ms`,
  );
  showBody(lastResult.body);
  document.querySelector("#examples-section")?.setAttribute("open", "");
  input("example-status").value = String(lastResult.status);
  const exampleBody = textarea("example-body");
  if (exampleBody) {
    exampleBody.value = pretty(lastResult.body);
    paintJson(exampleBody);
  }
}

function showSaved(example: Example): void {
  byId("response-status").classList.remove("error");
  text("response-status", `${example.status} · ${example.name}`);
  const headers = Object.entries(example.headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  showBody(example.body, headers);
}

function renderError(message: string): void {
  text("response-status", "Error");
  byId("response-status").classList.add("error");
  text("response-body", message);
}

function renderExamples(): void {
  const container = document.querySelector<HTMLElement>("#examples");
  if (!container) return;
  container.innerHTML =
    request.examples.length === 0
      ? '<p class="muted">No examples saved.</p>'
      : request.examples
          .map(
            (example) => `<div class="row">
              <button class="secondary grow" data-view="${example.id}">${escape(example.name)}</button>
              <span>${example.status}</span>
              <button class="secondary" data-example="${example.id}">Delete</button>
            </div>`,
          )
          .join("");
  container.querySelectorAll<HTMLElement>("[data-view]").forEach((button) =>
    button.addEventListener("click", () => {
      const example = request.examples.find((item) => item.id === button.dataset.view);
      if (example) showSaved(example);
    }),
  );
  container.querySelectorAll<HTMLElement>("[data-example]").forEach((button) =>
    button.addEventListener("click", () =>
      vscode.postMessage({
        type: "deleteExample",
        exampleId: button.dataset.example,
      }),
    ),
  );
}

function jsonEditor(id: string, value: string, placeholder: string): string {
  return `<div class="json-editor">
    <pre class="json-highlight" aria-hidden="true"></pre>
    <textarea id="${id}" class="json-input" spellcheck="false" placeholder="${escape(placeholder)}">${escape(value)}</textarea>
  </div>`;
}

function bindJsonEditor(area: HTMLTextAreaElement): void {
  const editor = area.parentElement;
  if (!(editor instanceof HTMLElement)) return;
  const paint = () => paintJson(area);
  area.addEventListener("input", paint);
  new ResizeObserver(paint).observe(editor);
  paint();
}

function paintJson(area: HTMLTextAreaElement): void {
  const editor = area.parentElement;
  const highlight = editor?.querySelector(".json-highlight");
  if (!(editor instanceof HTMLElement) || !(highlight instanceof HTMLElement)) return;
  highlight.innerHTML = `${highlightJson(area.value)}\n`;
  highlight.style.minHeight = `${editor.clientHeight}px`;
}

function showBody(body: string, headers = ""): void {
  const formatted = pretty(body);
  const colored = isJson(body) ? highlightJson(formatted) : escape(formatted);
  const prefix = headers ? `${escape(headers)}\n\n` : "";
  byId("response-body").innerHTML = prefix + colored;
}

function highlightJson(source: string): string {
  let html = "";
  let index = 0;
  while (index < source.length) {
    const character = source[index]!;
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      const token = source.slice(start, index);
      const kind = /^\s*:/.test(source.slice(index)) ? "json-key" : "json-string";
      html += `<span class="${kind}">${escape(token)}</span>`;
      continue;
    }
    if ("{}[]:,".includes(character)) {
      html += `<span class="json-punct">${escape(character)}</span>`;
      index += 1;
      continue;
    }
    const number = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(index));
    if (number && (character === "-" || (character >= "0" && character <= "9"))) {
      html += `<span class="json-number">${escape(number[0])}</span>`;
      index += number[0].length;
      continue;
    }
    const literal = /^(true|false|null)\b/.exec(source.slice(index));
    if (literal) {
      html += `<span class="json-literal">${literal[0]}</span>`;
      index += literal[0].length;
      continue;
    }
    html += escape(character);
    index += 1;
  }
  return html;
}

function isJson(body: string): boolean {
  try {
    JSON.parse(body);
    return true;
  } catch {
    return false;
  }
}

function pretty(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

function field(row: HTMLElement, name: string): string {
  return row.querySelector<HTMLInputElement | HTMLSelectElement>(
    `[data-field="${name}"]`,
  )!.value;
}

function byId(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function input(id: string): HTMLInputElement {
  return byId(id) as HTMLInputElement;
}

function select(id: string): HTMLSelectElement {
  return byId(id) as HTMLSelectElement;
}

function textarea(id: string): HTMLTextAreaElement | null {
  return document.getElementById(id) as HTMLTextAreaElement | null;
}

function text(id: string, value: string): void {
  byId(id).textContent = value;
}

function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character]!;
  });
}

const selected = (value: boolean): string => (value ? "selected" : "");
const checked = (value: boolean): string => (value ? "checked" : "");
