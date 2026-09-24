import type { CallSet } from './harness';
import { P0 } from './sets/p0-basics';
import { P1 } from './sets/p1-primitives';

/** Every call set, in the order the core was ported (docs/adr/0008). */
export const SETS: CallSet[] = [P0, P1];
