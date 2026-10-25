import type { Vec2 } from '../types';
import { distance } from '../math';
import type { AirportLayout, EdgeKind, TaxiEdge, TaxiNode } from './layout';

interface Neighbor {
  readonly to: string;
  readonly edge: TaxiEdge;
  readonly length: number;
}

/** Ground routes may never use the runway itself or runway connectors. */
export const TAXI_EDGE_KINDS: ReadonlySet<EdgeKind> = new Set<EdgeKind>(['taxiway', 'apron', 'stand']);

/** Owns the taxiway graph and computes shortest valid routes through it. */
export class RouteManager {
  private readonly nodes = new Map<string, TaxiNode>();
  private readonly adjacency = new Map<string, Neighbor[]>();

  constructor(readonly layout: AirportLayout) {
    for (const n of layout.nodes) {
      if (this.nodes.has(n.id)) throw new Error(`Duplicate taxi node ${n.id}`);
      this.nodes.set(n.id, n);
      this.adjacency.set(n.id, []);
    }
    for (const e of layout.edges) {
      const a = this.node(e.from);
      const b = this.node(e.to);
      const length = distance(a.position, b.position);
      this.adjacency.get(a.id)?.push({ to: b.id, edge: e, length });
      this.adjacency.get(b.id)?.push({ to: a.id, edge: e, length });
    }
  }

  hasNode(id: string): boolean {
    return this.nodes.has(id);
  }

  node(id: string): TaxiNode {
    const n = this.nodes.get(id);
    if (!n) throw new Error(`Unknown taxi node ${id}`);
    return n;
  }

  neighbors(id: string, kinds?: ReadonlySet<EdgeKind>): { id: string; edge: TaxiEdge }[] {
    return (this.adjacency.get(id) ?? []).filter((nb) => !kinds || kinds.has(nb.edge.kind)).map((nb) => ({ id: nb.to, edge: nb.edge }));
  }

  edgeBetween(a: string, b: string): TaxiEdge | null {
    return this.adjacency.get(a)?.find((nb) => nb.to === b)?.edge ?? null;
  }

  /** Dijkstra shortest path restricted to the allowed edge kinds. Returns node ids or null. */
  findRoute(from: string, to: string, allowed: ReadonlySet<EdgeKind> = TAXI_EDGE_KINDS): string[] | null {
    if (!this.nodes.has(from) || !this.nodes.has(to)) return null;
    if (from === to) return [from];
    const dist = new Map<string, number>([[from, 0]]);
    const prev = new Map<string, string>();
    const open = new Set<string>([from]);
    const closed = new Set<string>();

    while (open.size > 0) {
      let current: string | null = null;
      let best = Infinity;
      for (const id of open) {
        const d = dist.get(id) ?? Infinity;
        if (d < best) {
          best = d;
          current = id;
        }
      }
      if (current === null) break;
      if (current === to) break;
      open.delete(current);
      closed.add(current);
      for (const nb of this.adjacency.get(current) ?? []) {
        if (!allowed.has(nb.edge.kind) || closed.has(nb.to)) continue;
        const candidate = best + nb.length;
        if (candidate < (dist.get(nb.to) ?? Infinity)) {
          dist.set(nb.to, candidate);
          prev.set(nb.to, current);
          open.add(nb.to);
        }
      }
    }

    if (!dist.has(to)) return null;
    const route = [to];
    let cursor = to;
    while (cursor !== from) {
      const p = prev.get(cursor);
      if (p === undefined) return null;
      route.unshift(p);
      cursor = p;
    }
    return route;
  }

  /** True when every consecutive pair of nodes is joined by an allowed edge. */
  isValidRoute(route: readonly string[], allowed: ReadonlySet<EdgeKind> = TAXI_EDGE_KINDS): boolean {
    for (let i = 0; i < route.length - 1; i++) {
      const e = this.edgeBetween(route[i] as string, route[i + 1] as string);
      if (!e || !allowed.has(e.kind)) return false;
    }
    return route.length > 0;
  }

  positions(route: readonly string[]): Vec2[] {
    return route.map((id) => this.node(id).position);
  }

  edgesOf(route: readonly string[]): TaxiEdge[] {
    const out: TaxiEdge[] = [];
    for (let i = 0; i < route.length - 1; i++) {
      const e = this.edgeBetween(route[i] as string, route[i + 1] as string);
      if (e) out.push(e);
    }
    return out;
  }

  /** Human-readable taxiway sequence, e.g. "A2, A, B, Apron". */
  describeRoute(route: readonly string[]): string {
    const names: string[] = [];
    for (const e of this.edgesOf(route)) {
      if (e.kind === 'stand') continue;
      if (names[names.length - 1] !== e.name) names.push(e.name);
    }
    return names.join(', ');
  }

  label(id: string): string {
    const n = this.node(id);
    return n.label ?? n.id;
  }
}
