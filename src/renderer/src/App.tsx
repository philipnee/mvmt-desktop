import {
  Check,
  ChevronRight,
  Copy,
  Eraser,
  Eye,
  EyeOff,
  ExternalLink,
  FolderOpen,
  Globe,
  KeyRound,
  Loader2,
  Play,
  Plus,
  RotateCw,
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
  MountSummary,
  ServerStatus,
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
  const [notice, setNotice] = useState<Notice | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showMountForm, setShowMountForm] = useState(false);
  const [showTokenForm, setShowTokenForm] = useState(false);
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [view, setView] = useState<'dashboard' | 'activity'>('dashboard');

  const refresh = useCallback(async () => {
    const [nextStatus, nextMounts, nextTokens] = await Promise.all([
      window.mvmtDesktop.getStatus(),
      window.mvmtDesktop.listMounts(),
      window.mvmtDesktop.listTokens(),
    ]);
    setStatus(nextStatus);
    setMounts(nextMounts);
    setTokens(nextTokens);
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
    await runUiTask('tunnel', async () => {
      const next = await window.mvmtDesktop.tunnelStart();
      setTunnel(next);
      if (next.publicUrl) {
        setNotice({ kind: 'success', text: `Tunnel up at ${next.publicUrl}` });
      } else if (!next.configured) {
        setNotice({
          kind: 'info',
          text: 'No tunnel configured. Run `mvmt tunnel config` in a terminal.',
        });
      } else {
        setNotice({ kind: 'info', text: 'Tunnel starting…' });
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
          onStartServer={startServer}
          onStopServer={stopServer}
          onStartTunnel={startTunnel}
          onStopTunnel={stopTunnel}
          onRefreshTunnel={refreshTunnel}
          onOpen={(url) => window.mvmtDesktop.openExternal(url)}
          onCopy={copyToClipboard}
        />

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Mounts</h2>
              <p className="card-sub">Folders exposed to the engine. Write access is the base permission.</p>
            </div>
            <div className="card-actions">
              <GhostButton
                icon={<RotateCw size={14} />}
                label="Reindex"
                busy={busy === 'reindex'}
                disabled={!reachable}
                onClick={reindex}
              />
              <PrimaryButton
                variant={showMountForm ? 'ghost' : 'solid'}
                icon={showMountForm ? <X size={13} /> : <Plus size={13} />}
                label={showMountForm ? 'Cancel' : 'Add mount'}
                onClick={() => setShowMountForm((v) => !v)}
              />
            </div>
          </div>

          {showMountForm && (
            <form onSubmit={submitMount} className="inline-form">
              <div className="field-grid">
                <Field label="Name" required>
                  <input
                    value={mountForm.name}
                    onChange={(e) => setMountForm({ ...mountForm, name: e.target.value })}
                    placeholder="books"
                    required
                  />
                </Field>
                <Field label="Mount path" required>
                  <input
                    value={mountForm.mountPath}
                    onChange={(e) => setMountForm({ ...mountForm, mountPath: e.target.value })}
                    placeholder="/books"
                    required
                  />
                </Field>
                <Field label="Folder" full required>
                  <div className="input-with-action">
                    <input
                      value={mountForm.root}
                      onChange={(e) => setMountForm({ ...mountForm, root: e.target.value })}
                      placeholder="/Users/you/books"
                      required
                    />
                    <button type="button" className="input-action" onClick={chooseFolder}>
                      <FolderOpen size={14} /> Browse
                    </button>
                  </div>
                </Field>
                <Field label="Description" full>
                  <input
                    value={mountForm.description}
                    onChange={(e) => setMountForm({ ...mountForm, description: e.target.value })}
                    placeholder="Short label shown to clients"
                  />
                </Field>
              </div>

              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={mountForm.writeAccess}
                  onChange={(e) => setMountForm({ ...mountForm, writeAccess: e.target.checked })}
                />
                <span>Allow write access</span>
              </label>

              <div className="form-actions">
                <PrimaryButton
                  type="submit"
                  icon={<Check size={13} />}
                  label="Save mount"
                  busy={busy === 'mount'}
                />
              </div>
            </form>
          )}

          {mounts.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={20} />}
              title="No mounts yet"
              hint="Add a folder to expose it to the engine."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Mount path</th>
                    <th>Folder</th>
                    <th>Access</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {mounts.map((mount) => (
                    <tr key={mount.name}>
                      <td>
                        <div className="cell-stack">
                          <span className="cell-strong">{mount.name}</span>
                          {!mount.enabled && <span className="muted-tag">disabled</span>}
                        </div>
                      </td>
                      <td><code className="mono">{mount.path}</code></td>
                      <td><span className="path-cell">{mount.root}</span></td>
                      <td><AccessBadge writeAccess={mount.writeAccess} /></td>
                      <td className="row-actions">
                        <button
                          className="row-action danger"
                          title={`Remove ${mount.name}`}
                          disabled={busy === `remove-${mount.name}`}
                          onClick={() => removeMount(mount.name)}
                        >
                          {busy === `remove-${mount.name}` ? (
                            <Loader2 size={14} className="spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Tokens</h2>
              <p className="card-sub">Scoped credentials. Token scope cannot exceed mount permissions.</p>
            </div>
            <div className="card-actions">
              <PrimaryButton
                variant={showTokenForm ? 'ghost' : 'solid'}
                icon={showTokenForm ? <X size={13} /> : <Plus size={13} />}
                label={showTokenForm ? 'Cancel' : 'Create token'}
                onClick={() => setShowTokenForm((v) => !v)}
              />
            </div>
          </div>

          {showTokenForm && (
            <form onSubmit={submitToken} className="inline-form">
              <div className="field-grid">
                <Field label="Token id" required>
                  <input
                    value={tokenForm.id}
                    onChange={(e) => setTokenForm({ ...tokenForm, id: e.target.value })}
                    placeholder="desktop"
                    required
                  />
                </Field>
                <Field label="Display name">
                  <input
                    value={tokenForm.displayName}
                    onChange={(e) => setTokenForm({ ...tokenForm, displayName: e.target.value })}
                    placeholder="Desktop"
                  />
                </Field>
                <Field label="Permissions" full required>
                  <ScopePicker
                    mounts={mounts}
                    value={parseScopeList(tokenForm.scopes)}
                    onChange={(scopes) =>
                      setTokenForm({ ...tokenForm, scopes: scopes.join(',') })
                    }
                  />
                </Field>
                <Field label="Client">
                  <input
                    value={tokenForm.client}
                    onChange={(e) => setTokenForm({ ...tokenForm, client: e.target.value })}
                    placeholder="any"
                  />
                </Field>
                <Field label="Expires">
                  <input
                    value={tokenForm.expires}
                    onChange={(e) => setTokenForm({ ...tokenForm, expires: e.target.value })}
                    placeholder="never"
                  />
                </Field>
              </div>
              <div className="form-actions">
                <PrimaryButton
                  type="submit"
                  icon={<KeyRound size={13} />}
                  label="Create token"
                  busy={busy === 'token'}
                />
              </div>
            </form>
          )}

          {tokenResult && (
            <TokenResultCard
              result={tokenResult}
              revealed={revealToken}
              onReveal={() => setRevealToken((v) => !v)}
              onDismiss={() => setTokenResult(null)}
              onCopy={copyToClipboard}
            />
          )}

          {tokens.length === 0 ? (
            <EmptyState
              icon={<KeyRound size={20} />}
              title="No tokens yet"
              hint="Create one to grant scoped access to the engine."
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th aria-label="Expand" style={{ width: 32 }} />
                    <th>Name</th>
                    <th>Scope</th>
                    <th>Client</th>
                    <th>Expires</th>
                    <th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {tokens.map((token) => {
                    const isOpen = expandedTokens.has(token.name);
                    return (
                      <Fragment key={token.name}>
                        <tr
                          className="row-clickable"
                          onClick={() =>
                            setExpandedTokens((current) => {
                              const next = new Set(current);
                              if (next.has(token.name)) next.delete(token.name);
                              else next.add(token.name);
                              return next;
                            })
                          }
                        >
                          <td className="row-chevron">
                            <ChevronRight
                              size={14}
                              style={{
                                transform: isOpen ? 'rotate(90deg)' : 'none',
                                transition: 'transform 120ms ease',
                              }}
                            />
                          </td>
                          <td><span className="cell-strong">{token.name}</span></td>
                          <td><code className="mono">{token.scope}</code></td>
                          <td>{token.client ?? <span className="muted">any</span>}</td>
                          <td>{formatExpiry(token.expiresAt)}</td>
                          <td className="row-actions">
                            <button
                              className="row-action danger"
                              title={`Revoke ${token.name}`}
                              disabled={busy === `token-remove-${token.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void revokeTokenById(token.name);
                              }}
                            >
                              {busy === `token-remove-${token.name}` ? (
                                <Loader2 size={14} className="spin" />
                              ) : (
                                <Trash2 size={14} />
                              )}
                            </button>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="row-expanded">
                            <td colSpan={6}>
                              <TokenEditor
                                token={token}
                                mounts={mounts}
                                busy={busy}
                                onSave={(input) => saveTokenEdit(token.name, input)}
                                onRotate={() => rotateTokenById(token.name)}
                                onRevoke={() => revokeTokenById(token.name)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
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
  onStartServer,
  onStopServer,
  onStartTunnel,
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
  onStartServer: () => void | Promise<void>;
  onStopServer: () => void | Promise<void>;
  onStartTunnel: () => void | Promise<void>;
  onStopTunnel: () => void | Promise<void>;
  onRefreshTunnel: () => void | Promise<void>;
  onOpen: (url: string) => void | Promise<void>;
  onCopy: (text: string, label: string) => void | Promise<void>;
}): JSX.Element {
  const serverBusy = busy === 'server';
  const tunnelBusy = busy === 'tunnel';
  const localEndpoint = `127.0.0.1:${port}`;
  const localUrl = `http://${localEndpoint}`;
  const publicUrl = tunnel?.publicUrl ?? null;
  const tunnelRunning = Boolean(tunnel?.running && publicUrl);
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
            <span>Public endpoint</span>
            {tunnel?.command && tunnelRunning ? (
              <span className="endpoint-tag">{providerLabel(tunnel.command)}</span>
            ) : null}
          </div>
          <div className="endpoint-value">
            {publicUrl ? (
              <>
                <code className="mono endpoint-url">{publicUrl}</code>
                <div className="endpoint-actions">
                  <button
                    type="button"
                    className="row-action"
                    title="Copy"
                    onClick={() => onCopy(publicUrl, 'Public URL')}
                  >
                    <Copy size={14} />
                  </button>
                  <button
                    type="button"
                    className="row-action"
                    title="Open in browser"
                    onClick={() => onOpen(publicUrl)}
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
                icon={<Square size={14} />}
                label="Stop"
                busy={tunnelBusy}
                onClick={onStopTunnel}
              />
            </>
          ) : (
            <PrimaryButton
              icon={<Globe size={13} />}
              label="Start tunnel"
              busy={tunnelBusy}
              disabled={!reachable}
              onClick={onStartTunnel}
            />
          )}
        </div>
      </div>

      {!tunnelConfigured && reachable && (
        <div className="endpoint-hint">
          <span>Tunnel not configured.</span>
          <code className="mono">mvmt tunnel config</code>
          <button
            type="button"
            className="link-button"
            onClick={() => onCopy('mvmt tunnel config', 'Command')}
          >
            Copy
          </button>
          <span className="muted">— run once in a terminal.</span>
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
