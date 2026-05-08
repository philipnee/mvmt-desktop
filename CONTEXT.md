# mvmt Engine Context

  mvmt is the local file authority.

  The desktop app should not reimplement mount, token, auth, tunnel, indexing, or MCP behavior.

  Use the mvmt CLI/server as the engine:
  - `mvmt serve`
  - `mvmt mounts add/list/edit/remove`
  - `mvmt token add/list/edit/remove`
  - `mvmt reindex`
  - future: share/link commands

  Current product boundary:
  - local app owns files and permissions
  - cloud/website owns account, public URLs, browser downloads
  - receiver never installs mvmt

  Desktop MVP:
  1. Start/stop local mvmt server
  2. Show server status
  3. Add/list/remove mounts
  4. Create/list tokens
  5. Open dashboard/browser link

  Important permission model:
  - Mount write access is the base permission.
  - Token permissions cannot exceed mount permissions.
  - Changing token scope should apply without OAuth reauth.
  - Changing client binding requires OAuth reauth.

  CLI dev path:
  - mvmt repo: `/Users/philipnee/code/mvmt`
  - build first with `npm run build`
  - CLI entry: `/Users/philipnee/code/mvmt/dist/bin/mvmt.js`

  How Electron Talks To mvmt

  Use child_process.spawn in Electron main process:

  import { spawn } from "node:child_process";

  const MVMT_BIN = "/Users/philipnee/code/mvmt/dist/bin/mvmt.js";

  export function runMvmt(args: string[]) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn("node", [MVMT_BIN, "--no-update-check", ...args], {
        env: process.env,
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", chunk => stdout += chunk);
      child.stderr.on("data", chunk => stderr += chunk);

      child.on("close", code => {
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(stderr || `mvmt exited ${code}`));
      });
    });
  }

  Example calls:

  await runMvmt(["mounts", "--json"]);
  await runMvmt(["mounts", "add", "books", "/Users/philipnee/books", "--mount-path", "/books"]);
  await runMvmt(["token", "add", "desktop", "--scope", "books:read"]);
  await runMvmt(["reindex"]);

  Server Control

  For mvmt serve, keep a long-running process:

  const server = spawn("node", [
    MVMT_BIN,
    "--no-update-check",
    "serve",
    "--port",
    "4141"
  ]);

  Then check:

  fetch("http://127.0.0.1:4141/.well-known/oauth-authorization-server")

  Important Rule

  Do not let the renderer/browser run shell commands directly.

  Renderer UI → IPC → Electron main → mvmt CLI

  That keeps the desktop app sane and safer.

  So the practical migration is:

  1. Keep mvmt repo unchanged as engine
  2. Create mvmt-desktop repo
  3. Add MVMT_ENGINE_CONTEXT.md
  4. Build Electron UI
  5. Shell out to local mvmt CLI during dev
  6. Bundle mvmt engine later for releases
