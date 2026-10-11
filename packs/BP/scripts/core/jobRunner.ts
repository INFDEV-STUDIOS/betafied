import { system } from "@minecraft/server";
import { reportError, runCatching } from "./errorReporter.js";

export interface JobOptions {
    /** Subsystem identifier for error reporting (defaults to "jobRunner"). */
    system?: string;
    /** Operation identifier for error reporting (defaults to "execute"). */
    operation?: string;
    /** Invoked if an unhandled error occurs during generator stepping. */
    onError?: (error: unknown) => void;
    /** Invoked when the generator completes naturally or halts due to an error. */
    onFinally?: () => void;
}

export interface BatchJobOptions extends JobOptions {
    /** Number of items to process before yielding the tick. Defaults to 1. */
    batchSize?: number;
}

/**
 * Manages generator time-slicing via Bedrock's `system.runJob`.
 *
 * Bedrock scripts execute in single-threaded QuickJS on the server's main thread.
 * `system.runJob` provides cooperative multitasking across server ticks rather
 * than true multithreading: each job is stepped sequentially within Bedrock's
 * per-tick script time budget.
 *
 * Instances track job IDs to guarantee cleanup when systems stop, preventing
 * orphaned background loops from running across tick intervals.
 */
export class JobRunner {
    private readonly activeJobs: Set<number>;

    constructor() {
        this.activeJobs = new Set<number>();
    }

    /**
     * Queues a generator to step across ticks, tracking its handle until completion.
     */
    public run(
        generator: Generator<void, void, void>,
        options?: JobOptions
    ): number {
        const box = { id: -1 };
        const wrapped = JobRunner.wrap(generator, options, () => {
            if (box.id !== -1) {
                this.activeJobs.delete(box.id);
            }
        });

        const started = runCatching(
            { system: options?.system ?? "jobRunner", operation: "startJob" },
            () => system.runJob(wrapped),
            (err) => {
                options?.onError?.(err);
                options?.onFinally?.();
                return -1;
            }
        );

        if (typeof started !== "number" || started < 0) {
            return -1;
        }

        box.id = started;
        this.activeJobs.add(started);
        return started;
    }

    /**
     * Slices an iterable across ticks, processing `batchSize` items per tick.
     */
    public forEach<T>(
        items: Iterable<T>,
        handler: (item: T, index: number) => void,
        options?: BatchJobOptions
    ): number {
        const gen = JobRunner.batch(items, handler, options?.batchSize);
        return this.run(gen, options);
    }

    /**
     * Checks if a job handle is actively being tracked by this runner.
     */
    public has(jobId: number): boolean {
        return this.activeJobs.has(jobId);
    }

    /**
     * Cancels a tracked job and untracks its handle.
     */
    public clear(jobId: number): void {
        this.activeJobs.delete(jobId);
        JobRunner.clear(jobId);
    }

    /**
     * Alias for clear: cancels a tracked job and untracks its handle.
     */
    public cancel(jobId: number): void {
        this.clear(jobId);
    }

    /**
     * Cancels all jobs currently tracked by this runner instance.
     */
    public clearAll(): void {
        for (const id of this.activeJobs) {
            JobRunner.clear(id);
        }
        this.activeJobs.clear();
    }

    /** Number of jobs currently being stepped across ticks. */
    public get activeCount(): number {
        return this.activeJobs.size;
    }

    /**
     * Standalone static runner: steps a generator with error containment and cleanup.
     */
    public static run(
        generator: Generator<void, void, void>,
        options?: JobOptions
    ): number {
        const wrapped = JobRunner.wrap(generator, options);
        const started = runCatching(
            { system: options?.system ?? "jobRunner", operation: "startJob" },
            () => system.runJob(wrapped),
            (err) => {
                options?.onError?.(err);
                options?.onFinally?.();
                return -1;
            }
        );
        return typeof started === "number" ? started : -1;
    }

    /**
     * Standalone static batch processor: time-slices an iterable across ticks.
     */
    public static forEach<T>(
        items: Iterable<T>,
        handler: (item: T, index: number) => void,
        options?: BatchJobOptions
    ): number {
        const gen = JobRunner.batch(items, handler, options?.batchSize);
        return JobRunner.run(gen, options);
    }

    /**
     * Safely cancels a Bedrock job by handle via `system.clearJob`.
     */
    public static clear(jobId: number): void {
        if (jobId < 0) return;
        runCatching(
            { system: "jobRunner", operation: "clearJob" },
            () => {
                system.clearJob(jobId);
            }
        );
    }

    /**
     * Adapts an iterable into a generator yielding every `batchSize` items.
     */
    public static *batch<T>(
        items: Iterable<T>,
        handler: (item: T, index: number) => void,
        batchSize = 1
    ): Generator<void, void, void> {
        const size = Math.max(1, Math.floor(batchSize));
        let processed = 0;
        let index = 0;
        for (const item of items) {
            handler(item, index++);
            processed++;
            if (processed >= size) {
                processed = 0;
                yield;
            }
        }
    }

    private static *wrap(
        generator: Generator<void, void, void>,
        options?: JobOptions,
        onComplete?: () => void
    ): Generator<void, void, void> {
        try {
            while (true) {
                const res = generator.next();
                if (res.done) break;
                yield;
            }
        } catch (err) {
            if (options?.onError) {
                try {
                    options.onError(err);
                } catch (reportErr) {
                    reportError(
                        {
                            system: options?.system ?? "jobRunner",
                            operation: "onError"
                        },
                        reportErr
                    );
                }
            }
            reportError(
                {
                    system: options?.system ?? "jobRunner",
                    operation: options?.operation ?? "execute"
                },
                err
            );
        } finally {
            if (options?.onFinally) {
                try {
                    options.onFinally();
                } catch (finallyErr) {
                    reportError(
                        {
                            system: options?.system ?? "jobRunner",
                            operation: "onFinally"
                        },
                        finallyErr
                    );
                }
            }
            onComplete?.();
        }
    }
}
