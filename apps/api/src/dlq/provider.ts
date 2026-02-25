export type DlqTopic =
  | "PIPES_WEBHOOK"
  | "PRECOMPUTE_TASK"
  | "TRACKING_EVENT"
  | "EXPORT_TASK"
  | "PIPES_CALLBACK_DELIVERY";

export type DlqEnvelope = {
  topic: DlqTopic;
  tenantKey?: string;
  correlationId?: string;
  dedupeKey?: string;
  payload: unknown;
  meta?: Record<string, unknown>;
};

export type DueDlqMessage = {
  id: string;
  env: DlqEnvelope;
  attempts: number;
  maxAttempts: number;
};

export interface DlqProvider {
  enqueueFailure(env: DlqEnvelope, err: Error, opts?: { maxAttempts?: number }): Promise<void>;
  fetchDue(limit: number): Promise<DueDlqMessage[]>;
  markRetrying(id: string): Promise<void>;
  markSucceeded(id: string, note?: string): Promise<void>;
  markQuarantined(id: string, note?: string): Promise<void>;
  reschedule(id: string, nextRetryAt: Date, err: Error): Promise<void>;
}

// Alias kept for future broker-backed implementations (SQS/Kafka/BullMQ).
export type QueueProvider = DlqProvider;

export const createNoopDlqProvider = (): DlqProvider => ({
  async enqueueFailure() {
    return;
  },
  async fetchDue() {
    return [];
  },
  async markRetrying() {
    return;
  },
  async markSucceeded() {
    return;
  },
  async markQuarantined() {
    return;
  },
  async reschedule() {
    return;
  }
});
