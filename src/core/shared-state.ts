/**
 * State that every copy of this plugin loaded into one process must share.
 *
 * A bundler can evaluate the plugin's modules more than once in a process.
 * Next.js does so when Payload is initialised from `instrumentation.ts`: that
 * file is bundled separately from the app, so the Payload config (including
 * the task handlers this plugin wrapped) is built by one copy of the plugin,
 * while a route or server action that calls `triggerWorkflowById` runs
 * another. Both copies get the same Payload instance, because Payload caches
 * it on `globalThis`, but a `const` at module scope exists once per copy. Any
 * state that one copy writes and another may read therefore lives here.
 *
 * The state hangs off `globalThis` under a `Symbol.for` key, which resolves
 * to the same symbol in every copy. Values that belong to one Payload
 * instance go in a `WeakMap` keyed by that instance, so separate instances in
 * a process (tests, multi-tenant setups) stay isolated and their entries are
 * collected together with the instance. Nothing is attached to the Payload
 * object itself, which the plugin does not own.
 *
 * Module-level values that are only read by the copy that wrote them (the
 * compiled-expression cache, for example) do not need to be here.
 */

// The version suffix changes whenever the shape of the stored values changes
// incompatibly, so two different plugin versions in one process (a duplicated
// dependency) each get their own state and never read values they would
// misinterpret.
const REGISTRY_KEY = Symbol.for('@xtr-dev/payload-automation.sharedState.v1')

type Registry = Map<string, unknown>

const getRegistry = (): Registry => {
  const holder = globalThis as unknown as Record<symbol, Registry | undefined>
  let registry = holder[REGISTRY_KEY]
  if (!registry) {
    registry = new Map()
    // Non-enumerable so the registry does not show up when application code
    // or a debugger enumerates the global object.
    Object.defineProperty(globalThis, REGISTRY_KEY, {
      configurable: true,
      enumerable: false,
      value: registry,
      writable: false,
    })
  }
  return registry
}

/**
 * Returns the process-wide value stored under `name`, creating it with
 * `create` the first time any copy of the plugin asks for it.
 */
export const getSharedState = <T>(name: string, create: () => T): T => {
  const registry = getRegistry()
  if (!registry.has(name)) {
    registry.set(name, create())
  }
  return registry.get(name) as T
}
