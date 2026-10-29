// Fake "server": one tree, shared by every tab.
let tree = {};
const ports = [];
const parts = (p) => p.split('/').filter(Boolean);
function prune(o) { if (o && typeof o === 'object') { for (const k of Object.keys(o)) { o[k] = prune(o[k]); if (o[k] == null) delete o[k]; } if (!Object.keys(o).length) return null; } return o; }
function setAt(p, v) { const ks = parts(p); if (!ks.length) { tree = v || {}; return; } let n = tree; for (const k of ks.slice(0, -1)) { if (!n[k] || typeof n[k] !== 'object') n[k] = {}; n = n[k]; } n[ks.at(-1)] = v; tree = prune(tree) || {}; }
onconnect = (e) => {
  const port = e.ports[0];
  ports.push(port);
  port.onmessage = (m) => {
    const d = m.data;
    if (d.type === 'reset') tree = {};
    if (d.type === 'ops') for (const [p, v] of d.ops) setAt(p, v);
    for (const pt of ports) pt.postMessage({ type: 'tree', tree, id: d.id, from: pt === port });
  };
  port.postMessage({ type: 'tree', tree });
};
