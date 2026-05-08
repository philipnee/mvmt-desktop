import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { request } from 'node:http';
import {
  basename,
  dirname,
  join,
  relative as pathRelative,
  resolve as resolvePath,
  sep,
} from 'node:path';
import {
  type AddMountInput,
  type BrowseShareInput,
  type BrowseShareResult,
  type CommandResult,
  type CreatedShare,
  type CreateShareInput,
  type CreateTokenInput,
  type EditTokenInput,
  type MountFileEntry,
  type ShareSummary,
  type MountSummary,
  type ServerStatus,
  type TokenSummary,
  type TunnelStatus,
} from '../shared/types';

function resolveResourcesRoot(): string {
  return app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'vendor');
}

function resolveMvmtBin(): string {
  if (process.env.MVMT_BIN) return process.env.MVMT_BIN;
  // Packaged: <resourcesPath>/mvmt/dist/bin/mvmt.js
  // Dev: <repo>/vendor/mvmt/dist/bin/mvmt.js, falling back to ~/code/mvmt for local dev
  const candidates = [
    join(resolveResourcesRoot(), 'mvmt', 'dist', 'bin', 'mvmt.js'),
    '/Users/philipnee/code/mvmt/dist/bin/mvmt.js',
  ];
  return candidates.find(existsSync) ?? candidates[0];
}

function resolveCloudflaredBinDir(): string | null {
  if (process.env.MVMT_CLOUDFLARED_DIR) return process.env.MVMT_CLOUDFLARED_DIR;
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const platform =
    process.platform === 'darwin' ? 'darwin' :
    process.platform === 'win32'  ? 'win'    :
    process.platform === 'linux'  ? 'linux'  : null;
  if (!platform) return null;
  const dir = join(resolveResourcesRoot(), 'cloudflared', `${platform}-${arch}`);
  return existsSync(dir) ? dir : null;
}

function mvmtSpawnEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    ELECTRON_RUN_AS_NODE: '1',
  };
  // Strip any --inspect / --require args that Electron may have set, so the
  // child Node process starts clean.
  delete env.NODE_OPTIONS;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;

  // Make our bundled cloudflared discoverable by mvmt's tunnel-controller.
  const cfDir = resolveCloudflaredBinDir();
  if (cfDir) {
    const sep = process.platform === 'win32' ? ';' : ':';
    env.PATH = `${cfDir}${sep}${env.PATH ?? ''}`;
  }
  return env;
}

const MVMT_BIN = resolveMvmtBin();
const MVMT_NODE_BIN = process.env.MVMT_NODE_BIN ?? process.execPath;
const MVMT_PORT = Number.parseInt(process.env.MVMT_PORT ?? '4141', 10);
const SERVER_URL = `http://127.0.0.1:${MVMT_PORT}`;
const METADATA_URL = `${SERVER_URL}/.well-known/oauth-authorization-server`;
const COMMAND_TIMEOUT_MS = 30_000;

const LOG_BUFFER_MAX = 800;

let shareUrlCache: Record<string, string> = {};

function shareCachePath(): string {
  return join(app.getPath('userData'), 'share-urls.json');
}

function loadShareUrlCache(): void {
  try {
    const raw = readFileSync(shareCachePath(), 'utf8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    if (parsed && typeof parsed === 'object') {
      shareUrlCache = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => typeof value === 'string'),
      );
    }
  } catch {
    /* no cache yet */
  }
}

function persistShareUrlCache(): void {
  const file = shareCachePath();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(shareUrlCache, null, 2), { mode: 0o600 });
  } catch (error) {
    appendServerLog(`Could not persist share URL cache: ${(error as Error).message}\n`);
  }
}

function rememberShareUrl(id: string, url: string): void {
  if (!id || !url) return;
  shareUrlCache[id] = url;
  persistShareUrlCache();
}

function forgetShareUrl(id: string): void {
  if (id in shareUrlCache) {
    delete shareUrlCache[id];
    persistShareUrlCache();
  }
}

