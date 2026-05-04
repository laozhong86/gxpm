/**
 * WorkflowEventEmitter — typed event emitter for gxpm execution observability.
 *
 * Design:
 * - Singleton via getWorkflowEventEmitter()
 * - Fire-and-forget: listener errors never propagate to the emitter
 * - Issue-scoped subscriptions via subscribeForIssue()
 * - Built on Node.js EventEmitter (zero external deps)
 */
import { EventEmitter } from "node:events";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export interface PhaseTransitionEvent {
  type: "phase_transition";
  issueId: string;
  fromPhase: string | null;
  toPhase: string;
  timestamp: string;
}

export interface ArtifactWrittenEvent {
  type: "artifact_written";
  issueId: string;
  artifactType: string;
  timestamp: string;
}

export interface RunStartedEvent {
  type: "run_started";
  issueId: string;
  runId: string;
  status: string;
  timestamp: string;
}

export interface RunCompletedEvent {
  type: "run_completed";
  issueId: string;
  runId: string;
  status: string;
  timestamp: string;
}

export interface RunFailedEvent {
  type: "run_failed";
  issueId: string;
  runId: string;
  failureReason?: string;
  timestamp: string;
}

export interface IssueCreatedEvent {
  type: "issue_created";
  issueId: string;
  issueType?: string;
  timestamp: string;
}

export interface IssueTransitionedEvent {
  type: "issue_transitioned";
  issueId: string;
  fromPhase: string | null;
  toPhase: string;
  timestamp: string;
}

export type WorkflowEmitterEvent =
  | PhaseTransitionEvent
  | ArtifactWrittenEvent
  | RunStartedEvent
  | RunCompletedEvent
  | RunFailedEvent
  | IssueCreatedEvent
  | IssueTransitionedEvent;

// ---------------------------------------------------------------------------
// Emitter class
// ---------------------------------------------------------------------------

export type WorkflowEventListener = (event: WorkflowEmitterEvent) => void;

const WORKFLOW_EVENT = "workflow_event";

export class WorkflowEventEmitter {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  /**
   * Emit a workflow event. Fire-and-forget: errors are caught and logged to stderr.
   */
  emit(event: WorkflowEmitterEvent): void {
    try {
      this.emitter.emit(WORKFLOW_EVENT, event);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      console.error(`[workflow-event-emitter] emit error: ${err.message}`);
    }
  }

  /**
   * Subscribe to all workflow events. Returns an unsubscribe function.
   */
  subscribe(listener: WorkflowEventListener): () => void {
    const safeListener = (event: WorkflowEmitterEvent): void => {
      try {
        listener(event);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        console.error(`[workflow-event-emitter] listener error: ${err.message}`);
      }
    };

    this.emitter.on(WORKFLOW_EVENT, safeListener);
    return (): void => {
      this.emitter.removeListener(WORKFLOW_EVENT, safeListener);
    };
  }

  /**
   * Subscribe to events for a specific issue only. Returns an unsubscribe function.
   */
  subscribeForIssue(issueId: string, listener: WorkflowEventListener): () => void {
    return this.subscribe((event: WorkflowEmitterEvent) => {
      if ("issueId" in event && event.issueId === issueId) {
        listener(event);
      }
    });
  }

  /**
   * Remove all listeners. Useful for graceful shutdown.
   */
  clear(): void {
    this.emitter.removeAllListeners();
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let instance: WorkflowEventEmitter | null = null;

export function getWorkflowEventEmitter(): WorkflowEventEmitter {
  if (!instance) {
    instance = new WorkflowEventEmitter();
  }
  return instance;
}

/**
 * Reset singleton for testing.
 */
export function resetWorkflowEventEmitter(): void {
  instance?.clear();
  instance = null;
}
