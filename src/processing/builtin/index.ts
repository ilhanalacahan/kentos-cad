import type { ProcessingTool } from '../types';
import { edgeLengths } from './edgeLengths';
import { vertexNumbering } from './vertexNumbering';

/** Tools that ship with KentOS, registered at start-up (app/createApp). */
export const BUILTIN_TOOLS: readonly ProcessingTool[] = [vertexNumbering, edgeLengths];