let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcessWithoutNullStreams | null = null;
let serverLog: string[] = [];

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 920,
    minHeight: 640,
    title: 'mvmt',
    backgroundColor: '#f7f5ef',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  loadShareUrlCache();
  registerIpcHandlers();
  createWindow();
  void autoStartOnLaunch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopManagedServerProcess();
});

function registerIpcHandlers(): void {
  ipcMain.handle('mvmt:status', () => getServerStatus());
  ipcMain.handle('mvmt:start-server', () => startServer());
  ipcMain.handle('mvmt:stop-server', () => stopServer());
  ipcMain.handle('mvmt:select-folder', () => selectFolder());
  ipcMain.handle('mvmt:mounts:list', () => listMounts());
  ipcMain.handle('mvmt:mounts:add', (_event, input: AddMountInput) => addMount(input));
  ipcMain.handle('mvmt:mounts:remove', (_event, name: string) => removeMount(name));
  ipcMain.handle('mvmt:tokens:list', () => listTokens());
  ipcMain.handle('mvmt:tokens:create', (_event, input: CreateTokenInput) => createToken(input));
  ipcMain.handle('mvmt:tokens:edit', (_event, id: string, input: EditTokenInput) =>
    editToken(id, input),
  );
  ipcMain.handle('mvmt:tokens:rotate', (_event, id: string) => rotateToken(id));
  ipcMain.handle('mvmt:tokens:remove', (_event, id: string) => removeToken(id));
  ipcMain.handle('mvmt:shares:list', () => listShares());
  ipcMain.handle('mvmt:shares:add', (_event, input: CreateShareInput) => addShare(input));
  ipcMain.handle('mvmt:shares:remove', (_event, id: string) => removeShare(id));
  ipcMain.handle('mvmt:shares:browse', (_event, input: BrowseShareInput) => browseAndShare(input));
  ipcMain.handle('mvmt:mounts:files', (_event, name: string) => listMountFiles(name));
  ipcMain.handle('mvmt:reindex', () => runMvmt(['reindex']));
  ipcMain.handle('mvmt:open-local-server', () => shell.openExternal(METADATA_URL));
  ipcMain.handle('mvmt:tunnel:status', () => runTunnelCommand([]));
  ipcMain.handle('mvmt:tunnel:start', () => runTunnelCommand(['start']));
  ipcMain.handle('mvmt:tunnel:stop', () => runTunnelCommand(['stop']));
  ipcMain.handle('mvmt:tunnel:refresh', () => runTunnelCommand(['refresh']));
  ipcMain.handle('mvmt:tunnel:logs', () => runTunnelCommand(['logs']));
  ipcMain.handle('mvmt:open-external', (_event, url: string) => openExternalUrl(url));
  ipcMain.handle('mvmt:logs:get', () => getServerLog());
  ipcMain.handle('mvmt:logs:clear', () => {
    serverLog = [];
    return '';
  });
}

function openExternalUrl(url: string): Promise<void> {
  if (typeof url !== 'string') return Promise.resolve();
  if (!/^https?:\/\//i.test(url)) return Promise.resolve();
  return shell.openExternal(url);
}

const EMPTY_TUNNEL: TunnelStatus = {
  configured: false,
  running: false,
  publicUrl: null,
  command: null,
  recentLogs: [],
  raw: '',
};

async function runTunnelCommand(verb: string[]): Promise<TunnelStatus> {
  try {
    const result = await runMvmt(['tunnel', ...verb]);
    return parseTunnelOutput(result.stdout, result.stderr, verb);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/mvmt is not running/i.test(message)) {
      return { ...EMPTY_TUNNEL, raw: message };
    }
    if (/No session token found/i.test(message) || /Config not found/i.test(message)) {
      return { ...EMPTY_TUNNEL, raw: message };
    }
    throw error;
  }
}

