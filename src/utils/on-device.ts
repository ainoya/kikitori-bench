import * as os from "node:os";

/**
 * Serializes on-device transcriptions.
 * A local engine owns the machine's CPU, GPU and memory while it runs, so
 * overlapping requests would measure contention instead of the model.
 */
export class SerialGate {
  private tail: Promise<void> = Promise.resolve();

  run<A>(task: () => Promise<A>): Promise<A> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    return previous.then(task).finally(release);
  }
}

/** Host processor and memory, recorded as part of an on-device run condition. */
export const describeHostHardware = (): string => {
  const processor = os.cpus()[0]?.model.trim() || os.arch();
  const memoryGiB = Math.round(os.totalmem() / 2 ** 30);
  return `${processor}, ${memoryGiB} GB RAM`;
};
