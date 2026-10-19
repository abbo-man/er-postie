import * as vscode from "vscode";
import type { Environment, ProjectCollection } from "./domain";
import type { PostieStorage } from "./storage";

type EnvironmentValue =
  | { kind: "environment"; project: ProjectCollection; environment: Environment }
  | {
      kind: "variable";
      project: ProjectCollection;
      environment: Environment;
      name: string;
    };

export class EnvironmentTreeItem extends vscode.TreeItem {
  constructor(public readonly value: EnvironmentValue, active = false) {
    super(
      value.kind === "environment" ? value.environment.name : value.name,
      value.kind === "environment"
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );
    if (value.kind === "environment") {
      this.contextValue = "environment";
      this.description = active ? "active" : undefined;
      this.iconPath = new vscode.ThemeIcon(active ? "check" : "symbol-variable");
      this.command = {
        command: "erPostie.selectEnvironment",
        title: "Use Environment",
        arguments: [this],
      };
    } else {
      this.contextValue = "environmentVariable";
      this.iconPath = new vscode.ThemeIcon("key");
      this.command = {
        command: "erPostie.editVariable",
        title: "Edit Variable",
        arguments: [this],
      };
    }
  }
}

export class EnvironmentsTree
  implements vscode.TreeDataProvider<EnvironmentTreeItem>
{
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  constructor(private readonly storage: PostieStorage) {}

  refresh(): void {
    this.changed.fire();
  }

  getTreeItem(item: EnvironmentTreeItem): vscode.TreeItem {
    return item;
  }

  async getChildren(
    item?: EnvironmentTreeItem,
  ): Promise<EnvironmentTreeItem[]> {
    if (item?.value.kind === "environment") {
      const { project, environment } = item.value;
      const values = await this.storage.variables(project.id, environment.id);
      return environment.variableNames.map((name) => {
        const variable = new EnvironmentTreeItem({
          kind: "variable",
          project,
          environment,
          name,
        });
        variable.description = values[name] ?? "";
        return variable;
      });
    }
    if (item) return [];
    const project = await this.storage.currentProject();
    return (
      project?.environments.map(
        (environment) =>
          new EnvironmentTreeItem(
            { kind: "environment", project, environment },
            project.activeEnvironmentId === environment.id,
          ),
      ) ?? []
    );
  }
}