function parseTunnelOutput(stdout: string, stderr: string, verb: string[]): TunnelStatus {
  const raw = (stdout + (stderr ? `\n${stderr}` : '')).trim();
  const text = raw;
  const lower = text.toLowerCase();

  const urlMatch = text.match(/https:\/\/[^\s)>\]]+/);
  const publicUrl = urlMatch ? stripTrailingPunct(urlMatch[0]) : null;

  const notConfigured =
    /tunnel is not configured/i.test(text) || /no tunnel is configured/i.test(text);
  const stoppedHint = /tunnel stopped\b/i.test(lower) || /tunnel is configured but not running/i.test(lower);
  const explicitlyRunning = /\brunning\b/i.test(lower) && !/not running/i.test(lower);

  let running = Boolean(publicUrl) || explicitlyRunning;
  if (verb[0] === 'stop' || stoppedHint) running = false;

  const configured = !notConfigured;

  const recentLogs =
    verb[0] === 'logs'
      ? text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line && !/^mvmt tunnel logs$/i.test(line))
          .slice(-30)
      : [];

  return {
    configured,
    running,
    publicUrl,
    command: extractField(text, /^\s*command:\s*(.+)$/im),
    recentLogs,
    raw,
  };
}

function stripTrailingPunct(value: string): string {
  return value.replace(/[.,;:!?'")\]]+$/g, '');
}

function extractField(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match ? match[1].trim() : null;
}

async function runMvmt(args: string[]): Promise<CommandResult> {
  if (!existsSync(MVMT_BIN)) {
    throw new Error(`mvmt engine was not found at ${MVMT_BIN}`);
  }

  return new Promise((resolve, reject) => {
    const child = spawn(MVMT_NODE_BIN, [MVMT_BIN, '--no-update-check', ...args], {
      env: mvmtSpawnEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`mvmt ${args.join(' ')} timed out after ${COMMAND_TIMEOUT_MS / 1000}s`));
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || stdout.trim() || `mvmt exited ${code}`));
    });
  });
}

async function listMounts(): Promise<MountSummary[]> {
  try {
    const result = await runMvmt(['mounts', '--json']);
    return parseJson<{ mounts: MountSummary[] }>(result.stdout, 'mount list').mounts;
  } catch (error) {
    if (isMissingConfigError(error)) return [];
    throw error;
  }
}

async function addMount(input: AddMountInput): Promise<CommandResult> {
  const name = requireValue(input.name, 'Mount name');
  const root = requireValue(input.root, 'Folder');
  const mountPath = requireValue(input.mountPath, 'Mount path');
  const args = ['mounts', 'add', name, root, '--mount-path', mountPath, input.writeAccess ? '--write' : '--read-only'];

  if (input.description?.trim()) args.push('--description', input.description.trim());
  if (input.guidance?.trim()) args.push('--guidance', input.guidance.trim());

  return runMvmt(args);
}

function removeMount(name: string): Promise<CommandResult> {
  return runMvmt(['mounts', 'remove', requireValue(name, 'Mount name'), '--yes']);
}

async function listTokens(): Promise<TokenSummary[]> {
  try {
    const result = await runMvmt(['token', '--json']);
    return parseJson<{ tokens: TokenSummary[] }>(result.stdout, 'token list').tokens;
  } catch (error) {
    if (isMissingConfigError(error)) return [];
    throw error;
  }
}

function createToken(input: CreateTokenInput): Promise<CommandResult> {
  const id = requireValue(input.id, 'Token id');
  const scopes = input.scopes.map((scope) => scope.trim()).filter(Boolean);
  if (scopes.length === 0) throw new Error('At least one token scope is required.');

  const args = ['token', 'add', id];
  if (input.name?.trim()) args.push('--name', input.name.trim());
  for (const scope of scopes) args.push('--scope', scope);
  if (input.client?.trim()) args.push('--client', input.client.trim());
  if (input.expires?.trim()) args.push('--expires', input.expires.trim());

  return runMvmt(args);
}

function editToken(id: string, input: EditTokenInput): Promise<CommandResult> {
  const tokenId = requireValue(id, 'Token id');
  const args = ['token', 'edit', tokenId];

  if (input.scopes !== undefined) {
    const scopes = input.scopes.map((s) => s.trim()).filter(Boolean);
    if (scopes.length === 0) {
      args.push('--no-permissions');
    } else {
      for (const scope of scopes) args.push('--scope', scope);
    }
  }
  if (input.client !== undefined) {
    args.push('--client', input.client.trim() || 'any');
  }
  if (input.expires !== undefined) {
    args.push('--expires', input.expires.trim() || 'never');
  }

  if (args.length === 3) {
    throw new Error('No edits specified.');
  }
  return runMvmt(args);
}

