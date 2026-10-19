import * as vscode from "vscode";
import {
  authFor,
  findNode,
  type CollectionNode,
  type Example,
  type ProjectCollection,
} from "./domain";
import type { PostieStorage } from "./storage";

type TreeValue =
  | { kind: "project"; project: ProjectCollection }
  | { kind: "others"; currentProjectId?: string }
  | { kind: "node"; project: ProjectCollection; node: CollectionNode }
  | {
      kind: "example";
      project: ProjectCollection;
      requestId: string;
      example: Example;
    };

export class PostieTreeItem extends vscode.TreeItem {
  constructor(public readonly value: TreeValue) {
    super(labelFor(value), collapsibleFor(value));
    if (value.kind === "project") {
      this.description = value.project.workspaceUri;
      this.iconPath = new vscode.ThemeIcon("root-folder");
    } else if (value.kind === "others") {
      this.iconPath = new vscode.ThemeIcon("archive");
    } else if (value.kind === "node") {
      this.contextValue = value.node.type;
      this.iconPath = new vscode.ThemeIcon(
        value.node.type === "folder"
          ? "folder"
          : value.node.protocol === "graphql"
            ? "symbol-interface"
            : "globe",
      );
      this.checkboxState = authFor(value.project, value.node)
        ? vscode.TreeItemCheckboxState.Checked
        : vscode.TreeItemCheckboxState.Unchecked;
      if (value.node.type === "request") {
        this.description =
          value.node.protocol === "graphql" ? "GraphQL" : value.node.method;
        this.command = {
          command: "erPostie.openRequest",
          title: "Open Request",
          arguments: [this],
        };
      }
    } else {
      this.contextValue = "example";
      this.iconPath = new vscode.ThemeIcon("beaker");
      this.description = String(value.example.status);
      this.command = {
        command: "erPostie.openExample",
        title: "Open example",
        arguments: [this],
      };
    }
  }
}

export class CollectionsTree
  implements vscode.TreeDataProvider<PostieTreeItem>
{
  private readonly changed = new vscode.EventEmitter<
    PostieTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly storage: PostieStorage) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(item: PostieTreeItem): vscode.TreeItem {
    return item;
  }

  async getChildren(item?: PostieTreeItem): Promise<PostieTreeItem[]> {
    const current = await this.storage.currentProject();
    if (!item) {
      const roots: PostieTreeItem[] = [];
      if (current) roots.push(new PostieTreeItem({ kind: "project", project: current }));
      if (this.storage.projects.some((project) => project.id !== current?.id)) {
        roots.push(
          new PostieTreeItem({
            kind: "others",
            currentProjectId: current?.id,
          }),
        );
      }
      return roots;
    }
    if (item.value.kind === "others") {
      const currentProjectId = item.value.currentProjectId;
      return this.storage.projects
        .filter((project) => project.id !== currentProjectId)
        .map((project) => new PostieTreeItem({ kind: "project", project }));
    }
    if (item.value.kind === "project") {
      return this.nodeItems(item.value.project, item.value.project.nodes);
    }
    if (item.value.kind === "node") {
      const { node, project } = item.value;
      return node.type === "folder"
        ? this.nodeItems(project, node.children)
        : node.examples.map(
            (example) =>
              new PostieTreeItem({
                kind: "example",
                project,
                requestId: node.id,
                example,
              }),
          );
    }
    return [];
  }

  projectAndNode(
    item: PostieTreeItem | undefined,
  ): { project: ProjectCollection; node?: CollectionNode } | undefined {
    if (!item) return undefined;
    if (item.value.kind === "project") return { project: item.value.project };
    if (item.value.kind === "node") {
      const project = this.storage.project(item.value.project.id);
      const node = project && findNode(project.nodes, item.value.node.id);
      return project && node ? { project, node } : undefined;
    }
    return undefined;
  }

  exampleOf(item: PostieTreeItem | undefined):
    | { project: ProjectCollection; requestId: string; example: Example }
    | undefined {
    if (!item || item.value.kind !== "example") return undefined;
    const { project: source, requestId, example: selected } = item.value;
    const project = this.storage.project(source.id);
    const node = project && findNode(project.nodes, requestId);
    if (!project || node?.type !== "request") return undefined;
    const example = node.examples.find(
      (candidate) => candidate.id === selected.id,
    );
    return example
      ? { project, requestId: node.id, example }
      : undefined;
  }

  private nodeItems(
    project: ProjectCollection,
    nodes: CollectionNode[],
  ): PostieTreeItem[] {
    return nodes.map(
      (node) => new PostieTreeItem({ kind: "node", project, node }),
    );
  }
}

function labelFor(value: TreeValue): string {
  if (value.kind === "project") return value.project.name;
  if (value.kind === "others") return "Other projects";
  if (value.kind === "node") return value.node.name;
  return value.example.name;
}

function collapsibleFor(value: TreeValue): vscode.TreeItemCollapsibleState {
  if (value.kind === "example") return vscode.TreeItemCollapsibleState.None;
  if (value.kind === "node" && value.node.type === "request") {
    return value.node.examples.length > 0
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
  }
  return vscode.TreeItemCollapsibleState.Collapsed;
}
