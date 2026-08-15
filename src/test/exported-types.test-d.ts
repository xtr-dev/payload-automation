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

  // @ts-expect-error Known defect r10oia44: the runtime requires `slug`, not `workflowId`.
  expectTypeOf<RuntimeOptions>().toExtend<CustomTriggerOptions>()
  // @ts-expect-error Known defect r10oia44: the exported type requires `workflowId`, not `slug`.
  expectTypeOf<CustomTriggerOptions>().toExtend<RuntimeOptions>()
})

it('exported TriggerResult matches what triggerCustomWorkflow resolves with', () => {
  type RuntimeResult = Awaited<ReturnType<typeof triggerCustomWorkflow>>[number]

  // @ts-expect-error Known defect r10oia44: the runtime result has `status`, not `success`.
  expectTypeOf<RuntimeResult>().toExtend<TriggerResult>()
  // @ts-expect-error Known defect r10oia44: the exported result omits required runtime fields.
  expectTypeOf<TriggerResult>().toExtend<RuntimeResult>()
})

it('exported ExecutionContext matches the context parameter of WorkflowExecutor.execute', () => {
  type RuntimeContext = Parameters<WorkflowExecutor['execute']>[1]

  // @ts-expect-error Known defect r10oia44: the runtime context does not carry `payload` or `req`.
  expectTypeOf<RuntimeContext>().toExtend<ExecutionContext>()
  expectTypeOf<ExecutionContext>().toExtend<RuntimeContext>()
})
