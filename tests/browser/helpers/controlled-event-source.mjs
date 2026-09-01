export async function installControlledEventSource(page) {
  await page.addInitScript(() => {
    class ControlledEventSource {
      constructor() {
        this.listeners = new Map();
        this.closed = false;
        window.__receiptEventSources ??= [];
        window.__receiptEventSources.push(this);
      }

      addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
      }

      emit(type, data = '') {
        for (const listener of this.listeners.get(type) ?? []) listener({ data });
      }

      close() {
        this.closed = true;
      }
    }
    window.EventSource = ControlledEventSource;
  });
}
