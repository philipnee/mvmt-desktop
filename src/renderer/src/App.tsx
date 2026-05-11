import {
  Check,
  ChevronRight,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  KeyRound,
  Link as LinkIcon,
  Loader2,
  Play,
  Plus,
  RotateCw,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  Fragment,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  LeaseSummary,
  MountFileEntry,
  MountSummary,
  ServerStatus,
  ShareSummary,
  TokenSummary,
  TunnelStatus,
} from '../../shared/types';

interface Notice {
  kind: 'info' | 'error' | 'success';
  text: string;
}

interface MountForm {
  name: string;
  root: string;
  mountPath: string;
  writeAccess: boolean;
  description: string;
}

interface TokenForm {
  id: string;
  displayName: string;
  scopes: string;
  client: string;
  expires: string;
}

interface TokenCreateResult {
  id: string;
  scope: string;
  client: string;
  expires: string;
  token: string;
  url: string;
  raw: string;
}

const defaultMountForm: MountForm = {
  name: '',
  root: '',
  mountPath: '',
  writeAccess: false,
  description: '',
};

const defaultTokenForm: TokenForm = {
  id: '',
  displayName: '',
  scopes: 'all:read',
  client: '',
  expires: 'never',
};

export function App(): JSX.Element {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [mounts, setMounts] = useState<MountSummary[]>([]);
  const [tokens, setTokens] = useState<TokenSummary[]>([]);
  const [mountForm, setMountForm] = useState<MountForm>(defaultMountForm);
  const [tokenForm, setTokenForm] = useState<TokenForm>(defaultTokenForm);
  const [tokenResult, setTokenResult] = useState<TokenCreateResult | null>(null);
  const [revealToken, setRevealToken] = useState(false);
  const [expandedTokens, setExpandedTokens] = useState<Set<string>>(new Set());
  const [logs, setLogs] = useState<string>('');
  const [leases, setLeases] = useState<LeaseSummary[]>([]);
  const [leaseResult, setLeaseResult] = useState<{
    url: string;
    path: string;
    label: string;
    mode: string;
    expiresAt: string | null;
  } | null>(null);
  const [showLeaseForm, setShowLeaseForm] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showMountForm, setShowMountForm] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [showTunnelConfig, setShowTunnelConfig] = useState(false);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [view, setView] = useState<'dashboard' | 'activity'>('dashboard');

  const refresh = useCallback(async () => {
    const [nextStatus, nextMounts, nextTokens, nextLeases] = await Promise.all([
      window.mvmtDesktop.getStatus(),
      window.mvmtDesktop.listMounts(),
      window.mvmtDesktop.listTokens(),
      window.mvmtDesktop.listLeases().catch(() => [] as LeaseSummary[]),
    ]);
    setStatus(nextStatus);
    setMounts(nextMounts);
    setTokens(nextTokens);
    setLeases(nextLeases);
    if (nextStatus.reachable) {
      void window.mvmtDesktop.tunnelStatus().then(setTunnel).catch(() => undefined);
    } else {
      setTunnel(null);
    }
  }, []);

  useEffect(() => {
    void runUiTask('refresh', refresh, { quiet: true });
    const timer = window.setInterval(() => {
      void window.mvmtDesktop
        .getStatus()
        .then((next) => {
          setStatus(next);
          if (next.reachable) {
            void window.mvmtDesktop.tunnelStatus().then(setTunnel).catch(() => undefined);
          } else {
            setTunnel(null);
          }
        })
        .catch(() => undefined);
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    void window.mvmtDesktop.getLogs().then(setLogs).catch(() => undefined);
    const off = window.mvmtDesktop.onLogChunk((chunk) => {
      setLogs((prev) => {
        const next = prev + chunk;
        if (next.length > 200_000) return next.slice(-150_000);
        return next;
      });
    });
    return () => {
      off();
    };
  }, []);

  const enabledMountCount = useMemo(() => mounts.filter((m) => m.enabled).length, [mounts]);
  const writableMountCount = useMemo(
    () => mounts.filter((m) => m.enabled && m.writeAccess).length,
    [mounts],
  );

  async function runUiTask(
    label: string,
    task: () => Promise<void>,
    options: { quiet?: boolean } = {},
  ): Promise<void> {
    setBusy(label);
    if (!options.quiet) setNotice(null);
    try {
      await task();
    } catch (error) {
      setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function startServer(): Promise<void> {
    await runUiTask('server', async () => {
      const next = await window.mvmtDesktop.startServer();
      setStatus(next);
      setNotice({
        kind: next.reachable ? 'success' : 'error',
        text: next.reachable ? 'Server started.' : 'Server did not become reachable.',
      });
    });
  }

  async function stopServer(): Promise<void> {
    await runUiTask('server', async () => {
      setStatus(await window.mvmtDesktop.stopServer());
      setNotice({ kind: 'info', text: 'Server stopped.' });
    });
  }

  async function chooseFolder(): Promise<void> {
    const folder = await window.mvmtDesktop.selectFolder();
    if (!folder) return;
    const name = suggestMountName(folder);
    setMountForm((current) => ({
      ...current,
      root: folder,
      name: current.name || name,
      mountPath: current.mountPath || `/${name}`,
    }));
  }

  async function submitMount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runUiTask('mount', async () => {
      await window.mvmtDesktop.addMount({
        name: mountForm.name,
        root: mountForm.root,
        mountPath: mountForm.mountPath,
        writeAccess: mountForm.writeAccess,
        description: mountForm.description || undefined,
      });
      setMountForm(defaultMountForm);
      setShowMountForm(false);
      await refresh();
      setNotice({ kind: 'success', text: 'Mount saved.' });
    });
  }

  async function removeMount(name: string): Promise<void> {
    if (
      !window.confirm(
        `Remove mount "${name}"? Any tokens scoped to ${name} will lose that access.`,
      )
    ) {
      return;
    }
    await runUiTask(`remove-${name}`, async () => {
      await window.mvmtDesktop.removeMount(name);
      await refresh();
      setNotice({ kind: 'success', text: `Removed mount ${name}.` });
    });
  }

  async function submitToken(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    await runUiTask('token', async () => {
      const result = await window.mvmtDesktop.createToken({
        id: tokenForm.id,
        name: tokenForm.displayName || undefined,
        scopes: tokenForm.scopes.split(',').map((s) => s.trim()).filter(Boolean),
        client: tokenForm.client || undefined,
        expires: tokenForm.expires || undefined,
      });
      const parsed = parseTokenCreateOutput(result.stdout, tokenForm.id, port);
      setTokenResult(parsed);
      setRevealToken(false);
      setTokenForm(defaultTokenForm);
      setShowTokenForm(false);
      await refresh();
      setNotice({ kind: 'success', text: 'Token created. Copy it now.' });
    });
  }

  async function reindex(): Promise<void> {
    await runUiTask('reindex', async () => {
      const result = await window.mvmtDesktop.reindex();
      await refresh();
      setNotice({ kind: 'success', text: result.stdout.trim() || 'Index rebuilt.' });
    });
  }

  async function startTunnel(): Promise<void> {
    if (!tunnel?.configured) {
      setShowTunnelConfig(true);
      setNotice({ kind: 'info', text: 'Choose a tunnel provider below.' });
      return;
    }
    await runUiTask('tunnel', async () => {
      const next = await window.mvmtDesktop.tunnelStart();
      setTunnel(next);
      if (next.publicUrl) {
        setShowTunnelConfig(false);
        setNotice({ kind: 'success', text: `Tunnel up at ${next.publicUrl}` });
      } else if (!next.configured) {
        setShowTunnelConfig(true);
        setNotice({
          kind: 'info',
          text: 'Choose a tunnel provider below.',
        });
      } else {
        setNotice({ kind: 'info', text: 'Tunnel starting…' });
      }
    });
  }

  async function configureQuickTunnel(): Promise<void> {
    await runUiTask('tunnel', async () => {
      const next = await window.mvmtDesktop.tunnelConfigureQuick();
      setTunnel(next);
      setShowTunnelConfig(false);
      if (next.publicUrl) {
        setNotice({ kind: 'success', text: `Tunnel up at ${next.publicUrl}` });
      } else if (next.configured) {
        setNotice({ kind: 'info', text: 'Quick Tunnel configured. Waiting for public URL…' });
      } else {
        setNotice({ kind: 'error', text: next.raw || 'Could not configure Quick Tunnel.' });
      }
    });
  }

  async function configureCloudflareTunnel(path: string): Promise<void> {
    await runUiTask('tunnel', async () => {
      const next = await window.mvmtDesktop.tunnelConfigureCloudflareConfig(path);
      setTunnel(next);
      setShowTunnelConfig(false);
      if (next.publicUrl) {
        setNotice({ kind: 'success', text: `Tunnel configured at ${next.publicUrl}` });
      } else if (next.configured) {
        setNotice({ kind: 'info', text: 'Cloudflare tunnel configured. Start it when ready.' });
      } else {
        setNotice({ kind: 'error', text: next.raw || 'Could not configure Cloudflare tunnel.' });
      }
    });
  }

  async function stopTunnel(): Promise<void> {
    await runUiTask('tunnel', async () => {
      const next = await window.mvmtDesktop.tunnelStop();
      setTunnel(next);
      setNotice({ kind: 'info', text: 'Tunnel stopped.' });
    });
  }

  async function refreshTunnel(): Promise<void> {
    await runUiTask('tunnel', async () => {
      const next = await window.mvmtDesktop.tunnelRefresh();
      setTunnel(next);
      if (next.publicUrl) {
        setNotice({ kind: 'success', text: `New URL: ${next.publicUrl}` });
      }
    });
  }

  async function saveTokenEdit(
    id: string,
    input: { scopes: string[]; client: string; expires: string },
  ): Promise<void> {
    await runUiTask(`token-edit-${id}`, async () => {
      await window.mvmtDesktop.editToken(id, {
        scopes: input.scopes,
        client: input.client,
        expires: input.expires,
      });
      await refresh();
      setNotice({ kind: 'success', text: `Token ${id} updated.` });
    });
  }

  async function rotateTokenById(id: string): Promise<void> {
    await runUiTask(`token-rotate-${id}`, async () => {
      const result = await window.mvmtDesktop.rotateToken(id);
      const parsed = parseTokenCreateOutput(result.stdout, id, port);
      setTokenResult(parsed);
      setRevealToken(false);
      await refresh();
      setNotice({ kind: 'success', text: `Token ${id} rotated. Copy the new value.` });
    });
  }

  async function revokeTokenById(id: string): Promise<void> {
    if (!window.confirm(`Revoke token "${id}"? This cannot be undone.`)) return;
    await runUiTask(`token-remove-${id}`, async () => {
      await window.mvmtDesktop.removeToken(id);
      await refresh();
      setExpandedTokens((current) => {
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      setNotice({ kind: 'success', text: `Token ${id} revoked.` });
    });
  }

  async function createLease(input: {
    paths: string[];
    label: string;
    mode: 'read' | 'upload';
    expires: string;
  }): Promise<void> {
    await runUiTask('lease-create', async () => {
      const result = await window.mvmtDesktop.createLease({
        paths: input.paths,
        label: input.label,
        mode: input.mode,
        expires: input.expires || undefined,
      });
      setLeaseResult({
        url: result.url,
        path: formatLeasePaths(result.lease),
        label: result.lease.label,
        mode: result.lease.permissions.includes('upload') ? 'upload only' : 'browse/download',
        expiresAt: result.lease.expiresAt,
      });
      setShowLeaseForm(false);
      await refresh();
      setNotice({ kind: 'success', text: 'Lease created. Copy the link now.' });
    });
  }

  async function browseAndCreateLease(input: {
    label: string;
    mode: 'read' | 'upload';
    expires: string;
  }): Promise<void> {
    await runUiTask('lease-browse', async () => {
      const result = await window.mvmtDesktop.browseAndCreateLease({
        label: input.label,
        mode: input.mode,
        expires: input.expires || undefined,
      });
      if (!result) return;
      setLeaseResult({
        url: result.url,
        path: formatLeasePaths(result.lease),
        label: result.lease.label,
        mode: result.lease.permissions.includes('upload') ? 'upload only' : 'browse/download',
        expiresAt: result.lease.expiresAt,
      });
      setShowLeaseForm(false);
      await refresh();
      setNotice({ kind: 'success', text: 'Lease created. Copy the link now.' });
    });
  }

  async function revokeLease(id: string, label: string): Promise<void> {
    if (!window.confirm(`Revoke lease "${label}"? Existing links will stop working.`)) return;
    await runUiTask(`lease-revoke-${id}`, async () => {
      await window.mvmtDesktop.revokeLease(id);
      await refresh();
      setNotice({ kind: 'success', text: 'Lease revoked.' });
    });
  }

  async function addPathsToLease(id: string, label: string): Promise<void> {
    await runUiTask(`lease-add-paths-${id}`, async () => {
      const result = await window.mvmtDesktop.browseAndAddLeasePaths(id);
      if (!result) return;
      await refresh();
      setNotice({ kind: 'success', text: `Added paths to "${label}". Existing link now includes them.` });
    });
  }

  async function copyToClipboard(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ kind: 'success', text: `${label} copied.` });
    } catch {
      setNotice({ kind: 'error', text: 'Could not copy to clipboard.' });
    }
  }

  const reachable = Boolean(status?.reachable);
  const port = status?.port ?? 4141;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden>m</div>
          <div className="brand-text">
            <span className="brand-name">mvmt</span>
            <span className="brand-tag">Local file authority</span>
          </div>
        </div>

        <nav className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'dashboard'}
            className={`tab ${view === 'dashboard' ? 'tab-on' : ''}`}
            onClick={() => setView('dashboard')}
          >
            Dashboard
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'activity'}
            className={`tab ${view === 'activity' ? 'tab-on' : ''}`}
            onClick={() => setView('activity')}
          >
            Activity
          </button>
        </nav>

        <div className="header-status">
          <StatusDot reachable={reachable} />
          <span className="status-label">{reachable ? 'Online' : 'Offline'}</span>
          <span className="status-meta">:{port}</span>
        </div>
      </header>

      <main className="app-main">
        {notice && (
          <div className={`notice notice-${notice.kind}`} role="status">
            <span>{notice.text}</span>
            <button className="notice-close" onClick={() => setNotice(null)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )}

        {view === 'dashboard' && (<>
        <EndpointsCard
          status={status}
          tunnel={tunnel}
          reachable={reachable}
          port={port}
          busy={busy}
          showTunnelConfig={showTunnelConfig}
          onStartServer={startServer}
          onStopServer={stopServer}
          onStartTunnel={startTunnel}
          onConfigureQuickTunnel={configureQuickTunnel}
          onConfigureCloudflareTunnel={configureCloudflareTunnel}
          onShowTunnelConfig={() => setShowTunnelConfig(true)}
          onDismissTunnelConfig={() => setShowTunnelConfig(false)}
          onStopTunnel={stopTunnel}
          onRefreshTunnel={refreshTunnel}
          onOpen={(url) => window.mvmtDesktop.openExternal(url)}
          onCopy={copyToClipboard}
        />

        <LeasesCard
          leases={leases}
          tunnel={tunnel}
          serverReachable={reachable}
          showForm={showLeaseForm}
          onToggleForm={() => setShowLeaseForm((v) => !v)}
          leaseResult={leaseResult}
          onDismissResult={() => setLeaseResult(null)}
          busy={busy}
          onCreate={createLease}
          onBrowse={browseAndCreateLease}
          onAddPaths={addPathsToLease}
          onRevoke={revokeLease}
          onOpen={(url) => window.mvmtDesktop.openExternal(url)}
          onCopy={copyToClipboard}
        />
        </>)}

        {view === 'activity' && (
          <LogsCard
            logs={logs}
            serverReachable={reachable}
            tokens={tokens}
            onClear={async () => {
              await window.mvmtDesktop.clearLogs();
              setLogs('');
            }}
          />
        )}

        <footer className="app-footer">
          <span>Engine</span>
          <code className="mono">
            {status?.enginePath ?? '/Users/philipnee/code/mvmt/dist/bin/mvmt.js'}
          </code>
        </footer>
      </main>
    </div>
  );
}

