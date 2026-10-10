import { system } from "@minecraft/server";
import { runCatching } from "./errorReporter.js";
import { JobRunner } from "./jobRunner.js";

export type TaskCallback = () => void | Generator<void, void, unknown>;

export interface ScheduledTask {
    readonly id: string;
    readonly intervalTicks: number;
    readonly offset: number;
    readonly task: TaskCallback;
}

/**
 * Master tick manager and staggered scheduler.
 * Consolidates fragmented interval loops across multiple subsystems into a single master
 * tick dispatcher, staggering workloads across ticks to eliminate watchdog spikes.
 */
export class TickManager {
    private tasks = new Map<string, ScheduledTask>();
    private readonly jobRunner = new JobRunner();
    private readonly inFlightJobs = new Map<string, number>();
    private masterIntervalId: number | null = null;
    private currentTick: number = 0;

    /**
     * Registers a recurring task with an interval in ticks and an optional staggered offset.
     */
    register(id: string, intervalTicks: number, task: TaskCallback, offset?: number): void {
        const validInterval = Math.max(1, Math.floor(intervalTicks));
        const computedOffset = offset !== undefined ? Math.max(0, Math.floor(offset)) : this.tasks.size % validInterval;

        this.tasks.set(id, {
            id,
            intervalTicks: validInterval,
            offset: computedOffset,
            task
        });
    }

    /**
     * Unregisters a task by its unique identifier.
     */
    unregister(id: string): void {
        const inFlight = this.inFlightJobs.get(id);
        if (inFlight !== undefined) {
            this.jobRunner.clear(inFlight);
            this.inFlightJobs.delete(id);
        }
        this.tasks.delete(id);
    }

    /**
     * Checks if a task is registered.
     */
    isRegistered(id: string): boolean {
        return this.tasks.has(id);
    }

    /**
     * Returns the current master tick counter.
     */
    getCurrentTick(): number {
        return this.currentTick;
    }

    /**
     * Returns all registered task identifiers.
     */
    getRegisteredTaskIds(): string[] {
        return Array.from(this.tasks.keys());
    }

    /**
     * Advances by one tick, executing all tasks scheduled for this tick.
     * Wrapped in errorReporter boundaries to isolate failures.
     */
    step(): void {
        const tick = this.currentTick++;
        for (const task of this.tasks.values()) {
            if ((tick - task.offset) % task.intervalTicks === 0) {
                if (this.inFlightJobs.has(task.id)) continue;

                runCatching({ system: "tickManager", operation: `task:${task.id}` }, () => {
                    const result = task.task();
                    if (result && typeof result[Symbol.iterator] === "function") {
                        const jobId = this.jobRunner.run(result as Generator<void, void, void>, {
                            system: "tickManager",
                            operation: `task:${task.id}`,
                            onFinally: () => {
                                this.inFlightJobs.delete(task.id);
                            }
                        });
                        if (jobId >= 0) {
                            this.inFlightJobs.set(task.id, jobId);
                        }
                    }
                });
            }
        }
    }

    /**
     * Starts the master tick loop if not already running.
     */
    start(): void {
        if (this.masterIntervalId !== null) return;
        this.masterIntervalId = system.runInterval(() => {
            this.step();
        }, 1);
    }

    /**
     * Stops the master tick loop and resets the tick counter.
     */
    stop(): void {
        if (this.masterIntervalId !== null) {
            system.clearRun(this.masterIntervalId);
            this.masterIntervalId = null;
        }
        this.jobRunner.clearAll();
        this.inFlightJobs.clear();
        this.currentTick = 0;
    }
}

export const tickManager = new TickManager();
