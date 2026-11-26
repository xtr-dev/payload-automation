// Compile-time only: nothing here runs. `pnpm test:types` type-checks this file
// with tsconfig.type-test.json, and a failing line means a type published from
// the main entry (src/index.ts) no longer matches the runtime shape it claims
// to describe. See invariant r10oia44.

import type { triggerCustomWorkflow } from '../src/core/trigger-custom-workflow.js'
import type { ExecutionContext as RuntimeExecutionContext } from '../src/core/workflow-executor.js'
import type { CustomTriggerOptions, ExecutionContext, TriggerResult } from '../src/index.js'

function assertAssignable<T>(_value: T): void {
  return undefined
}

// TriggerResult must describe exactly what triggerCustomWorkflow resolves to.
type ActualTriggerResult = Awaited<ReturnType<typeof triggerCustomWorkflow>>[number]
declare const actualTriggerResult: ActualTriggerResult
declare const publishedTriggerResult: TriggerResult
assertAssignable<TriggerResult>(actualTriggerResult)
assertAssignable<ActualTriggerResult>(publishedTriggerResult)

// CustomTriggerOptions must describe exactly what triggerCustomWorkflow accepts
// as its second argument.
type ActualCustomTriggerOptions = Parameters<typeof triggerCustomWorkflow>[1]
declare const actualCustomTriggerOptions: ActualCustomTriggerOptions
declare const publishedCustomTriggerOptions: CustomTriggerOptions
assertAssignable<CustomTriggerOptions>(actualCustomTriggerOptions)
assertAssignable<ActualCustomTriggerOptions>(publishedCustomTriggerOptions)

// ExecutionContext published from the main entry must be the executor's own
// type, not an independent copy — a copy can silently grow members (`payload`,
// `req`) that invariant r18zrejd says an expression must never be able to reach.
declare const runtimeExecutionContext: RuntimeExecutionContext
declare const publishedExecutionContext: ExecutionContext
assertAssignable<ExecutionContext>(runtimeExecutionContext)
assertAssignable<RuntimeExecutionContext>(publishedExecutionContext)
