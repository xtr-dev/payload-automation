import { expectTypeOf } from 'vitest'

import type {
  CustomTriggerOptions,
  ExecutionContext,
  TriggerResult,
} from '../index.js'
import { triggerCustomWorkflow } from '../exports/server.js'
import type { ExecutionContext as RuntimeExecutionContext } from '../core/workflow-executor.js'

type ClientSafeCustomTriggerOptions = Omit<
  Parameters<typeof triggerCustomWorkflow>[1],
  'req'
> & {
  // The public entry deliberately does not import PayloadRequest.
  req?: any
}

expectTypeOf<Awaited<ReturnType<typeof triggerCustomWorkflow>>>()
  .toEqualTypeOf<TriggerResult[]>()

expectTypeOf<ClientSafeCustomTriggerOptions>()
  .toEqualTypeOf<CustomTriggerOptions>()

expectTypeOf<RuntimeExecutionContext>()
  .toEqualTypeOf<ExecutionContext>()