function rotateToken(id: string): Promise<CommandResult> {
  return runMvmt(['token', 'rotate', requireValue(id, 'Token id'), '--yes']);
}

function removeToken(id: string): Promise<CommandResult> {
  return runMvmt(['token', 'remove', requireValue(id, 'Token id'), '--yes']);
}

async function listShares(): Promise<ShareSummary[]> {
  try {
    const result = await runMvmt(['share', '--json']);
    const parsed = parseJson<{ shares: RawShare[] }>(result.stdout, 'share list');
    const shares = parsed.shares.map(toShareSummary);
    // Garbage-collect cached URLs whose share is gone.
    const liveIds = new Set(shares.map((s) => s.id));
    let pruned = false;
    for (const id of Object.keys(shareUrlCache)) {
      if (!liveIds.has(id)) {
        delete shareUrlCache[id];
        pruned = true;
      }
    }
    if (pruned) persistShareUrlCache();
    return shares;
  } catch (error) {
    if (isMissingConfigError(error)) return [];
    throw error;
  }
}

async function addShare(input: CreateShareInput): Promise<CreatedShare> {
  const path = requireValue(input.path, 'Share path');
  // Note: `mvmt share add --json` is a no-op upstream (commander routes --json
  // to the parent `share` command, never to the subcommand), so we parse the
  // human-readable output. Re-add --json once the engine ships the fix.
  const args = ['share', 'add', path];
  if (input.expires?.trim()) args.push('--expires', input.expires.trim());
  const result = await runMvmt(args);
  const created = parseShareAddOutput(result.stdout, path);
  rememberShareUrl(created.share.id, created.url);
  return created;
}

function parseShareAddOutput(stdout: string, fallbackPath: string): CreatedShare {
  const field = (key: string): string | null => {
    const match = stdout.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm'));
    return match ? match[1].trim() : null;
  };
  const url = field('URL');
  if (!url) {
    throw new Error(`Could not parse share URL from mvmt output:\n${stdout.trim()}`);
  }
  const expiresLine = field('Expires');
  // Expires line may look like "2026-05-09T03:29:14.716Z" or "2026-... (24h default)"
  const expiresAt = expiresLine
    ? expiresLine.replace(/\s*\(.*\)\s*$/, '').trim()
    : null;
  const path = field('Path') ?? fallbackPath;
  let id = '';
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments[0] === 'share' && segments[1]) id = segments[1];
  } catch {
    /* ignore */
  }
  return {
    share: {
      id,
      path,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt && expiresAt !== 'never' ? expiresAt : null,
      downloadCount: 0,
      revokedAt: null,
    },
    url,
  };
}

async function removeShare(id: string): Promise<CommandResult> {
  const shareId = requireValue(id, 'Share id');
  const result = await runMvmt(['share', 'remove', shareId]);
  forgetShareUrl(shareId);
  return result;
}

async function listMountFiles(mountName: string): Promise<MountFileEntry[]> {
  const name = requireValue(mountName, 'Mount name');
  const mounts = await listMounts();
  const mount = mounts.find((m) => m.name === name);
  if (!mount) throw new Error(`Unknown mount: ${name}`);
  return enumerateFiles(mount.root, mount.path);
}

function enumerateFiles(root: string, mountPath: string): MountFileEntry[] {
  const results: MountFileEntry[] = [];
  const stack: { dir: string; rel: string }[] = [{ dir: root, rel: '' }];
  let count = 0;
  while (stack.length > 0 && count < 500) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const childRel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      const absolute = join(current.dir, entry.name);
      let size = 0;
      let isDirectory = entry.isDirectory();
      try {
        if (entry.isFile()) {
          const stat = statSync(absolute);
          size = stat.size;
        }
      } catch {
        continue;
      }
      results.push({
        name: entry.name,
        virtualPath: joinVirtualPath(mountPath, childRel),
        isDirectory,
        size,
      });
      count += 1;
      if (count >= 500) break;
      if (isDirectory && current.rel.split('/').filter(Boolean).length < 3) {
        stack.push({ dir: absolute, rel: childRel });
      }
    }
  }
  return results.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.virtualPath.localeCompare(b.virtualPath);
  });
}

