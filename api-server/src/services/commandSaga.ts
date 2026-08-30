export type CommandSagaStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'compensating'
  | 'compensated'
  | 'blocked';

export type CommandStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'compensating'
  | 'compensated'
  | 'skipped';

export interface CommandSagaStep {
  id: string;
  name: string;
  status: CommandStepStatus;
  compensatable: boolean;
  attempt: number;
}

export interface CommandSagaState {
  id: string;
  idempotency_key: string;
  status: CommandSagaStatus;
  steps: CommandSagaStep[];
  current_step_id: string | null;
  failure_reason: string | null;
}

export type CommandSagaEvent =
  | { type: 'start' }
  | { type: 'step_started'; stepId: string }
  | { type: 'step_completed'; stepId: string }
  | { type: 'step_failed'; stepId: string; reason: string }
  | { type: 'compensation_started'; stepId: string }
  | { type: 'compensation_completed'; stepId: string }
  | { type: 'block'; reason: string };

function updateStep(
  state: CommandSagaState,
  stepId: string,
  updater: (step: CommandSagaStep) => CommandSagaStep,
): CommandSagaStep[] {
  const index = state.steps.findIndex((step) => step.id === stepId);
  if (index < 0) throw new Error(`Unknown saga step: ${stepId}`);
  return state.steps.map((step, i) => (i === index ? updater(step) : step));
}

function assertTransition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

/**
 * Pure state reducer for multi-step command execution.
 *
 * It deliberately does not perform side effects. External adapters are responsible
 * for writes and compensating actions; this reducer only determines the allowed
 * state transitions so failed distributed work cannot be silently treated as done.
 */
export function reduceCommandSaga(
  state: CommandSagaState,
  event: CommandSagaEvent,
): CommandSagaState {
  switch (event.type) {
    case 'start':
      assertTransition(state.status === 'pending', 'Saga can only start from pending.');
      return { ...state, status: 'running', failure_reason: null };

    case 'step_started': {
      assertTransition(state.status === 'running', 'Steps can only start while saga is running.');
      const steps = updateStep(state, event.stepId, (step) => {
        assertTransition(step.status === 'pending' || step.status === 'failed', 'Step is not startable.');
        return { ...step, status: 'running', attempt: step.attempt + 1 };
      });
      return { ...state, steps, current_step_id: event.stepId };
    }

    case 'step_completed': {
      assertTransition(state.status === 'running', 'Step completion requires a running saga.');
      const steps = updateStep(state, event.stepId, (step) => {
        assertTransition(step.status === 'running', 'Only a running step can complete.');
        return { ...step, status: 'completed' };
      });
      const completed = steps.every((step) => step.status === 'completed' || step.status === 'skipped');
      return {
        ...state,
        steps,
        current_step_id: completed ? null : state.current_step_id,
        status: completed ? 'completed' : state.status,
      };
    }

    case 'step_failed': {
      assertTransition(state.status === 'running', 'Step failure requires a running saga.');
      const steps = updateStep(state, event.stepId, (step) => {
        assertTransition(step.status === 'running', 'Only a running step can fail.');
        return { ...step, status: 'failed' };
      });
      const compensationNeeded = steps.some(
        (step) => step.status === 'completed' && step.compensatable,
      );
      return {
        ...state,
        steps,
        current_step_id: event.stepId,
        status: compensationNeeded ? 'compensating' : 'failed',
        failure_reason: event.reason.trim() || 'Unknown command failure',
      };
    }

    case 'compensation_started': {
      assertTransition(state.status === 'compensating', 'Compensation requires compensating saga state.');
      const steps = updateStep(state, event.stepId, (step) => {
        assertTransition(step.status === 'completed' && step.compensatable, 'Step is not compensatable.');
        return { ...step, status: 'compensating' };
      });
      return { ...state, steps, current_step_id: event.stepId };
    }

    case 'compensation_completed': {
      assertTransition(state.status === 'compensating', 'Compensation completion requires compensating saga state.');
      const steps = updateStep(state, event.stepId, (step) => {
        assertTransition(step.status === 'compensating', 'Only a compensating step can be compensated.');
        return { ...step, status: 'compensated' };
      });
      const remaining = steps.some((step) => step.status === 'completed' && step.compensatable);
      return {
        ...state,
        steps,
        current_step_id: remaining ? state.current_step_id : null,
        status: remaining ? 'compensating' : 'compensated',
      };
    }

    case 'block':
      assertTransition(
        state.status !== 'completed' && state.status !== 'compensated',
        'Terminal saga cannot be blocked.',
      );
      return {
        ...state,
        status: 'blocked',
        current_step_id: null,
        failure_reason: event.reason.trim() || 'Command blocked by policy',
      };
  }
}

export function createCommandSaga(input: {
  id: string;
  idempotencyKey: string;
  steps: Array<{ id: string; name: string; compensatable?: boolean }>;
}): CommandSagaState {
  if (!input.id.trim()) throw new Error('id is required');
  if (!input.idempotencyKey.trim()) throw new Error('idempotencyKey is required');
  if (!input.steps.length) throw new Error('at least one saga step is required');

  const ids = new Set<string>();
  const steps = input.steps.map((step) => {
    const id = step.id.trim();
    const name = step.name.trim();
    if (!id) throw new Error('step id is required');
    if (!name) throw new Error('step name is required');
    if (ids.has(id)) throw new Error(`duplicate step id: ${id}`);
    ids.add(id);
    return {
      id,
      name,
      status: 'pending' as const,
      compensatable: step.compensatable === true,
      attempt: 0,
    };
  });

  return {
    id: input.id.trim(),
    idempotency_key: input.idempotencyKey.trim(),
    status: 'pending',
    steps,
    current_step_id: null,
    failure_reason: null,
  };
}
