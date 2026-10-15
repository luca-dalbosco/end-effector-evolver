// Messages to a worker. Every request gets an id (rid) and the worker echoes it on each reply, so a reply always reaches
// the code that asked. A reply with more: true is a progress update; the last reply has no "more".
// name = what the worker is called in error messages; onDead(text) runs once when it crashes.
export function rpc(worker, name = "geometry engine", onDead = null) {
  let n = 0;
  const wait = new Map();
  worker.addEventListener("message", (e) => {
    const m = e.data, f = m && wait.get(m.rid); if (!f) return;
    if (!m.more) wait.delete(m.rid);
    f(m);
    document.dispatchEvent(new Event("workerreply")); // the 3D view redraws (it draws on demand)
  });
  // the worker failed to load or crashed (for example out of memory): every waiting request gets an error reply,
  // and so does every later request, so no panel stays locked or waits for ever
  let dead = null;
  const failed = (rid) => ({ rid, ok: false, error: dead, errors: [dead], warnings: [], results: [{ ok: false, text: dead }] });
  worker.addEventListener("error", (e) => {
    e.preventDefault();
    dead = `The ${name} stopped${e.message ? ` (${e.message})` : ""}. Reload the page to start it again. Very large parts or settings can run out of memory.`;
    const ws = [...wait.entries()]; wait.clear();
    ws.forEach(([rid, f]) => f(failed(rid)));
    onDead?.(dead); document.dispatchEvent(new Event("workerreply"));
  });
  // onReply null = no answer expected (for example "stop")
  return (type, data = {}, onReply = null, transfer = []) => {
    const rid = ++n;
    if (dead) { if (onReply) setTimeout(() => onReply(failed(rid))); return rid; }
    if (onReply) wait.set(rid, onReply);
    worker.postMessage({ ...data, type, rid }, transfer);
    return rid;
  };
}

// One request of this type at a time. While one runs, only the newest waiting request is kept, and the reply of a request
// that was overtaken by a newer one is not shown. Stops slider drags from piling up work in the worker.
export function serial(call, type) {
  let busy = false, next = null;
  const go = (data, onReply, transfer) => {
    busy = true;
    call(type, data, (m) => {
      if (m.more) return onReply(m);
      busy = false;
      if (next) { const q = next; next = null; return go(...q); }
      onReply(m);
    }, transfer);
  };
  return (data, onReply, transfer = []) => (busy ? (next = [data, onReply, transfer]) : go(data, onReply, transfer));
}

// Worker side: answer a request (more: true for a progress update).
export const replyTo = (m, data, transfer = [], more = false) => postMessage({ ...data, rid: m.rid, ...(more ? { more: true } : {}) }, transfer);
export const meshBufs = (...meshes) => meshes.flatMap((x) => [x.p.buffer, x.n.buffer, x.i.buffer]); // buffers to hand over without a copy
