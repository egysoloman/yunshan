const EPS = 1e-8;
export interface Arc { to: number; reverse: number; capacity: number; initial: number }
/** Deterministic capacitated transport model with node throughput constraints.
 * It does not claim voltage, thermal/AC load flow, fairness or cable losses. */
export class Flow {
  readonly graph: Arc[][] = [];
  addNode(): number { this.graph.push([]); return this.graph.length - 1; }
  edge(from: number, to: number, capacity: number): Arc {
    const forward = { to, reverse: this.graph[to].length, capacity, initial: capacity }, reverse = { to: from, reverse: this.graph[from].length, capacity: 0, initial: 0 };
    this.graph[from].push(forward); this.graph[to].push(reverse); return forward;
  }
  solve(source: number, sink: number): void {
    const size = this.graph.length;
    for (;;) {
      const level = Array<number>(size).fill(-1), queue = [source]; level[source] = 0;
      for (let q = 0; q < queue.length; q++) for (const arc of this.graph[queue[q]]) if (arc.capacity > EPS && level[arc.to] < 0) { level[arc.to] = level[queue[q]] + 1; queue.push(arc.to); }
      if (level[sink] < 0) return;
      const cursor = Array<number>(size).fill(0);
      const send = (node: number, limit: number): number => {
        if (node === sink) return limit;
        for (; cursor[node] < this.graph[node].length; cursor[node]++) {
          const arc = this.graph[node][cursor[node]]; if (arc.capacity <= EPS || level[arc.to] !== level[node] + 1) continue;
          const amount = send(arc.to, Math.min(limit, arc.capacity)); if (amount <= EPS) continue;
          arc.capacity -= amount; this.graph[arc.to][arc.reverse].capacity += amount; return amount;
        }
        return 0;
      };
      while (send(source, 1e15) > EPS) { /* every augmentation consumes an actual residual capacity */ }
    }
  }
}
