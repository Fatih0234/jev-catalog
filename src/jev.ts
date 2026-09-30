import { TypeSafeClient, type Questions } from '@typesafe-ai/sdk';

export interface TraceEntry {
  step: string;
  model: string;
  latency_ms: number;
  input_tokens: number;
  state: unknown;
  questions: unknown;
  answers: unknown;
}

/** Minimal surface the pipeline needs. Tests supply a fake; production wraps the SDK. */
export interface Judge {
  ask<Q extends Questions>(step: string, state: unknown, questions: Q): Promise<Record<keyof Q, any>>;
  readonly trace: TraceEntry[];
}

export function createJudge(model = process.env.TYPESAFE_MODEL ?? 'jev-latest'): Judge {
  const client = new TypeSafeClient({ defaultModel: model });
  const trace: TraceEntry[] = [];
  return {
    trace,
    async ask(step, state, questions) {
      const started = performance.now();
      const res = await client.systemOne({ state: state as any, questions });
      trace.push({
        step,
        model: res.model,
        latency_ms: Math.round(performance.now() - started),
        input_tokens: res.usage.input_tokens,
        state,
        questions,
        answers: res.answers,
      });
      return res.answers as any;
    },
  };
}
