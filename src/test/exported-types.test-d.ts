import { expectTypeOf, it } from 'vitest'

import type { triggerCustomWorkflow } from '../core/trigger-custom-workflow.js'
import type { WorkflowExecutor } from '../core/workflow-executor.js'
import type { CustomTriggerOptions, ExecutionContext, TriggerResult } from '../index.js'

// The types the package exports from './index.js' are documented as the
// public shape of these APIs. If they drift from what the runtime actually
// takes and returns, a consumer typing against the export gets a type that
// compiles but is wrong at every call site - e.g. branching on
// `result.success`, a field the runtime TriggerResult never produces.
// "Mutually assignable" rather than "equal" on purpose: a type that is
// merely narrower would still be a safe (if incomplete) description, but
// these name fields (`success`, `workflowId` as required, `payload`) the
// runtime does not, so neither direction should hold if the drift is real.

it('exported CustomTriggerOptions matches the second parameter of triggerCustomWorkflow', () => {
  type RuntimeOptions = Parameters<typeof triggerCustomWorkflow>[1]

  expectTypeOf<RuntimeOptions>().toExtend<CustomTriggerOptions>()
  expectTypeOf<CustomTriggerOptions>().toExtend<RuntimeOptions>()
})

it('exported TriggerResult matches what triggerCustomWorkflow resolves with', () => {
  type RuntimeResult = Awaited<ReturnType<typeof triggerCustomWorkflow>>[number]

  expectTypeOf<RuntimeResult>().toExtend<TriggerResult>()
  expectTypeOf<TriggerResult>().toExtend<RuntimeResult>()
})

it('exported ExecutionContext matches the context parameter of WorkflowExecutor.execute', () => {
  type RuntimeContext = Parameters<WorkflowExecutor['execute']>[1]

  expectTypeOf<RuntimeContext>().toExtend<ExecutionContext>()
  expectTypeOf<ExecutionContext>().toExtend<RuntimeContext>()
})
