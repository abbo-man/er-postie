# ER Postie

A small HTTP and GraphQL client for Cursor and VS Code. Each opened workspace
gets its own collection, while collections and environments stay available
globally from the ER Postie activity bar.

## Local installation

```sh
npm install
npm run package
code --install-extension er-postie-0.1.0.vsix
```

Cursor can install the same VSIX through **Extensions: Install from VSIX**.

## Requests

Create folders and requests from the Collections view. Requests support:

- HTTP methods and GraphQL
- `{{variable}}` placeholders in URLs, query parameters, headers,
  authentication and JSON/GraphQL bodies
- `{{$uuid}}` (or `{{$guid}}`) inserts a new UUID each time that spot is
  sent. `{{$uuid:name}}` reuses one UUID for every spot with the same name
  inside that same value
- inherited authentication with per-folder and per-request overrides
- response status, duration and body
- cURL export and saved response examples. Add one from the request
  editor, or with **Add example** on the request. Click an example to view
  its status, headers and body.

The checkbox beside a folder or request enables or disables effective
authentication quickly. Use **Configure Authentication** to edit the header
name and value.

## Environments

Create an environment, select it, then use **Edit Variables**. Variable values
are stored in VS Code Secret Storage; request definitions and variable names
are stored in extension global storage, never in the project repository.

## Automations

ER Postie deliberately uses declarative automations instead of arbitrary
JavaScript:

- Pre-request actions assign a template value to a variable or remove it.
- Post-request actions save a response header or JSON value to a variable.

JSON paths use dot notation, for example `data.access_token` or
`$.data.access_token`. Select an environment before running a request with
automations. Updated values, including JWTs, are written back to Secret
Storage.