function EndpointsCard({
  status,
  tunnel,
  reachable,
  port,
  busy,
  showTunnelConfig,
  onStartServer,
  onStopServer,
  onStartTunnel,
  onConfigureQuickTunnel,
  onConfigureCloudflareTunnel,
  onShowTunnelConfig,
  onDismissTunnelConfig,
  onStopTunnel,
  onRefreshTunnel,
  onOpen,
  onCopy,
}: {
  status: ServerStatus | null;
  tunnel: TunnelStatus | null;
  reachable: boolean;
  port: number;
  busy: string | null;
  showTunnelConfig: boolean;
  onStartServer: () => void | Promise<void>;
  onStopServer: () => void | Promise<void>;
  onStartTunnel: () => void | Promise<void>;
  onConfigureQuickTunnel: () => void | Promise<void>;
  onConfigureCloudflareTunnel: (path: string) => void | Promise<void>;
  onShowTunnelConfig: () => void | Promise<void>;
  onDismissTunnelConfig: () => void | Promise<void>;
  onStopTunnel: () => void | Promise<void>;
  onRefreshTunnel: () => void | Promise<void>;
  onOpen: (url: string) => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
}): JSX.Element {
  const serverBusy = busy === 'server';
  const tunnelBusy = busy === 'tunnel';
  const [cloudflareConfigPath, setCloudflareConfigPath] = useState('~/.cloudflared/config.yml');
  const localEndpoint = `127.0.0.1:${port}`;
  const localUrl = `http://${localEndpoint}`;
  const publicUrl = tunnel?.publicUrl ?? null;
  const publicBaseUrl = publicUrl ? publicFileBaseUrl(publicUrl) : null;
  const publicMcpUrl = publicBaseUrl ? `${publicBaseUrl}/mcp` : null;
  const tunnelRunning = Boolean(tunnel?.running && publicBaseUrl);
  const tunnelConfigured = Boolean(tunnel?.configured);

  return (
    <section className="card endpoints-card">
      <div className="endpoint-row">
        <div className="endpoint-meta">
          <div className="endpoint-label">
            <StatusDot reachable={reachable} />
            <span>Local endpoint</span>
            {status?.managedProcessRunning && status?.pid ? (
              <span className="endpoint-tag">pid {status.pid}</span>
            ) : reachable ? (
              <span className="endpoint-tag muted-tag">adopted</span>
            ) : null}
          </div>
          <div className="endpoint-value">
            <code className="mono">{localEndpoint}</code>
            {reachable && (
              <div className="endpoint-actions">
                <button
                  type="button"
                  className="row-action"
                  title="Copy"
                  onClick={() => onCopy(localUrl, 'Local URL')}
                >
                  <Copy size={14} />
                </button>
                <button
                  type="button"
                  className="row-action"
                  title="Open in browser"
                  onClick={() => onOpen(localUrl)}
                >
                  <ExternalLink size={14} />
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="endpoint-buttons">
          {reachable ? (
            <PrimaryButton
              variant="ghost"
              icon={<Square size={13} />}
              label="Stop server"
              busy={serverBusy}
              disabled={!status?.managedProcessRunning}
              onClick={onStopServer}
            />
          ) : (
            <PrimaryButton
              icon={<Play size={13} />}
              label="Start server"
              busy={serverBusy}
              onClick={onStartServer}
            />
          )}
        </div>
      </div>

      <div className="endpoint-row">
        <div className="endpoint-meta">
          <div className="endpoint-label">
            <StatusDot reachable={tunnelRunning} />
            <span>Public file access</span>
            {tunnel?.command && tunnelRunning ? (
              <span className="endpoint-tag">{providerLabel(tunnel.command)}</span>
            ) : null}
          </div>
          <div className="endpoint-value">
            {publicBaseUrl ? (
              <>
                <code className="mono endpoint-url">{publicBaseUrl}</code>
                <div className="endpoint-actions">
                  <button
                    type="button"
                    className="row-action"
                    title="Copy"
                    onClick={() => onCopy(publicBaseUrl, 'Public file URL')}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    className="row-action"
                    title="Open in browser"
                    onClick={() => onOpen(publicBaseUrl)}
                  >
                    <ExternalLink size={14} />
                  </button>
                </div>
              </>
            ) : (
              <span className="endpoint-empty">
                {!reachable
                  ? 'Start the server first.'
                  : !tunnelConfigured
                    ? 'Not configured.'
                    : 'Not exposed.'}
              </span>
            )}
          </div>
        </div>
        <div className="endpoint-buttons">
          {tunnelRunning ? (
            <>
              <PrimaryButton
                icon={<RotateCw size={13} />}
                label="Refresh endpoint"
                busy={tunnelBusy}
                onClick={onRefreshTunnel}
              />
              <GhostButton
                icon={<Settings size={14} />}
                label="Reconfigure"
                busy={tunnelBusy}
                onClick={onShowTunnelConfig}
              />
              <GhostButton
                icon={<Square size={14} />}
                label="Stop"
                busy={tunnelBusy}
                onClick={onStopTunnel}
              />
            </>
          ) : (
            <>
              <PrimaryButton
                icon={<Globe size={13} />}
                label="Start tunnel"
                busy={tunnelBusy}
                disabled={!reachable}
                onClick={onStartTunnel}
              />
              {tunnelConfigured && (
                <GhostButton
                  icon={<Settings size={14} />}
                  label="Reconfigure"
                  busy={tunnelBusy}
                  disabled={!reachable}
                  onClick={onShowTunnelConfig}
                />
              )}
            </>
          )}
        </div>
      </div>

      {publicBaseUrl && (
        <div className="endpoint-hint">
          <span>Lease links are created as</span>
          <code className="mono">{publicBaseUrl}/lease/&lt;id&gt;</code>
          <span className="muted">from the Leases card.</span>
          {publicMcpUrl && (
            <>
              <span className="muted">MCP</span>
              <code className="mono">{publicMcpUrl}</code>
              <button
                type="button"
                className="link-button"
                onClick={() => onCopy(publicMcpUrl, 'MCP endpoint')}
              >
                Copy
              </button>
            </>
          )}
        </div>
      )}

      {showTunnelConfig && reachable && (
        <div className="endpoint-hint">
          <span>{tunnelConfigured ? 'Reconfigure tunnel' : 'Choose a tunnel'}</span>
          <button
            type="button"
            className="link-button"
            disabled={tunnelBusy}
            onClick={onConfigureQuickTunnel}
          >
            Quick Tunnel
          </button>
          <button
            type="button"
            className="link-button"
            disabled={tunnelBusy}
            onClick={() => onConfigureCloudflareTunnel(cloudflareConfigPath)}
          >
            Cloudflare config
          </button>
          <input
            className="endpoint-path-input"
            value={cloudflareConfigPath}
            onChange={(event) => setCloudflareConfigPath(event.target.value)}
            placeholder="~/.cloudflared/config.yml"
            disabled={tunnelBusy}
          />
          <button
            type="button"
            className="link-button muted"
            disabled={tunnelBusy}
            onClick={onDismissTunnelConfig}
          >
            Cancel
          </button>
        </div>
      )}

    </section>
  );
}

function providerLabel(command: string): string {
  const lower = command.toLowerCase();
  if (lower.includes('cloudflared')) return 'cloudflared';
  if (lower.includes('lhr.life') || lower.includes('localhost.run')) return 'localhost.run';
  return command.split(/\s+/)[0] ?? 'tunnel';
}

function publicFileBaseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.search = '';
    if (parsed.pathname === '/mcp' || parsed.pathname === '/') parsed.pathname = '';
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return value.replace(/\/mcp\/?$/, '').replace(/\/+$/, '');
  }
}

