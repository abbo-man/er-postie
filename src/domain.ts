export type AuthMode = "inherit" | "enabled" | "disabled";
export type Protocol = "http" | "graphql";
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export interface KeyValue {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface AuthSettings {
  mode: AuthMode;
  headerName: string;
  value: string;
}

export interface PreAction {
  id: string;
  variable: string;
  value: string;
  remove: boolean;
}

export interface PostAction {
  id: string;
  variable: string;
  source: "json" | "header";
  path: string;
}

export interface Example {
  id: string;
  name: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

interface BaseNode {
  id: string;
  name: string;
  auth: AuthSettings;
}

export interface FolderNode extends BaseNode {
  type: "folder";
  children: CollectionNode[];
}

export interface RequestNode extends BaseNode {
  type: "request";
  protocol: Protocol;
  method: HttpMethod;
  url: string;
  query: KeyValue[];
  headers: KeyValue[];
  body: string;
  graphqlQuery: string;
  graphqlVariables: string;
  preActions: PreAction[];
  postActions: PostAction[];
  examples: Example[];
}

export type CollectionNode = FolderNode | RequestNode;

export interface Environment {
  id: string;
  name: string;
  variableNames: string[];
}

export interface ProjectCollection {
  id: string;
  name: string;
  workspaceUri: string;
  lastOpenedAt: number;
  nodes: CollectionNode[];
  environments: Environment[];
  activeEnvironmentId?: string;
}

export interface StoredState {
  version: 1;
  projects: ProjectCollection[];
}

export const emptyAuth = (): AuthSettings => ({
  mode: "inherit",
  headerName: "Authorization",
  value: "Bearer {{token}}",
});

export const newFolder = (name: string): FolderNode => ({
  id: crypto.randomUUID(),
  name,
  type: "folder",
  auth: emptyAuth(),
  children: [],
});

export const newRequest = (name: string, protocol: Protocol): RequestNode => ({
  id: crypto.randomUUID(),
  name,
  type: "request",
  protocol,
  method: protocol === "graphql" ? "POST" : "GET",
  url: "",
  query: [],
  headers: [],
  body: "",
  graphqlQuery: "",
  graphqlVariables: "{}",
  preActions: [],
  postActions: [],
  examples: [],
  auth: emptyAuth(),
});

export function findNode(
  nodes: CollectionNode[],
  id: string,
): CollectionNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    if (node.type === "folder") {
      const child = findNode(node.children, id);
      if (child) return child;
    }
  }
  return undefined;
}

export function findParent(
  nodes: CollectionNode[],
  id: string,
): FolderNode | undefined {
  for (const node of nodes) {
    if (node.type !== "folder") continue;
    if (node.children.some((child) => child.id === id)) return node;
    const parent = findParent(node.children, id);
    if (parent) return parent;
  }
  return undefined;
}

export function removeNode(nodes: CollectionNode[], id: string): boolean {
  const index = nodes.findIndex((node) => node.id === id);
  if (index >= 0) {
    nodes.splice(index, 1);
    return true;
  }
  return nodes.some(
    (node) => node.type === "folder" && removeNode(node.children, id),
  );
}

export function cloneNode<T extends CollectionNode>(node: T): T {
  const clone = structuredClone(node);
  const renewIds = (item: CollectionNode) => {
    item.id = crypto.randomUUID();
    if (item.type === "folder") item.children.forEach(renewIds);
    else item.examples.forEach((example) => (example.id = crypto.randomUUID()));
  };
  renewIds(clone);
  clone.name = `${clone.name} copy`;
  return clone;
}

export function authFor(
  project: ProjectCollection,
  node: CollectionNode,
): AuthSettings | undefined {
  if (node.auth.mode === "enabled") return node.auth;
  if (node.auth.mode === "disabled") return undefined;
  const parent = findParent(project.nodes, node.id);
  return parent ? authFor(project, parent) : undefined;
}