function joinVirtualPath(mountPath: string, rel: string): string {
  const left = mountPath.endsWith('/') ? mountPath.slice(0, -1) : mountPath;
  return `${left}/${rel}`;
}

async function browseAndShare(input: BrowseShareInput): Promise<BrowseShareResult | null> {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ['openFile'],
    title: 'Pick a file to share',
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];

  let stat;
  try {
    stat = statSync(filePath);
  } catch (error) {
    throw new Error(`Cannot read ${filePath}: ${(error as Error).message}`);
  }
  if (!stat.isFile()) {
    throw new Error('Selected entry is not a file.');
  }

  const mounts = await listMounts();
  const existing = findEnclosingMount(filePath, mounts);
  let mountCreated = false;
  let mountName: string;
  let virtualPath: string;

  if (existing) {
    mountName = existing.mount.name;
    virtualPath = existing.virtualPath;
  } else {
    const filename = basename(filePath);
    const slug = makeMountSlug(filename);
    mountName = slug;
    virtualPath = `/${filename}`;
    await runMvmt([
      'mounts',
      'add',
      mountName,
      filePath,
      '--mount-path',
      virtualPath,
      '--read-only',
      '--description',
      `Auto-mount for shared file ${filename}`,
    ]);
    mountCreated = true;
  }

  const created = await addShare({ path: virtualPath, expires: input.expires });
  return {
    share: created.share,
    url: created.url,
    mountCreated,
    mountName,
    virtualPath,
  };
}

function findEnclosingMount(
  filePath: string,
  mounts: MountSummary[],
): { mount: MountSummary; virtualPath: string } | null {
  const targetReal = resolvePath(filePath);
  for (const mount of mounts) {
    const root = resolvePath(mount.root);
    if (root === targetReal) {
      // Mount is the file itself
      return { mount, virtualPath: mount.path };
    }
    const rel = pathRelative(root, targetReal);
    if (!rel || rel.startsWith('..') || rel.includes(`..${sep}`)) continue;
    const virtualSuffix = rel.split(sep).join('/');
    return { mount, virtualPath: joinVirtualPath(mount.path, virtualSuffix) };
  }
  return null;
}

function makeMountSlug(filename: string): string {
  const stem = filename.replace(/\.[^.]+$/, '').toLowerCase();
  const safe = stem.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'file';
  const suffix = Math.random().toString(36).slice(2, 6);
  return `share-${safe}-${suffix}`;
}

interface RawShare {
  id: string;
  path: string;
  createdAt: string;
  expiresAt?: string | null;
  downloadCount?: number;
  revokedAt?: string | null;
}

function toShareSummary(raw: RawShare): ShareSummary {
  return {
    id: raw.id,
    path: raw.path,
    createdAt: raw.createdAt,
    expiresAt: raw.expiresAt ?? null,
    downloadCount: raw.downloadCount ?? 0,
    revokedAt: raw.revokedAt ?? null,
    url: shareUrlCache[raw.id] ?? null,
  };
}

