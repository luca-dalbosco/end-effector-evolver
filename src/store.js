// Browser storage (localStorage) that never stops the app: when the browser blocks storage, reads give the fallback
// and writes are skipped (set returns false).
export const store = {
  get(key, fallback = null) { try { return localStorage.getItem(key) ?? fallback; } catch (e) { return fallback; } },
  set(key, value) { try { localStorage.setItem(key, value); return true; } catch (e) { return false; } },
  json(key, fallback) { try { return JSON.parse(store.get(key) ?? "null") ?? fallback; } catch (e) { return fallback; } },
};
