import { BUILTIN_TOOLS } from '../builtin';
import { handleJob } from './handleJob';
import type { WorkerReply, WorkerRequest } from './protocol';

/**
 * Entry of the processing Web Worker (started by app/processing.ts). It
 * carries the built-in tools; everything else is in handleJob.
 */
const tools = new Map(BUILTIN_TOOLS.map((t) => [t.id, t]));
const scope = self as unknown as { onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null; postMessage(m: WorkerReply): void };

scope.onmessage = (e) => {
  if (e.data.type === 'run') void handleJob(e.data, (reply) => scope.postMessage(reply), (id) => tools.get(id));
};
