import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type {
  AddMountInput,
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
  reindex: () => ipcRenderer.invoke('mvmt:reindex'),
  openLocalServer: () => ipcRenderer.invoke('mvmt:open-local-server'),
  tunnelStatus: () => ipcRenderer.invoke('mvmt:tunnel:status'),
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
