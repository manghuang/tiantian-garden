// Keep whole disconnected hair strands, not scattered individual triangles.
export function thinStrands(indices, vertexCount, ratio = 0.08) {
  const parents = Uint32Array.from({ length: vertexCount }, (_, i) => i);
  const find = n => { while (parents[n] !== n) { parents[n] = parents[parents[n]]; n = parents[n]; } return n; };
  for (let i = 0; i < indices.length; i += 3) {
    const root = find(indices[i]); parents[find(indices[i + 1])] = root; parents[find(indices[i + 2])] = root;
  }
  const roots = [...new Set(indices.map(find))];
  if (roots.length < 100) throw new Error('Expected disconnected groom strands; refusing to fragment a connected mesh');
  const hash = value => { let v = Math.imul(value + 1, 0x9e3779b9); v = Math.imul(v ^ (v >>> 16), 0x85ebca6b); return (v ^ (v >>> 13)) >>> 0; };
  roots.sort((a, b) => hash(a) - hash(b));
  const kept = new Set(roots.slice(0, Math.max(1, Math.round(roots.length * ratio))));
  const selected = [];
  for (let i = 0; i < indices.length; i += 3) if (kept.has(find(indices[i]))) selected.push(indices[i], indices[i + 1], indices[i + 2]);
  return { indices: new Uint32Array(selected), strands: roots.length, retained: kept.size };
}
