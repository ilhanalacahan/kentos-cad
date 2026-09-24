import type { CallSet } from './harness';
import { P0 } from './sets/p0-basics';
import { P1 } from './sets/p1-primitives';
import { P2 } from './sets/p2-curves';
import { P3 } from './sets/p3-offset-annotation';

/** Every call set, in the order the core was ported (docs/adr/0008). */
export const SETS: CallSet[] = [P0, P1, P2, P3];