async function autoStartOnLaunch(): Promise<void> {
  if (!existsSync(MVMT_BIN)) {
    appendServerLog(`Auto-start skipped: engine not found at ${MVMT_BIN}\n`);
    return;
  }
  try {
    const status = await startServer();
    if (!status.reachable) return;
    appendServerLog('Auto-start: server reachable, starting tunnel if configured…\n');
    const tunnel = await runTunnelCommand(['start']).catch((error) => {
      appendServerLog(`Tunnel auto-start failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return null;
    });
    if (tunnel?.publicUrl) {
      appendServerLog(`Auto-start: tunnel up at ${tunnel.publicUrl}\n`);
    } else if (tunnel && !tunnel.configured) {
      appendServerLog('Auto-start: no tunnel configured (run `mvmt tunnel config` once).\n');
    }
  } catch (error) {
    appendServerLog(`Auto-start failed: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

async function startServer(): Promise<ServerStatus> {
  if (serverProcess && serverProcess.exitCode === null) return getServerStatus();
  if (await isServerReachable()) return getServerStatus();
  if (!existsSync(MVMT_BIN)) throw new Error(`mvmt engine was not found at ${MVMT_BIN}`);

  serverLog = [];
  const child = spawn(
    MVMT_NODE_BIN,
    [MVMT_BIN, '--no-update-check', 'serve', '--port', String(MVMT_PORT), '--verbose'],
    {
      env: mvmtSpawnEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  serverProcess = child;

  const appendLog = (chunk: Buffer): void => appendServerLog(chunk.toString());
  child.stdout.on('data', appendLog);
  child.stderr.on('data', appendLog);
  child.on('error', (error) => appendServerLog(error.message));
  child.on('close', (code, signal) => {
    appendServerLog(`mvmt server exited with code ${code ?? 'null'} signal ${signal ?? 'null'}`);
    if (serverProcess === child) serverProcess = null;
  });

  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await isServerReachable()) return getServerStatus();
    if (child.exitCode !== null) {
      // Spawned process died early — likely EADDRINUSE. If something else is on the
      // port and responsive, treat it as adopted.
      if (await isServerReachable()) return getServerStatus();
      const log = serverLog.join('').trim();
      const reason = log.includes('EADDRINUSE')
        ? `Port ${MVMT_PORT} is already in use by another process. Kill it or change MVMT_PORT.`
        : log || `mvmt server exited with code ${child.exitCode}`;
      throw new Error(reason);
    }
    await wait(250);
  }

  return getServerStatus();
}

async function stopServer(): Promise<ServerStatus> {
  if (!serverProcess || serverProcess.exitCode !== null) {
    serverProcess = null;
    return getServerStatus();
  }

  const processToStop = serverProcess;
  processToStop.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => processToStop.once('close', () => resolve())),
    wait(2_000),
  ]);

  if (processToStop.exitCode === null) processToStop.kill('SIGKILL');
  serverProcess = null;
  return getServerStatus();
}

async function getServerStatus(): Promise<ServerStatus> {
  const reachable = await isServerReachable();
  return {
    enginePath: MVMT_BIN,
    port: MVMT_PORT,
    serverUrl: SERVER_URL,
    metadataUrl: METADATA_URL,
    engineExists: existsSync(MVMT_BIN),
    managedProcessRunning: Boolean(serverProcess && serverProcess.exitCode === null),
    reachable,
    pid: serverProcess?.pid ?? null,
    lastLog: serverLog.slice(-18).join('').trim(),
  };
}

async function selectFolder(): Promise<string | null> {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0] ?? null;
}

function isServerReachable(): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: MVMT_PORT,
        path: '/.well-known/oauth-authorization-server',
        method: 'GET',
        timeout: 1_500,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          resolve(false);
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total > 64_000) {
            res.destroy();
            resolve(false);
          }
        });
        res.on('error', () => resolve(false));
        res.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
              issuer?: unknown;
              authorization_endpoint?: unknown;
              token_endpoint?: unknown;
            };
            const ok =
              typeof body.issuer === 'string' &&
              typeof body.authorization_endpoint === 'string' &&
              typeof body.token_endpoint === 'string';
            resolve(ok);
          } catch {
            resolve(false);
          }
        });
      },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

function appendServerLog(text: string): void {
  serverLog.push(text);
  if (serverLog.length > LOG_BUFFER_MAX) serverLog = serverLog.slice(-LOG_BUFFER_MAX);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('mvmt:log-chunk', text);
  }
}

function getServerLog(): string {
  return serverLog.join('');
}

function stopManagedServerProcess(): void {
  if (serverProcess && serverProcess.exitCode === null) {
    serverProcess.kill('SIGTERM');
  }
  serverProcess = null;
}

function parseJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const sample = value.trim().slice(0, 500);
    throw new Error(`Could not parse mvmt ${label} JSON output.${sample ? ` Output: ${sample}` : ''}`);
  }
}

function requireValue(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${label} is required.`);
  return trimmed;
}

function isMissingConfigError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('Config not found');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