function StatusDot({ reachable }: { reachable: boolean }): JSX.Element {
  return <span className={`status-dot ${reachable ? 'on' : 'off'}`} aria-hidden />;
}

function AccessBadge({ writeAccess }: { writeAccess: boolean }): JSX.Element {
  return (
    <span className={`access-badge ${writeAccess ? 'write' : 'read'}`}>
      {writeAccess ? 'read · write' : 'read-only'}
    </span>
  );
}

function Meta({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="meta">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  );
}

function Field({
  label,
  required,
  full,
  children,
}: {
  label: string;
  required?: boolean;
  full?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <label className={`field${full ? ' field-full' : ''}`}>
      <span className="field-label">
        {label}
        {required && <span className="field-required" aria-hidden> *</span>}
      </span>
      {children}
    </label>
  );
}

function EmptyState({
  icon,
  title,
  hint,
}: {
  icon: JSX.Element;
  title: string;
  hint: string;
}): JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <p className="empty-title">{title}</p>
      <p className="empty-hint">{hint}</p>
    </div>
  );
}

function PrimaryButton({
  label,
  icon,
  busy,
  disabled,
  onClick,
  type = 'button',
  variant = 'solid',
}: {
  label: string;
  icon?: JSX.Element;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void | Promise<void>;
  type?: 'button' | 'submit';
  variant?: 'solid' | 'ghost';
}): JSX.Element {
  return (
    <button
      type={type}
      className={`btn ${variant === 'solid' ? 'btn-primary' : 'btn-ghost'}`}
      disabled={disabled || busy}
      onClick={onClick}
    >
      {busy ? <Loader2 size={13} className="spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}

function GhostButton({
  label,
  icon,
  busy,
  disabled,
  onClick,
}: {
  label: string;
  icon: JSX.Element;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void | Promise<void>;
}): JSX.Element {
  return (
    <button className="btn btn-ghost" type="button" disabled={disabled || busy} onClick={onClick}>
      {busy ? <Loader2 size={14} className="spin" /> : icon}
      <span>{label}</span>
    </button>
  );
}

function suggestMountName(folder: string): string {
  const last = folder.split('/').filter(Boolean).pop() ?? 'mount';
  return last.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mount';
}

function formatExpiry(value: string | null): string {
  if (!value) return 'never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (date.getTime() < Date.now()) return 'expired';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Detail({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}): JSX.Element {
  return (
    <div className="detail">
      <dt>{label}</dt>
      <dd className={mono ? 'mono' : undefined}>{value}</dd>
    </div>
  );
}

function parseTokenCreateOutput(
  stdout: string,
  fallbackId: string,
  port: number,
): TokenCreateResult {
  const fields = (key: string): string | null => {
    const match = stdout.match(new RegExp(`^\\s*${key}:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : null;
  };
  const tokenLine = fields('Token');
  const headerMatch = stdout.match(/Authorization:\s*Bearer\s+(\S+)/);
  const urlMatch = stdout.match(/URL:\s*(https?:\/\/\S+)/);
  return {
    id: fields('Name') ?? fallbackId,
    scope: fields('Scope') ?? '',
    client: fields('Client') ?? '(any)',
    expires: fields('Expires') ?? 'never',
    token: tokenLine ?? headerMatch?.[1] ?? '',
    url: urlMatch?.[1] ?? `http://127.0.0.1:${port}/mcp`,
    raw: stdout.trim(),
  };
}

function TokenResultCard({
  result,
  revealed,
  onReveal,
  onDismiss,
  onCopy,
}: {
  result: TokenCreateResult;
  revealed: boolean;
  onReveal: () => void;
  onDismiss: () => void;
  onCopy: (text: string, label: string) => void | Promise<void>;
}): JSX.Element {
  const masked = result.token ? '•'.repeat(Math.min(result.token.length, 36)) : '';
  const headerValue = result.token ? `Authorization: Bearer ${result.token}` : '';
  return (
    <div className="token-result">
      <div className="token-result-head">
        <div>
          <div className="token-result-title">
            <Check size={14} aria-hidden /> Token created
          </div>
          <div className="token-result-warn">
            This is the only time the token will be shown — copy it now.
          </div>
        </div>
        <button type="button" className="link-button" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      <dl className="token-result-meta">
        <Detail label="Name" value={result.id} />
        <Detail label="Scope" value={result.scope} mono />
        <Detail label="Client" value={result.client} />
        <Detail label="Expires" value={result.expires} />
      </dl>

      {result.token && (
        <div className="token-secret">
          <span className="token-secret-label">Token</span>
          <code className="token-secret-value mono">
            {revealed ? result.token : masked}
          </code>
          <button
            type="button"
            className="row-action"
            title={revealed ? 'Hide' : 'Reveal'}
            onClick={onReveal}
          >
            {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
          </button>
          <button
            type="button"
            className="row-action"
            title="Copy token"
            onClick={() => onCopy(result.token, 'Token')}
          >
            <Copy size={14} />
          </button>
        </div>
      )}

      <div className="token-secret">
        <span className="token-secret-label">MCP URL</span>
        <code className="token-secret-value mono">{result.url}</code>
        <button
          type="button"
          className="row-action"
          title="Copy URL"
          onClick={() => onCopy(result.url, 'MCP URL')}
        >
          <Copy size={14} />
        </button>
      </div>

      {result.token && (
        <div className="token-secret">
          <span className="token-secret-label">Header</span>
          <code className="token-secret-value mono">
            {revealed ? headerValue : `Authorization: Bearer ${masked}`}
          </code>
          <button
            type="button"
            className="row-action"
            title="Copy header"
            onClick={() => onCopy(headerValue, 'Auth header')}
          >
            <Copy size={14} />
          </button>
        </div>
      )}
    </div>
  );
}

interface ParsedLogLine {
  raw: string;
  ts?: string;
  status?: number;
  kind?: string;
  method?: string;
  path?: string;
  client?: string;
  detail?: string;
}

function parseLogLine(raw: string): ParsedLogLine {
  // Verbose format from formatHttpRequestEntry (color-stripped):
  // "12:34:56 PM 200 mcp GET /books client=desktop detail..."
  const match = raw.match(
    /^(\d{1,2}:\d{2}:\d{2}(?:\s?[AP]M)?)\s+(\d{3})\s+(\S+)\s+(\S+)\s+(\S+)(.*)$/,
  );
  if (!match) return { raw };
  const [, ts, status, kind, method, path, rest] = match;
  const clientMatch = rest.match(/client=(\S+)/);
  const detail = rest.replace(/client=\S+\s*/, '').trim();
  return {
    raw,
    ts,
    status: Number(status),
    kind,
    method,
    path,
    client: clientMatch?.[1],
    detail: detail || undefined,
  };
}

function LogsCard({
  logs,
  serverReachable,
  tokens,
  onClear,
}: {
  logs: string;
  serverReachable: boolean;
  tokens: TokenSummary[];
  onClear: () => void | Promise<void>;
}): JSX.Element {
  const [filter, setFilter] = useState<'all' | 'requests'>('all');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const lines = useMemo(() => {
    const split = logs.split('\n').filter((line) => line.length > 0);
    return split.map(parseLogLine);
  }, [logs]);

  const visible = useMemo(
    () => (filter === 'requests' ? lines.filter((line) => line.status !== undefined) : lines),
    [filter, lines],
  );

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible, autoScroll]);

  const tokenLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const token of tokens) {
      map.set(token.name, token.name);
      if (token.client) map.set(token.client, token.name);
    }
    return map;
  }, [tokens]);

  return (
    <section className="card logs-card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Activity</h2>
          <p className="card-sub">
            {serverReachable
              ? 'Live mvmt server output. Request lines show the token making the call.'
              : 'Start the server to stream logs.'}
          </p>
        </div>
        <div className="card-actions">
          <div className="segmented">
            <button
              type="button"
              className={filter === 'all' ? 'on' : ''}
              onClick={() => setFilter('all')}
            >
              All
            </button>
            <button
              type="button"
              className={filter === 'requests' ? 'on' : ''}
              onClick={() => setFilter('requests')}
            >
              Requests
            </button>
          </div>
          <label className="toggle-row inline-toggle">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            <span>Auto-scroll</span>
          </label>
          <GhostButton
            icon={<Eraser size={14} />}
            label="Clear"
            onClick={onClear}
            disabled={logs.length === 0}
          />
        </div>
      </div>

      <div className="logs-view" ref={scrollRef}>
        {visible.length === 0 ? (
          <div className="logs-empty">
            {logs.length === 0
              ? 'No output yet.'
              : 'No request lines yet — they appear when clients hit the server.'}
          </div>
        ) : (
          visible.map((line, index) => (
            <LogRow key={index} line={line} tokenLabels={tokenLabels} />
          ))
        )}
      </div>
    </section>
  );
}

function LogRow({
  line,
  tokenLabels,
}: {
  line: ParsedLogLine;
  tokenLabels: Map<string, string>;
}): JSX.Element {
  if (line.status === undefined) {
    return <div className="log-line log-line-plain">{line.raw}</div>;
  }
  const statusClass =
    line.status >= 500
      ? 'status-error'
      : line.status >= 400
        ? 'status-warn'
        : line.status >= 300
          ? 'status-info'
          : 'status-ok';
  const tokenName = line.client ? tokenLabels.get(line.client) ?? line.client : null;
  return (
    <div className="log-line log-line-req">
      {line.ts && <span className="log-time">{line.ts}</span>}
      <span className={`log-status ${statusClass}`}>{line.status}</span>
      {line.kind && <span className="log-kind">{line.kind}</span>}
      <span className="log-method">{line.method}</span>
      <span className="log-path">{line.path}</span>
      {tokenName && <span className="log-token">{tokenName}</span>}
      {line.detail && <span className="log-detail">{line.detail}</span>}
    </div>
  );
}

function parseScopeList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitScope(scope: string): { mount: string; permission: string } {
  const idx = scope.indexOf(':');
  if (idx < 0) return { mount: scope, permission: 'read' };
  return { mount: scope.slice(0, idx), permission: scope.slice(idx + 1) };
}

function ScopePicker({
  mounts,
  value,
  onChange,
}: {
  mounts: MountSummary[];
  value: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const enabledMounts = useMemo(() => mounts.filter((m) => m.enabled), [mounts]);
  const mountOptions = useMemo(() => {
    const known = new Set<string>(['all', ...enabledMounts.map((m) => m.name)]);
    for (const scope of value) {
      const { mount } = splitScope(scope);
      if (mount) known.add(mount);
    }
    return Array.from(known);
  }, [enabledMounts, value]);

  const writeAllowed = (mount: string): boolean => {
    if (mount === 'all') return true;
    const m = enabledMounts.find((entry) => entry.name === mount);
    return m ? m.writeAccess : true; // unknown (legacy) — let the CLI validate
  };

  const updateRow = (index: number, partial: Partial<{ mount: string; permission: string }>): void => {
    const current = splitScope(value[index] ?? 'all:read');
    const next = { ...current, ...partial };
    if (next.permission === 'write' && !writeAllowed(next.mount)) {
      next.permission = 'read';
    }
    const updated = [...value];
    updated[index] = `${next.mount}:${next.permission}`;
    onChange(updated);
  };

  const removeRow = (index: number): void => {
    onChange(value.filter((_, i) => i !== index));
  };

  const addRow = (): void => {
    const used = new Set(value.map((scope) => splitScope(scope).mount));
    const nextMount =
      mountOptions.find((m) => !used.has(m)) ?? mountOptions[0] ?? 'all';
    onChange([...value, `${nextMount}:read`]);
  };

  return (
    <div className="scope-picker">
      {value.length === 0 && (
        <p className="scope-empty">No permissions yet. Add one to grant access.</p>
      )}
      {value.map((scope, index) => {
        const { mount, permission } = splitScope(scope);
        const writeOk = writeAllowed(mount);
        return (
          <div key={index} className="scope-row">
            <div className="scope-select">
              <select
                value={mount}
                onChange={(event) => updateRow(index, { mount: event.target.value })}
              >
                {mountOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
            <span className="scope-sep">:</span>
            <div className="scope-select">
              <select
                value={permission}
                onChange={(event) => updateRow(index, { permission: event.target.value })}
              >
                <option value="read">read</option>
                <option value="write" disabled={!writeOk}>
                  write{!writeOk ? ' (mount is read-only)' : ''}
                </option>
              </select>
            </div>
            <button
              type="button"
              className="row-action"
              title="Remove permission"
              onClick={() => removeRow(index)}
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
      <button type="button" className="scope-add" onClick={addRow}>
        <Plus size={13} />
        <span>Add permission</span>
      </button>
    </div>
  );
}

function TokenEditor({
  token,
  mounts,
  busy,
  onSave,
  onRotate,
  onRevoke,
}: {
  token: TokenSummary;
  mounts: MountSummary[];
  busy: string | null;
  onSave: (input: { scopes: string[]; client: string; expires: string }) => void | Promise<void>;
  onRotate: () => void | Promise<void>;
  onRevoke: () => void | Promise<void>;
}): JSX.Element {
  const initialScopes = useMemo(() => parseScopeList(token.scope || ''), [token.scope]);
  const [scopes, setScopes] = useState<string[]>(initialScopes);
  const [client, setClient] = useState(token.client ?? '');
  const [expires, setExpires] = useState(token.expiresAt ?? '');

  useEffect(() => {
    setScopes(parseScopeList(token.scope || ''));
    setClient(token.client ?? '');
    setExpires(token.expiresAt ?? '');
  }, [token.name, token.scope, token.client, token.expiresAt]);

  const editBusy = busy === `token-edit-${token.name}`;
  const rotateBusy = busy === `token-rotate-${token.name}`;
  const revokeBusy = busy === `token-remove-${token.name}`;

  const dirty =
    scopes.join(',') !== initialScopes.join(',') ||
    (client || '') !== (token.client ?? '') ||
    (expires || '') !== (token.expiresAt ?? '');

  return (
    <div className="token-editor" onClick={(e) => e.stopPropagation()}>
      <div className="token-editor-meta">
        <Detail label="Created" value={formatTimestamp(token.createdAt)} />
        <Detail
          label="Last used"
          value={token.lastUsedAt ? formatTimestamp(token.lastUsedAt) : 'never'}
        />
      </div>

      <Field label="Permissions">
        <ScopePicker mounts={mounts} value={scopes} onChange={setScopes} />
      </Field>

      <div className="token-editor-row">
        <Field label="Client">
          <input
            value={client}
            onChange={(e) => setClient(e.target.value)}
            placeholder="any"
          />
        </Field>
        <Field label="Expires">
          <input
            value={expires}
            onChange={(e) => setExpires(e.target.value)}
            placeholder="never"
          />
        </Field>
      </div>

      <div className="token-editor-actions">
        <PrimaryButton
          icon={<Check size={13} />}
          label="Save changes"
          busy={editBusy}
          disabled={!dirty}
          onClick={() => onSave({ scopes, client, expires })}
        />
        <GhostButton
          icon={<RotateCw size={14} />}
          label="Rotate token"
          busy={rotateBusy}
          onClick={onRotate}
        />
        <button
          type="button"
          className="btn btn-danger"
          disabled={revokeBusy}
          onClick={onRevoke}
        >
          {revokeBusy ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />}
          <span>Revoke</span>
        </button>
      </div>
    </div>
  );
}

function leaseUnavailableReason(lease: LeaseSummary): 'expired' | 'revoked' | null {
  if (lease.revokedAt) return 'revoked';
  if (lease.expiresAt) {
    const t = new Date(lease.expiresAt).getTime();
    if (!Number.isNaN(t) && t < Date.now()) return 'expired';
  }
  return null;
}

function leaseModeLabel(lease: LeaseSummary): string {
  return lease.permissions.includes('upload') ? 'upload only' : 'browse/download';
}

function leaseActivity(lease: LeaseSummary): string {
  return lease.permissions.includes('upload')
    ? `${lease.uploadCount} uploads`
    : `${lease.downloadCount} downloads`;
}

function formatLeasePaths(lease: LeaseSummary): string {
  const paths = lease.resources?.length ? lease.resources.map((resource) => resource.path) : [lease.path];
  return paths.join(', ');
}

function parseLeasePaths(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function LeasesCard({
  leases,
  tunnel,
  serverReachable,
  showForm,
  onToggleForm,
  leaseResult,
  onDismissResult,
  busy,
  onCreate,
  onBrowse,
  onAddPaths,
  onRevoke,
  onOpen,
  onCopy,
}: {
  leases: LeaseSummary[];
  tunnel: TunnelStatus | null;
  serverReachable: boolean;
  showForm: boolean;
  onToggleForm: () => void;
  leaseResult: { url: string; path: string; label: string; mode: string; expiresAt: string | null } | null;
  onDismissResult: () => void;
  busy: string | null;
  onCreate: (input: { paths: string[]; label: string; mode: 'read' | 'upload'; expires: string }) => void | Promise<void>;
  onBrowse: (input: { label: string; mode: 'read' | 'upload'; expires: string }) => void | Promise<void>;
  onAddPaths: (id: string, label: string) => void | Promise<void>;
  onRevoke: (id: string, label: string) => void | Promise<void>;
  onOpen: (url: string) => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
}): JSX.Element {
  const tunnelLive = Boolean(tunnel?.running && tunnel?.publicUrl);
  const [leaseView, setLeaseView] = useState<'active' | 'history'>('active');
  const activeLeases = useMemo(
    () => leases.filter((lease) => leaseUnavailableReason(lease) === null),
    [leases],
  );
  const inactiveLeases = useMemo(
    () => leases.filter((lease) => leaseUnavailableReason(lease) !== null),
    [leases],
  );
  const visibleLeases = leaseView === 'active' ? activeLeases : inactiveLeases;

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Leases</h2>
          <p className="card-sub">
            Create expiring links for files and folders.{' '}
            {!tunnelLive && (
              <span className="muted">Tunnel offline - links work locally only.</span>
            )}
          </p>
        </div>
        <div className="card-actions">
          <div className="segmented">
            <button
              type="button"
              className={leaseView === 'active' ? 'on' : ''}
              onClick={() => setLeaseView('active')}
            >
              Active {activeLeases.length}
            </button>
            <button
              type="button"
              className={leaseView === 'history' ? 'on' : ''}
              onClick={() => setLeaseView('history')}
            >
              History {inactiveLeases.length}
            </button>
          </div>
          <PrimaryButton
            variant={showForm ? 'ghost' : 'solid'}
            icon={showForm ? <X size={13} /> : <Plus size={13} />}
            label={showForm ? 'Cancel' : 'Create lease'}
            onClick={onToggleForm}
          />
        </div>
      </div>

      {showForm && (
        <LeaseForm
          busy={busy}
          onSubmit={onCreate}
          onBrowse={onBrowse}
        />
      )}

      {leaseResult && (
        <div className="share-result">
          <div className="share-result-head">
            <div>
              <div className="share-result-title">
                <Check size={14} aria-hidden /> Lease link ready
              </div>
              <div className="share-result-warn">
                Copy the link now - the token won't appear again.
              </div>
            </div>
            <button type="button" className="link-button" onClick={onDismissResult}>
              Dismiss
            </button>
          </div>
          <dl className="token-result-meta">
            <Detail label="Label" value={leaseResult.label} />
            <Detail label="Mode" value={leaseResult.mode} />
            <Detail label="Path" value={leaseResult.path} mono />
            <Detail label="Expires" value={leaseResult.expiresAt ? formatTimestamp(leaseResult.expiresAt) : 'never'} />
          </dl>
          <div className="token-secret">
            <span className="token-secret-label">URL</span>
            <code className="token-secret-value mono">{leaseResult.url}</code>
            <button
              type="button"
              className="row-action"
              title="Copy URL"
              onClick={() => onCopy(leaseResult.url, 'Lease URL')}
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              className="row-action"
              title="Open in browser"
              onClick={() => onOpen(leaseResult.url)}
            >
              <ExternalLink size={14} />
            </button>
          </div>
        </div>
      )}

      {visibleLeases.length === 0 ? (
        <EmptyState
          icon={<LinkIcon size={20} />}
          title={leaseView === 'active' ? 'No active leases' : 'No revoked or expired leases'}
          hint={
            leaseView === 'active'
              ? 'Create a lease to share local files or folders.'
              : 'Revoked and expired leases will appear here.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Path</th>
                <th>Mode</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Activity</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleLeases.map((lease) => {
                const reason = leaseUnavailableReason(lease);
                const removing = busy === `lease-revoke-${lease.id}`;
                const addingPaths = busy === `lease-add-paths-${lease.id}`;
                const canAddPaths = !reason && !lease.permissions.includes('upload');
                return (
                  <tr key={lease.id}>
                    <td>
                      <div className="cell-stack">
                        <span className="cell-strong">{lease.label}</span>
                        <span className="muted share-id">id {lease.id}</span>
                      </div>
                    </td>
                    <td><code className="mono">{formatLeasePaths(lease)}</code></td>
                    <td>{leaseModeLabel(lease)}</td>
                    <td>
                      {reason ? (
                        <span className="muted-tag">{reason}</span>
                      ) : (
                        <span className="access-badge read">active</span>
                      )}
                    </td>
                    <td>{lease.expiresAt ? formatTimestamp(lease.expiresAt) : 'never'}</td>
                    <td>{leaseActivity(lease)}</td>
                    <td className="row-actions share-row-actions">
                      {canAddPaths && (
                        <button
                          type="button"
                          className="row-action"
                          title={`Add paths to ${lease.label}`}
                          disabled={addingPaths}
                          onClick={() => onAddPaths(lease.id, lease.label)}
                        >
                          {addingPaths ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                        </button>
                      )}
                      {lease.url ? (
                        <>
                          <button
                            type="button"
                            className="row-action"
                            title="Copy URL"
                            onClick={() => onCopy(lease.url!, 'Lease URL')}
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            className="row-action"
                            title="Open in browser"
                            onClick={() => onOpen(lease.url!)}
                          >
                            <ExternalLink size={14} />
                          </button>
                        </>
                      ) : (
                        <span
                          className="muted share-no-url"
                          title="URL was created elsewhere - revoke and recreate to get a new link."
                        >
                          -
                        </span>
                      )}
                      <button
                        className="row-action danger"
                        title={`Revoke ${lease.label}`}
                        disabled={removing}
                        onClick={() => onRevoke(lease.id, lease.label)}
                      >
                        {removing ? (
                          <Loader2 size={14} className="spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function LeaseForm({
  busy,
  onSubmit,
  onBrowse,
}: {
  busy: string | null;
  onSubmit: (input: { paths: string[]; label: string; mode: 'read' | 'upload'; expires: string }) => void | Promise<void>;
  onBrowse: (input: { label: string; mode: 'read' | 'upload'; expires: string }) => void | Promise<void>;
}): JSX.Element {
  const [pathsText, setPathsText] = useState('');
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<'read' | 'upload'>('read');
  const [expires, setExpires] = useState('24h');
  const createBusy = busy === 'lease-create';
  const browseBusy = busy === 'lease-browse';

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const paths = parseLeasePaths(pathsText);
    if (paths.length === 0 || !label.trim()) return;
    void onSubmit({ paths, label: label.trim(), mode, expires });
  };

  return (
    <form onSubmit={submit} className="inline-form share-form">
      <div className="field-grid">
        <Field label="Label" required>
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            placeholder="Sarah - tax docs"
            required
          />
        </Field>
        <Field label="Mode" required>
          <div className="scope-select">
            <select value={mode} onChange={(event) => setMode(event.target.value as 'read' | 'upload')}>
              <option value="read">Browse/download</option>
              <option value="upload">Upload only</option>
            </select>
          </div>
        </Field>
        <Field label={mode === 'upload' ? 'Folder' : 'Paths'} full required>
          <div className="input-with-action">
            <textarea
              value={pathsText}
              onChange={(event) => setPathsText(event.target.value)}
              placeholder={mode === 'upload' ? '/Users/you/Uploads' : '/Users/you/Documents/report.pdf\n/Users/you/Documents/Taxes'}
              required
            />
            <button
              type="button"
              className="input-action"
              disabled={!label.trim() || browseBusy}
              onClick={() => onBrowse({ label: label.trim(), mode, expires })}
            >
              {browseBusy ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />}
              Browse
            </button>
          </div>
        </Field>
      </div>
      <ExpirySelector value={expires} onChange={setExpires} />
      <div className="form-actions">
        <PrimaryButton
          type="submit"
          icon={<LinkIcon size={13} />}
          label="Create lease"
          busy={createBusy}
          disabled={parseLeasePaths(pathsText).length === 0 || !label.trim()}
        />
      </div>
    </form>
  );
}

function shareUnavailableReason(share: ShareSummary): 'expired' | 'revoked' | null {
  if (share.revokedAt) return 'revoked';
  if (share.expiresAt) {
    const t = new Date(share.expiresAt).getTime();
    if (!Number.isNaN(t) && t < Date.now()) return 'expired';
  }
  return null;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function SharesCard({
  shares,
  mounts,
  tunnel,
  serverReachable,
  showForm,
  onToggleForm,
  shareResult,
  onDismissResult,
  busy,
  onCreateFromMount,
  onBrowseAndShare,
  onRevoke,
  onOpen,
  onCopy,
  listMountFiles,
}: {
  shares: ShareSummary[];
  mounts: MountSummary[];
  tunnel: TunnelStatus | null;
  serverReachable: boolean;
  showForm: boolean;
  onToggleForm: () => void;
  shareResult: { url: string; path: string; expiresAt: string | null; mountCreated?: boolean; mountName?: string } | null;
  onDismissResult: () => void;
  busy: string | null;
  onCreateFromMount: (input: { path: string; expires: string }) => void | Promise<void>;
  onBrowseAndShare: (input: { expires: string }) => void | Promise<void>;
  onRevoke: (id: string, path: string) => void | Promise<void>;
  onOpen: (url: string) => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
  listMountFiles: (mountName: string) => Promise<MountFileEntry[]>;
}): JSX.Element {
  const tunnelLive = Boolean(tunnel?.running && tunnel?.publicUrl);

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Shares</h2>
          <p className="card-sub">
            One-file download links. Default expiry 24h.{' '}
            {!tunnelLive && (
              <span className="muted">
                Tunnel offline — links work locally only.
              </span>
            )}
          </p>
        </div>
        <div className="card-actions">
          <PrimaryButton
            variant={showForm ? 'ghost' : 'solid'}
            icon={showForm ? <X size={13} /> : <Share2 size={13} />}
            label={showForm ? 'Cancel' : 'Share file'}
            onClick={onToggleForm}
          />
        </div>
      </div>

      {showForm && (
        <ShareForm
          mounts={mounts}
          busy={busy}
          onSubmitFromMount={onCreateFromMount}
          onSubmitBrowse={onBrowseAndShare}
          listMountFiles={listMountFiles}
        />
      )}

      {shareResult && (
        <div className="share-result">
          <div className="share-result-head">
            <div>
              <div className="share-result-title">
                <Check size={14} aria-hidden /> Share link ready
              </div>
              <div className="share-result-warn">
                Copy the link now — the token won't appear again.
              </div>
            </div>
            <button type="button" className="link-button" onClick={onDismissResult}>
              Dismiss
            </button>
          </div>
          {shareResult.mountCreated && (
            <div className="share-result-note">
              Auto-mounted as <code className="mono">{shareResult.mountName}</code>.
            </div>
          )}
          <div className="token-secret">
            <span className="token-secret-label">Path</span>
            <code className="token-secret-value mono">{shareResult.path}</code>
          </div>
          <div className="token-secret">
            <span className="token-secret-label">URL</span>
            <code className="token-secret-value mono">{shareResult.url}</code>
            <button
              type="button"
              className="row-action"
              title="Copy URL"
              onClick={() => onCopy(shareResult.url, 'Share URL')}
            >
              <Copy size={14} />
            </button>
            <button
              type="button"
              className="row-action"
              title="Open in browser"
              onClick={() => onOpen(shareResult.url)}
            >
              <ExternalLink size={14} />
            </button>
          </div>
          {shareResult.expiresAt && (
            <div className="share-result-meta">
              Expires {formatTimestamp(shareResult.expiresAt)}
            </div>
          )}
        </div>
      )}

      {shares.length === 0 ? (
        <EmptyState
          icon={<LinkIcon size={20} />}
          title="No share links"
          hint={
            serverReachable
              ? 'Click "Share file" to create a one-file download link.'
              : 'Start the local server to create share links.'
          }
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Path</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Downloads</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shares.map((share) => {
                const reason = shareUnavailableReason(share);
                const removing = busy === `share-remove-${share.id}`;
                return (
                  <tr key={share.id}>
                    <td>
                      <div className="cell-stack">
                        <code className="mono">{share.path}</code>
                      </div>
                      <div className="muted share-id">id {share.id}</div>
                    </td>
                    <td>
                      {reason ? (
                        <span className="muted-tag">{reason}</span>
                      ) : (
                        <span className="access-badge read">active</span>
                      )}
                    </td>
                    <td>{share.expiresAt ? formatTimestamp(share.expiresAt) : 'never'}</td>
                    <td>{share.downloadCount}</td>
                    <td className="row-actions share-row-actions">
                      {share.url ? (
                        <>
                          <button
                            type="button"
                            className="row-action"
                            title="Copy URL"
                            onClick={() => onCopy(share.url!, 'Share URL')}
                          >
                            <Copy size={14} />
                          </button>
                          <button
                            type="button"
                            className="row-action"
                            title="Open in browser"
                            onClick={() => onOpen(share.url!)}
                          >
                            <ExternalLink size={14} />
                          </button>
                        </>
                      ) : (
                        <span
                          className="muted share-no-url"
                          title="URL was created elsewhere — revoke and recreate to get a new link."
                        >
                          —
                        </span>
                      )}
                      <button
                        className="row-action danger"
                        title={`Revoke ${share.id}`}
                        disabled={removing}
                        onClick={() => onRevoke(share.id, share.path)}
                      >
                        {removing ? (
                          <Loader2 size={14} className="spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const EXPIRY_PRESETS = [
  { value: '1h', label: '1 hour' },
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'never', label: 'Never' },
];

function ShareForm({
  mounts,
  busy,
  onSubmitFromMount,
  onSubmitBrowse,
  listMountFiles,
}: {
  mounts: MountSummary[];
  busy: string | null;
  onSubmitFromMount: (input: { path: string; expires: string }) => void | Promise<void>;
  onSubmitBrowse: (input: { expires: string }) => void | Promise<void>;
  listMountFiles: (mountName: string) => Promise<MountFileEntry[]>;
}): JSX.Element {
  const [mode, setMode] = useState<'mount' | 'browse'>('mount');
  const [expires, setExpires] = useState('24h');
  const enabledMounts = useMemo(() => mounts.filter((m) => m.enabled), [mounts]);
  const [mountName, setMountName] = useState<string>(enabledMounts[0]?.name ?? '');
  const [files, setFiles] = useState<MountFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [filesLoading, setFilesLoading] = useState(false);

  useEffect(() => {
    if (!mountName) {
      setFiles([]);
      setSelectedFile('');
      return;
    }
    setFilesLoading(true);
    let cancelled = false;
    listMountFiles(mountName)
      .then((entries) => {
        if (cancelled) return;
        const fileEntries = entries.filter((e) => !e.isDirectory);
        setFiles(fileEntries);
        setSelectedFile((current) =>
          current && fileEntries.some((e) => e.virtualPath === current)
            ? current
            : fileEntries[0]?.virtualPath ?? '',
        );
      })
      .catch(() => {
        if (!cancelled) setFiles([]);
      })
      .finally(() => {
        if (!cancelled) setFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mountName, listMountFiles]);

  const createBusy = busy === 'share-create';
  const browseBusy = busy === 'share-browse';

  const submitMount = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (!selectedFile) return;
    void onSubmitFromMount({ path: selectedFile, expires });
  };

  return (
    <div className="inline-form share-form">
      <div className="share-mode-tabs">
        <button
          type="button"
          className={`mode-tab ${mode === 'mount' ? 'on' : ''}`}
          onClick={() => setMode('mount')}
        >
          <FolderOpen size={13} />
          From mount
        </button>
        <button
          type="button"
          className={`mode-tab ${mode === 'browse' ? 'on' : ''}`}
          onClick={() => setMode('browse')}
        >
          <FileText size={13} />
          Browse files
        </button>
      </div>

      {mode === 'mount' ? (
        <form onSubmit={submitMount} className="share-form-body">
          {enabledMounts.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>
              No mounts to share from. Add a mount first, or use “Browse files”.
            </p>
          ) : (
            <>
              <div className="field-grid">
                <Field label="Mount" required>
                  <div className="scope-select">
                    <select
                      value={mountName}
                      onChange={(e) => setMountName(e.target.value)}
                    >
                      {enabledMounts.map((m) => (
                        <option key={m.name} value={m.name}>
                          {m.name} ({m.path})
                        </option>
                      ))}
                    </select>
                  </div>
                </Field>
                <Field label="File" required>
                  <div className="scope-select">
                    <select
                      value={selectedFile}
                      onChange={(e) => setSelectedFile(e.target.value)}
                      disabled={filesLoading || files.length === 0}
                    >
                      {filesLoading && <option value="">Loading…</option>}
                      {!filesLoading && files.length === 0 && (
                        <option value="">No files in this mount</option>
                      )}
                      {!filesLoading &&
                        files.map((f) => (
                          <option key={f.virtualPath} value={f.virtualPath}>
                            {f.virtualPath} · {formatBytes(f.size)}
                          </option>
                        ))}
                    </select>
                  </div>
                </Field>
              </div>
              <ExpirySelector value={expires} onChange={setExpires} />
              <div className="form-actions">
                <PrimaryButton
                  type="submit"
                  icon={<LinkIcon size={13} />}
                  label="Create link"
                  busy={createBusy}
                  disabled={!selectedFile}
                />
              </div>
            </>
          )}
        </form>
      ) : (
        <div className="share-form-body">
          <p className="muted" style={{ margin: 0 }}>
            Pick a file from anywhere on your machine. If it's not already inside a
            mount, mvmt will auto-mount it as read-only.
          </p>
          <ExpirySelector value={expires} onChange={setExpires} />
          <div className="form-actions">
            <PrimaryButton
              icon={<FolderOpen size={13} />}
              label="Choose file & share"
              busy={browseBusy}
              onClick={() => onSubmitBrowse({ expires })}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function ExpirySelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}): JSX.Element {
  const isPreset = EXPIRY_PRESETS.some((p) => p.value === value);
  return (
    <Field label="Expires">
      <div className="expiry-row">
        <div className="scope-select">
          <select
            value={isPreset ? value : 'custom'}
            onChange={(e) => {
              if (e.target.value === 'custom') return;
              onChange(e.target.value);
            }}
          >
            {EXPIRY_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
            <option value="custom">Custom…</option>
          </select>
        </div>
        {!isPreset && (
          <input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="e.g. 12h, 3d, 90d"
            style={{ maxWidth: 160 }}
          />
        )}
      </div>
    </Field>
  );
}
