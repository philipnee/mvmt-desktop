export interface CommandResult {
  stdout: string;
  stderr: string;
}

export interface ServerStatus {
  enginePath: string;
  port: number;
  serverUrl: string;
  metadataUrl: string;
  engineExists: boolean;
  managedProcessRunning: boolean;
  reachable: boolean;
  pid: number | null;
  lastLog: string;
}

export interface MountSummary {
  name: string;
  path: string;
  root: string;
  enabled: boolean;
  writeAccess: boolean;
  description?: string;
  guidance?: string;
  exclude: string[];
  protect: string[];
}

export interface TunnelStatus {
  configured: boolean;
  running: boolean;
  publicUrl: string | null;
  command: string | null;
  recentLogs: string[];
  raw: string;
}

export interface TokenSummary {
  name: string;
  scope: string;
  client: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

export interface AddMountInput {
  name: string;
  root: string;
  mountPath: string;
  writeAccess: boolean;
  description?: string;
  guidance?: string;
}

export interface CreateTokenInput {
  id: string;
  name?: string;
  scopes: string[];
  client?: string;
  expires?: string;
}

export interface EditTokenInput {
  scopes?: string[];
  client?: string;
  expires?: string;
}

export interface ShareSummary {
  id: string;
  path: string;
  createdAt: string;
  expiresAt: string | null;
  downloadCount: number;
  revokedAt: string | null;
  /** Cached URL captured at creation (engine only stores a hash). */
  url: string | null;
}

export interface CreateShareInput {
  path: string;
  expires?: string;
}

export interface CreatedShare {
  share: ShareSummary;
  url: string;
}

export interface BrowseShareInput {
  expires?: string;
}

export interface BrowseShareResult {
  share: ShareSummary;
  url: string;
  mountCreated: boolean;
  mountName: string;
  virtualPath: string;
}

export interface MountFileEntry {
  name: string;
  virtualPath: string;
  isDirectory: boolean;
  size: number;
}

export interface MvmtDesktopApi {
  getStatus(): Promise<ServerStatus>;
  startServer(): Promise<ServerStatus>;
  stopServer(): Promise<ServerStatus>;
  selectFolder(): Promise<string | null>;
  listMounts(): Promise<MountSummary[]>;
  addMount(input: AddMountInput): Promise<CommandResult>;
  removeMount(name: string): Promise<CommandResult>;
  listTokens(): Promise<TokenSummary[]>;
  createToken(input: CreateTokenInput): Promise<CommandResult>;
  editToken(id: string, input: EditTokenInput): Promise<CommandResult>;
  rotateToken(id: string): Promise<CommandResult>;
  removeToken(id: string): Promise<CommandResult>;
  listShares(): Promise<ShareSummary[]>;
  createShare(input: CreateShareInput): Promise<CreatedShare>;
  removeShare(id: string): Promise<CommandResult>;
  browseAndShare(input: BrowseShareInput): Promise<BrowseShareResult | null>;
  listMountFiles(mountName: string): Promise<MountFileEntry[]>;
  reindex(): Promise<CommandResult>;
  openLocalServer(): Promise<void>;
  tunnelStatus(): Promise<TunnelStatus>;
  tunnelStart(): Promise<TunnelStatus>;
  tunnelStop(): Promise<TunnelStatus>;
  tunnelRefresh(): Promise<TunnelStatus>;
  tunnelLogs(): Promise<TunnelStatus>;
  openExternal(url: string): Promise<void>;
  getLogs(): Promise<string>;
  clearLogs(): Promise<string>;
  onLogChunk(handler: (chunk: string) => void): () => void;
}
