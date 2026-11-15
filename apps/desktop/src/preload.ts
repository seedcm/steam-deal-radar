import { contextBridge, ipcRenderer } from "electron";

type Listener = (event: unknown) => void;
const listeners = new Set<Listener>();

ipcRenderer.on("radar:event", (_event, payload: unknown) => {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      /* 忽略渲染层异常 */
    }
  }
});

contextBridge.exposeInMainWorld("radar", {
  platform: "electron",
  version: "1.2.0",
  async invoke(method: string, payload?: unknown): Promise<unknown> {
    const response = (await ipcRenderer.invoke("radar:invoke", method, payload ?? null)) as
      | { ok: true; result: unknown }
      | { ok: false; error: string };
    if (!response || response.ok !== true) {
      throw new Error(response && "error" in response ? response.error : "调用失败");
    }
    return response.result;
  },
  onEvent(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
});
