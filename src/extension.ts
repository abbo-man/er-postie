import * as vscode from "vscode";
import {
  authFor,
  cloneNode,
  findNode,
  findParent,
  newFolder,
  newRequest,
  removeNode,
  type CollectionNode,
  type FolderNode,
  type ProjectCollection,
  type Protocol,
} from "./domain";
import {
  CollectionsTree,
  PostieTreeItem,
} from "./collections-tree";
import {
  EnvironmentsTree,
  EnvironmentTreeItem,
} from "./environments-tree";
import { RequestEditor } from "./request-editor";
import { PostieStorage } from "./storage";

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const storage = new PostieStorage(context);
  await storage.reload();
  await storage.currentProject();
  await storage.importPendingSeed();
  const collections = new CollectionsTree(storage);
  const environments = new EnvironmentsTree(storage);
  const editor = new RequestEditor(context, storage, () => {
    collections.refresh();
    environments.refresh();
  });
  const collectionView = vscode.window.createTreeView("erPostie.collections", {
    treeDataProvider: collections,
    showCollapseAll: true,
    manageCheckboxStateManually: true,
  });
  const environmentView = vscode.window.createTreeView("erPostie.environments", {
    treeDataProvider: environments,
  });

  const target = async (
    item?: PostieTreeItem,
  ): Promise<
    { project: ProjectCollection; node?: CollectionNode } | undefined
  > => {
    const selected = collections.projectAndNode(item);
    if (selected) return selected;
    const project = await storage.currentProject();
    return project ? { project } : undefined;
  };

  const register = (
    command: string,
    callback: (...args: any[]) => unknown,
  ) => context.subscriptions.push(vscode.commands.registerCommand(command, callback));

  register("erPostie.refresh", async () => {
    await storage.reload();
    await storage.importPendingSeed();
    collections.refresh();
    environments.refresh();
  });

  register("erPostie.createFolder", async (item?: PostieTreeItem) => {
    const selected = await target(item);
    if (!selected || selected.node?.type === "request") return;
    const name = await vscode.window.showInputBox({
      prompt: "Folder name",
      validateInput: required,
    });
    if (!name) return;
    childrenOf(selected.project, selected.node).push(newFolder(name));
    await storage.save();
    collections.refresh();
  });

  register("erPostie.createRequest", async (item?: PostieTreeItem) => {
    const selected = await target(item);
    if (!selected || selected.node?.type === "request") return;
    const name = await vscode.window.showInputBox({
      prompt: "Request name",
      validateInput: required,
    });
    if (!name) return;
    const protocol = await vscode.window.showQuickPick(["HTTP", "GraphQL"], {
      placeHolder: "Protocol",
    });
    if (!protocol) return;
    const request = newRequest(name, protocol.toLowerCase() as Protocol);
    childrenOf(selected.project, selected.node).push(request);
    await storage.save();
    collections.refresh();
    editor.open(selected.project.id, request.id);
  });

  register("erPostie.openRequest", (item: PostieTreeItem) => {
    const selected = collections.projectAndNode(item);
    if (selected?.node?.type === "request") {
      editor.open(selected.project.id, selected.node.id);
    }
  });

  register("erPostie.addExample", (item: PostieTreeItem) => {
    const selected = collections.projectAndNode(item);
    if (selected?.node?.type !== "request") return;
    editor.open(selected.project.id, selected.node.id, { type: "composeExample" });
  });

  register("erPostie.openExample", (item: PostieTreeItem) => {
    const selected = collections.exampleOf(item);
    if (!selected) return;
    editor.open(selected.project.id, selected.requestId, {
      type: "showExample",
      exampleId: selected.example.id,
    });
  });

  register("erPostie.deleteExample", async (item: PostieTreeItem) => {
    const selected = collections.exampleOf(item);
    if (!selected) return;
    const request = findNode(selected.project.nodes, selected.requestId);
    if (request?.type !== "request") return;
    const answer = await vscode.window.showWarningMessage(
      `Delete example "${selected.example.name}"?`,
      { modal: true },
      "Delete",
    );
    if (answer !== "Delete") return;
    request.examples = request.examples.filter(
      (example) => example.id !== selected.example.id,
    );
    await storage.save();
    collections.refresh();
    editor.syncExamples(selected.project.id, request.id);
  });

  register("erPostie.rename", async (item: PostieTreeItem) => {
    const selected = collections.projectAndNode(item);
    if (!selected?.node) return;
    const name = await vscode.window.showInputBox({
      prompt: "New name",
      value: selected.node.name,
      validateInput: required,
    });
    if (!name) return;
    selected.node.name = name;
    await storage.save();
    collections.refresh();
  });

  register("erPostie.duplicate", async (item: PostieTreeItem) => {
    const selected = collections.projectAndNode(item);
    if (!selected?.node) return;
    const parent = findParent(selected.project.nodes, selected.node.id);
    (parent?.children ?? selected.project.nodes).push(cloneNode(selected.node));
    await storage.save();
    collections.refresh();
  });

  register("erPostie.delete", async (item: PostieTreeItem) => {
    const selected = collections.projectAndNode(item);
    if (!selected?.node) return;
    const answer = await vscode.window.showWarningMessage(
      `Delete "${selected.node.name}"?`,
      { modal: true },
      "Delete",
    );
    if (answer !== "Delete") return;
    removeNode(selected.project.nodes, selected.node.id);
    await storage.save();
    collections.refresh();
  });

  register("erPostie.configureAuth", async (item: PostieTreeItem) => {
    const selected = collections.projectAndNode(item);
    if (!selected?.node) return;
    const mode = await vscode.window.showQuickPick(
      ["inherit", "enabled", "disabled"],
      { placeHolder: "Authentication mode" },
    );
    if (!mode) return;
    selected.node.auth.mode = mode as typeof selected.node.auth.mode;
    if (mode === "enabled") {
      const headerName = await vscode.window.showInputBox({
        prompt: "Authentication header",
        value: selected.node.auth.headerName,
        validateInput: required,
      });
      if (!headerName) return;
      const value = await vscode.window.showInputBox({
        prompt: "Header value (variables supported)",
        value: selected.node.auth.value,
        validateInput: required,
      });
      if (!value) return;
      selected.node.auth.headerName = headerName;
      selected.node.auth.value = value;
    }
    await storage.save();
    collections.refresh();
  });

  collectionView.onDidChangeCheckboxState(async (changes) => {
    for (const [item, state] of changes.items) {
      const selected = collections.projectAndNode(item);
      if (!selected?.node) continue;
      if (state === vscode.TreeItemCheckboxState.Unchecked) {
        selected.node.auth.mode = "disabled";
      } else {
        const parent = findParent(selected.project.nodes, selected.node.id);
        selected.node.auth.mode =
          parent && authFor(selected.project, parent) ? "inherit" : "enabled";
      }
    }
    await storage.save();
    collections.refresh();
  });

  register("erPostie.createEnvironment", async () => {
    const project = await storage.currentProject();
    if (!project) return;
    const name = await vscode.window.showInputBox({
      prompt: "Environment name",
      validateInput: required,
    });
    if (!name) return;
    const environment = {
      id: crypto.randomUUID(),
      name,
      variableNames: [],
    };
    project.environments.push(environment);
    project.activeEnvironmentId ??= environment.id;
    await storage.save();
    environments.refresh();
  });

  register("erPostie.selectEnvironment", async (item: EnvironmentTreeItem) => {
    if (item.value.kind !== "environment") return;
    item.value.project.activeEnvironmentId = item.value.environment.id;
    await storage.save();
    environments.refresh();
  });

  register("erPostie.addVariable", async (item: EnvironmentTreeItem) => {
    if (item.value.kind !== "environment") return;
    const values = await storage.variables(
      item.value.project.id,
      item.value.environment.id,
    );
    const name = await vscode.window.showInputBox({
      prompt: "Variable name",
      validateInput: (value) =>
        required(value) ??
        (value.trim() in values ? "This variable already exists." : undefined),
    });
    if (!name) return;
    const value = await vscode.window.showInputBox({
      prompt: `Value for ${name.trim()}`,
    });
    if (value === undefined) return;
    values[name.trim()] = value;
    await storage.setVariables(
      item.value.project.id,
      item.value.environment,
      values,
    );
    environments.refresh();
  });

  register("erPostie.editVariable", async (item: EnvironmentTreeItem) => {
    if (item.value.kind !== "variable") return;
    const { project, environment, name: previousName } = item.value;
    const values = await storage.variables(project.id, environment.id);
    const name = await vscode.window.showInputBox({
      prompt: "Variable name",
      value: previousName,
      validateInput: (value) =>
        required(value) ??
        (value.trim() !== previousName && value.trim() in values
          ? "This variable already exists."
          : undefined),
    });
    if (!name) return;
    const value = await vscode.window.showInputBox({
      prompt: `Value for ${name.trim()}`,
      value: values[previousName] ?? "",
    });
    if (value === undefined) return;
    delete values[previousName];
    values[name.trim()] = value;
    await storage.setVariables(project.id, environment, values);
    environments.refresh();
  });

  register("erPostie.deleteVariable", async (item: EnvironmentTreeItem) => {
    if (item.value.kind !== "variable") return;
    const answer = await vscode.window.showWarningMessage(
      `Delete variable "${item.value.name}"?`,
      { modal: true },
      "Delete",
    );
    if (answer !== "Delete") return;
    const values = await storage.variables(
      item.value.project.id,
      item.value.environment.id,
    );
    delete values[item.value.name];
    await storage.setVariables(
      item.value.project.id,
      item.value.environment,
      values,
    );
    environments.refresh();
  });

  register("erPostie.editEnvironment", async (item: EnvironmentTreeItem) => {
    if (item.value.kind !== "environment") return;
    const values = await storage.variables(
      item.value.project.id,
      item.value.environment.id,
    );
    const json = await vscode.window.showInputBox({
      title: `${item.value.environment.name} variables`,
      prompt: "JSON object. Values are stored in VS Code Secret Storage.",
      value: JSON.stringify(values),
      validateInput: validateVariables,
    });
    if (json === undefined) return;
    await storage.setVariables(
      item.value.project.id,
      item.value.environment,
      JSON.parse(json) as Record<string, string>,
    );
    environments.refresh();
  });

  register("erPostie.deleteEnvironment", async (item: EnvironmentTreeItem) => {
    if (item.value.kind !== "environment") return;
    const answer = await vscode.window.showWarningMessage(
      `Delete "${item.value.environment.name}" and its variables?`,
      { modal: true },
      "Delete",
    );
    if (answer !== "Delete") return;
    await storage.deleteEnvironment(
      item.value.project,
      item.value.environment.id,
    );
    environments.refresh();
  });

  context.subscriptions.push(collectionView, environmentView);
}

function childrenOf(
  project: ProjectCollection,
  node?: CollectionNode,
): CollectionNode[] {
  return node?.type === "folder"
    ? (node as FolderNode).children
    : project.nodes;
}

function required(value: string): string | undefined {
  return value.trim() ? undefined : "Required";
}

function validateVariables(value: string): string | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (
      !parsed ||
      Array.isArray(parsed) ||
      typeof parsed !== "object" ||
      Object.values(parsed).some((item) => typeof item !== "string")
    ) {
      return "Use a JSON object with string values.";
    }
    return undefined;
  } catch {
    return "Invalid JSON.";
  }
}
