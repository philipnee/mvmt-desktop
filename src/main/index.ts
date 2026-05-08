import { existsSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { request } from 'node:http';
import { join } from 'node:path';
import {
  type AddMountInput,
  type CommandResult,
  type CreateTokenInput,
  type EditTokenInput,
  type MountSummary,
  type ServerStatus,
  type TokenSummary,
  type TunnelStatus,
} from '../shared/types';

const MVMT_BIN = process.env.MVMT_BIN ?? '/Users/philipnee/code/mvmt/dist/bin/mvmt.js';
const MVMT_NODE_BIN = process.env.MVMT_NODE_BIN ?? 'node';
const MVMT_PORT = Number.parseInt(process.env.MVMT_PORT ?? '4141', 10);
const SERVER_URL = `http://127.0.0.1:${MVMT_PORT}`;
const METADATA_URL = `${SERVER_URL}/.well-known/oauth-authorization-server`;
const COMMAND_TIMEOUT_MS = 30_000;

const LOG_BUFFER_MAX = 800;

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
  registerIpcHandlers();
  createWindow();

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
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
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

async function startServer(): Promise<ServerStatus> {
  if (serverProcess && serverProcess.exitCode === null) return getServerStatus();
  if (await isServerReachable()) return getServerStatus();
  if (!existsSync(MVMT_BIN)) throw new Error(`mvmt engine was not found at ${MVMT_BIN}`);

  serverLog = [];
  const child = spawn(
    MVMT_NODE_BIN,
    [MVMT_BIN, '--no-update-check', 'serve', '--port', String(MVMT_PORT), '--verbose'],
    {
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
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
        const status = res.statusCode ?? 0;
        res.resume();
        resolve(status > 0 && status < 500);
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
