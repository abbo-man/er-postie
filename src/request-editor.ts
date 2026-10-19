import * as vscode from "vscode";
import { authFor, findNode, type RequestNode } from "./domain";
import {
  requestToCurl,
  runRequest,
  type RunResult,
} from "./request-runner";
import type { PostieStorage } from "./storage";

interface EditorMessage {
  type: "ready" | "save" | "send" | "copyCurl" | "addExample" | "deleteExample";
  request?: RequestNode;
  name?: string;
  status?: number;
  body?: string;
  headers?: Record<string, string>;
  exampleId?: string;
}

type PendingView =
  | { type: "composeExample" }
  | { type: "showExample"; exampleId: string };

export class RequestEditor {
  private readonly panels = new Map<string, vscode.WebviewPanel>();
  private readonly results = new Map<string, RunResult>();
  private readonly pending = new Map<string, PendingView>();

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly storage: PostieStorage,
    private readonly onChange: () => void,
  ) {}

  open(projectId: string, requestId: string, pending?: PendingView): void {
    const existing = this.panels.get(requestId);
    if (existing) {
      existing.reveal();
      if (pending) void existing.webview.postMessage(pending);
      return;
    }

    const project = this.storage.project(projectId);
    const request = project && findNode(project.nodes, requestId);
    if (!project || request?.type !== "request") return;
    if (pending) this.pending.set(requestId, pending);

    const panel = vscode.window.createWebviewPanel(
      "erPostie.request",
      request.name,
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "dist")],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(
      this.context.extensionUri,
      "media",
      "postie.svg",
    );
    panel.webview.html = this.html(panel.webview);
    panel.webview.onDidReceiveMessage(
      (message: EditorMessage) =>
        this.handleMessage(panel, projectId, requestId, message),
      undefined,
      this.context.subscriptions,
    );
    panel.onDidDispose(() => {
      this.panels.delete(requestId);
      this.results.delete(requestId);
      this.pending.delete(requestId);
    });
    this.panels.set(requestId, panel);
  }

  private async handleMessage(
    panel: vscode.WebviewPanel,
    projectId: string,
    requestId: string,
    message: EditorMessage,
  ): Promise<void> {
    const project = this.storage.project(projectId);
    const stored = project && findNode(project.nodes, requestId);
    if (!project || stored?.type !== "request") return;

    if (message.type === "ready") {
      const environment = project.environments.find(
        (candidate) => candidate.id === project.activeEnvironmentId,
      );
      await panel.webview.postMessage({
        type: "load",
        request: stored,
        environmentName: environment?.name ?? "No environment",
      });
      const pending = this.pending.get(requestId);
      this.pending.delete(requestId);
      if (pending) await panel.webview.postMessage(pending);
      return;
    }

    if (message.request) {
      Object.assign(stored, message.request, {
        id: stored.id,
        type: "request",
      });
      panel.title = stored.name;
      await this.storage.save();
      this.onChange();
    }
    if (message.type === "save") return;

    if (message.type === "send") {
      try {
        const environment = project.environments.find(
          (candidate) => candidate.id === project.activeEnvironmentId,
        );
        if (!environment && (stored.preActions.length || stored.postActions.length)) {
          throw new Error("Select an environment before running automations.");
        }
        const variables = await this.storage.variables(
          project.id,
          environment?.id,
        );
        const result = await runRequest(
          stored,
          variables,
          authFor(project, stored),
        );
        if (environment) {
          await this.storage.setVariables(project.id, environment, result.variables);
        }
        this.results.set(requestId, result);
        await panel.webview.postMessage({ type: "response", result });
        this.onChange();
      } catch (error) {
        await panel.webview.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    if (message.type === "copyCurl") {
      try {
        const variables = await this.storage.variables(
          project.id,
          project.activeEnvironmentId,
        );
        await vscode.env.clipboard.writeText(
          requestToCurl(stored, variables, authFor(project, stored)),
        );
        void vscode.window.showInformationMessage("cURL copied.");
      } catch (error) {
        await panel.webview.postMessage({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }

    const status = message.status;
    if (
      message.type === "addExample" &&
      message.name &&
      typeof status === "number" &&
      Number.isInteger(status)
    ) {
      stored.examples.push({
        id: crypto.randomUUID(),
        name: message.name,
        status,
        headers: stringHeaders(message.headers),
        body: message.body ?? "",
      });
      await this.storage.save();
      this.onChange();
      await panel.webview.postMessage({ type: "examples", examples: stored.examples });
    } else if (message.type === "deleteExample" && message.exampleId) {
      stored.examples = stored.examples.filter(
        (example) => example.id !== message.exampleId,
      );
      await this.storage.save();
      this.onChange();
      await panel.webview.postMessage({ type: "examples", examples: stored.examples });
    }
  }

  syncExamples(projectId: string, requestId: string): void {
    const panel = this.panels.get(requestId);
    const project = this.storage.project(projectId);
    const stored = project && findNode(project.nodes, requestId);
    if (!panel || stored?.type !== "request") return;
    void panel.webview.postMessage({ type: "examples", examples: stored.examples });
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const script = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.js"),
    );
    const style = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview.css"),
    );
    return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${style}">
  <title>ER Postie</title>
</head>
<body>
  <main id="app"></main>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

function stringHeaders(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}
