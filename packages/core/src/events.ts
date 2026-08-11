import { EventEmitter } from 'node:events';

/** Progress events emitted by long-running jobs, consumed by CLI spinners and server SSE. */
export interface ProgressEvent {
  jobId: string;
  phase: string;
  message: string;
  /** 0..1 when computable. */
  fraction?: number;
  at: number;
}

export class ProgressBus {
  private emitter = new EventEmitter();

  emit(event: ProgressEvent): void {
    this.emitter.emit('progress', event);
  }

  on(listener: (event: ProgressEvent) => void): () => void {
    this.emitter.on('progress', listener);
    return () => this.emitter.off('progress', listener);
  }
}
