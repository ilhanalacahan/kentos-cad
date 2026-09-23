import { Signal } from '../core/signal';
import { entityBounds, type Entity, type NewEntity } from '../model/entities';
import type { Vec2 } from '../model/geometry';

/**
 * In-app clipboard (session scope). Holds deep copies of entities and the
 * base point they are pasted by: the lower-left corner of their bounds, so
 * "yapıştır" places that corner at the clicked point.
 */
export class Clipboard {
  readonly count = new Signal(0);
  private items: NewEntity[] = [];
  private basePoint: Vec2 = { x: 0, y: 0 };

  set(entities: readonly Entity[]): void {
    this.items = entities.map(({ id: _id, ...rest }) => structuredClone(rest) as NewEntity);
    let minX = Infinity;
    let minY = Infinity;
    for (const e of entities) {
      const b = entityBounds(e);
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
    }
    this.basePoint = entities.length ? { x: minX, y: minY } : { x: 0, y: 0 };
    this.count.set(this.items.length);
  }

  /** Fresh copies each time, so one clipboard can be pasted many times. */
  get(): { items: NewEntity[]; base: Vec2 } {
    return { items: this.items.map((e) => structuredClone(e)), base: { ...this.basePoint } };
  }
}
