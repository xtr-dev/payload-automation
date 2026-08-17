import { expectTypeOf } from 'vitest'

import type {
  CustomTriggerOptions,
  ExecutionContext,
  TriggerResult,
} from '../index.js'
import { triggerCustomWorkflow } from '../exports/server.js'
import type { ExecutionContext as RuntimeExecutionContext } from '../core/workflow-executor.js'

// Both sides go through the same Omit<..., 'req'> & { req?: any } transform.
// Applying it to only one side lets `data` get widened from optional to
// required-`| undefined` by the intersection, which fails toEqualTypeOf even
// though the two CustomTriggerOptions shapes actually match (see review
// comment rmsxid4q70 on fix/public-type-contracts).
type ClientSafeCustomTriggerOptions = Omit<
  Parameters<typeof triggerCustomWorkflow>[1],
  'req'
> & {
  // The public entry deliberately does not import PayloadRequest.
  req?: any
}

type NormalizedPublicCustomTriggerOptions = Omit<CustomTriggerOptions, 'req'> & {
  req?: any
}

expectTypeOf<Awaited<ReturnType<typeof triggerCustomWorkflow>>>()
  .toEqualTypeOf<TriggerResult[]>()

expectTypeOf<ClientSafeCustomTriggerOptions>()
  .toEqualTypeOf<NormalizedPublicCustomTriggerOptions>()

expectTypeOf<RuntimeExecutionContext>()
  .toEqualTypeOf<ExecutionContext>()
