import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AddMountInput,
  AddLeasePathsInput,
  BrowseLeaseInput,
  BrowseShareInput,
  CreateLeaseInput,
  CreateShareInput,
  CreateTokenInput,
  EditTokenInput,
  MvmtDesktopApi,
} from '../shared/types';

const api: MvmtDesktopApi = {
  getStatus: () => ipcRenderer.invoke('mvmt:status'),
  startServer: () => ipcRenderer.invoke('mvmt:start-server'),
  stopServer: () => ipcRenderer.invoke('mvmt:stop-server'),
  selectFolder: () => ipcRenderer.invoke('mvmt:select-folder'),
  listMounts: () => ipcRenderer.invoke('mvmt:mounts:list'),
  addMount: (input: AddMountInput) => ipcRenderer.invoke('mvmt:mounts:add', input),
  removeMount: (name: string) => ipcRenderer.invoke('mvmt:mounts:remove', name),
  listTokens: () => ipcRenderer.invoke('mvmt:tokens:list'),
  createToken: (input: CreateTokenInput) => ipcRenderer.invoke('mvmt:tokens:create', input),
  editToken: (id: string, input: EditTokenInput) =>
    ipcRenderer.invoke('mvmt:tokens:edit', id, input),
  rotateToken: (id: string) => ipcRenderer.invoke('mvmt:tokens:rotate', id),
  removeToken: (id: string) => ipcRenderer.invoke('mvmt:tokens:remove', id),
  listLeases: () => ipcRenderer.invoke('mvmt:leases:list'),
  createLease: (input: CreateLeaseInput) => ipcRenderer.invoke('mvmt:leases:create', input),
  addLeasePaths: (input: AddLeasePathsInput) => ipcRenderer.invoke('mvmt:leases:add-paths', input),
  revokeLease: (id: string) => ipcRenderer.invoke('mvmt:leases:revoke', id),
  browseAndCreateLease: (input: BrowseLeaseInput) =>
    ipcRenderer.invoke('mvmt:leases:browse', input),
  browseAndAddLeasePaths: (id: string) => ipcRenderer.invoke('mvmt:leases:browse-add-paths', id),
  listShares: () => ipcRenderer.invoke('mvmt:shares:list'),
  createShare: (input: CreateShareInput) => ipcRenderer.invoke('mvmt:shares:add', input),
  removeShare: (id: string) => ipcRenderer.invoke('mvmt:shares:remove', id),
  browseAndShare: (input: BrowseShareInput) => ipcRenderer.invoke('mvmt:shares:browse', input),
  listMountFiles: (mountName: string) => ipcRenderer.invoke('mvmt:mounts:files', mountName),
  reindex: () => ipcRenderer.invoke('mvmt:reindex'),
  openLocalServer: () => ipcRenderer.invoke('mvmt:open-local-server'),
  tunnelStatus: () => ipcRenderer.invoke('mvmt:tunnel:status'),
  tunnelConfigureQuick: () => ipcRenderer.invoke('mvmt:tunnel:configure-quick'),
  tunnelConfigureCloudflareConfig: (path: string) => ipcRenderer.invoke('mvmt:tunnel:configure-cloudflare-config', path),
  tunnelStart: () => ipcRenderer.invoke('mvmt:tunnel:start'),
  tunnelStop: () => ipcRenderer.invoke('mvmt:tunnel:stop'),
  tunnelRefresh: () => ipcRenderer.invoke('mvmt:tunnel:refresh'),
  tunnelLogs: () => ipcRenderer.invoke('mvmt:tunnel:logs'),
  openExternal: (url: string) => ipcRenderer.invoke('mvmt:open-external', url),
  getLogs: () => ipcRenderer.invoke('mvmt:logs:get'),
  clearLogs: () => ipcRenderer.invoke('mvmt:logs:clear'),
  onLogChunk: (handler: (chunk: string) => void) => {
    const listener = (_event: IpcRendererEvent, chunk: string): void => handler(chunk);
    ipcRenderer.on('mvmt:log-chunk', listener);
    return () => ipcRenderer.removeListener('mvmt:log-chunk', listener);
  },
};

contextBridge.exposeInMainWorld('mvmtDesktop', api);
