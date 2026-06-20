/** Tiny structured logger used by the worker and dev scripts. */
import { AsyncLocalStorage } from "node:async_hooks";

function ts() {
  return new Date().toISOString();
}

export type LogLevel = "info" | "warn" | "error";
export type LogSink = (level: LogLevel, message: string, meta?: unknown) => void;

/**
 * Per-job log sink. When a body runs inside `withLogSink`, every log call made
 * anywhere in that async context (including parallel scene work) is also
 * forwarded to the sink — this is how a request's pipeline logs get persisted.
 */
const sinkStore = new AsyncLocalStorage<LogSink>();

export function withLogSink<T>(sink: LogSink, fn: () => Promise<T>): Promise<T> {
  return sinkStore.run(sink, fn);
}

function emit(level: LogLevel, msg: string, meta?: unknown) {
  const sink = sinkStore.getStore();
  if (sink) {
    try {
      sink(level, msg, meta);
    } catch {
      /* a broken sink must never break the pipeline */
    }
  }
}

export const log = {
  info: (msg: string, meta?: unknown) => {
    console.log(`[${ts()}] ${msg}`, meta ?? "");
    emit("info", msg, meta);
  },
  warn: (msg: string, meta?: unknown) => {
    console.warn(`[${ts()}] WARN ${msg}`, meta ?? "");
    emit("warn", msg, meta);
  },
  error: (msg: string, meta?: unknown) => {
    console.error(`[${ts()}] ERROR ${msg}`, meta ?? "");
    emit("error", msg, meta);
  },
};
