import * as vscode from "vscode";
import type {
  CollectionNode,
  Environment,
  ProjectCollection,
  StoredState,
} from "./domain";

const STATE_KEY = "erPostie.state";

export class PostieStorage {
  private state: StoredState;
  private readonly stateUri: vscode.Uri;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.stateUri = vscode.Uri.joinPath(context.globalStorageUri, "state.json");
    this.state = context.globalState.get<StoredState>(STATE_KEY) ?? {
      version: 1,
      projects: [],
    };
  }

  get projects(): ProjectCollection[] {
    return [...this.state.projects].sort(
      (first, second) => second.lastOpenedAt - first.lastOpenedAt,
    );
  }

  async reload(): Promise<void> {
    try {
      this.state = JSON.parse(
        new TextDecoder().decode(
          await vscode.workspace.fs.readFile(this.stateUri),
        ),
      ) as StoredState;
    } catch {
      this.state = this.context.globalState.get<StoredState>(STATE_KEY) ?? {
        version: 1,
        projects: [],
      };
    }
  }

  async currentProject(): Promise<ProjectCollection | undefined> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) return undefined;

    const workspaceUri = folder.uri.toString();
    let project = this.state.projects.find(
      (candidate) => candidate.workspaceUri === workspaceUri,
    );
    if (!project) {
      project = {
        id: crypto.randomUUID(),
        name: folder.name,
        workspaceUri,
        lastOpenedAt: Date.now(),
        nodes: [],
        environments: [],
      };
      this.state.projects.push(project);
    } else {
      project.name = folder.name;
      project.lastOpenedAt = Date.now();
    }
    await this.save();
    return project;
  }

  project(id: string): ProjectCollection | undefined {
    return this.state.projects.find((project) => project.id === id);
  }

  async save(): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.context.globalStorageUri);
    await vscode.workspace.fs.writeFile(
      this.stateUri,
      new TextEncoder().encode(JSON.stringify(this.state)),
    );
    await this.context.globalState.update(STATE_KEY, this.state);
  }

  // One-shot import for this machine. The file is removed after a successful import.
  async importPendingSeed(): Promise<boolean> {
    const seedUri = vscode.Uri.file(
      "/Users/thomas.abbondi/Progetti/er-postie/seed.local.json",
    );
    let raw: string;
    try {
      raw = new TextDecoder().decode(await vscode.workspace.fs.readFile(seedUri));
    } catch {
      return false;
    }

    const seed = JSON.parse(raw) as {
      workspaceUri: string;
      activeEnvironment?: string;
      environments?: Array<{ name: string; variables: Record<string, string> }>;
      nodes?: CollectionNode[];
    };
    const project = this.state.projects.find(
      (candidate) => candidate.workspaceUri === seed.workspaceUri,
    );
    if (!project) return false;

    for (const item of seed.environments ?? []) {
      let environment = project.environments.find(
        (candidate) => candidate.name.toLowerCase() === item.name.toLowerCase(),
      );
      if (!environment) {
        environment = {
          id: crypto.randomUUID(),
          name: item.name,
          variableNames: [],
        };
        project.environments.push(environment);
      }
      environment.name = item.name;
      await this.setVariables(project.id, environment, item.variables);
    }
    for (const node of seed.nodes ?? []) {
      const index = project.nodes.findIndex(
        (candidate) => candidate.name === node.name,
      );
      if (index >= 0) project.nodes[index] = node;
      else project.nodes.push(node);
    }
    if (seed.activeEnvironment) {
      const active = project.environments.find(
        (candidate) =>
          candidate.name.toLowerCase() === seed.activeEnvironment?.toLowerCase(),
      );
      if (active) project.activeEnvironmentId = active.id;
    }
    await this.save();
    await vscode.workspace.fs.delete(seedUri);
    return true;
  }

  async variables(
    projectId: string,
    environmentId?: string,
  ): Promise<Record<string, string>> {
    if (!environmentId) return {};
    const value = await this.context.secrets.get(
      this.secretKey(projectId, environmentId),
    );
    if (!value) return {};
    try {
      return JSON.parse(value) as Record<string, string>;
    } catch {
      return {};
    }
  }

  async setVariables(
    projectId: string,
    environment: Environment,
    values: Record<string, string>,
  ): Promise<void> {
    environment.variableNames = Object.keys(values).sort();
    await this.context.secrets.store(
      this.secretKey(projectId, environment.id),
      JSON.stringify(values),
    );
    await this.save();
  }

  async deleteEnvironment(
    project: ProjectCollection,
    environmentId: string,
  ): Promise<void> {
    project.environments = project.environments.filter(
      (environment) => environment.id !== environmentId,
    );
    if (project.activeEnvironmentId === environmentId) {
      project.activeEnvironmentId = undefined;
    }
    await this.context.secrets.delete(
      this.secretKey(project.id, environmentId),
    );
    await this.save();
  }

  private secretKey(projectId: string, environmentId: string): string {
    return `erPostie.variables.${projectId}.${environmentId}`;
  }
}
