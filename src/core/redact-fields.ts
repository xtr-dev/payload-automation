import type { Field, Payload } from 'payload'

import type { WorkflowsPluginConfig } from '../plugin/config-types.js'

/**
 * Keeps configured fields of a document out of workflow runs (the
 * `redactFields` plugin option).
 *
 * A hook hands the plugin the document as the Local API sees it, with every
 * field, including ones the collection hides from its own readers (a field
 * with `access.read` returning false, say). Stored as it is, such a field
 * becomes readable by everyone who may read `workflow-runs`.
 *
 * The functions here never change the object they are given: the hook's
 * document belongs to the operation that fired it. They return copies that
 * share everything except the containers along a redacted path.
 */

/**
 * The redacted paths of one collection or global as a tree: `true` marks a
 * field to remove, a nested tree a container (group, array, blocks, tab)
 * with redacted fields somewhere below it.
 */
export type RedactTree = { [key: string]: RedactTree | true }

/**
 * Maps an original object to its redacted copy, for every object that had
 * something removed from it or from below it. Lets the executor recognise a
 * document (or a part of one) that an expression such as `{{trigger.doc}}`
 * copied into a step input, and swap in the copy.
 */
export type RedactedCopies = WeakMap<object, unknown>

const addPath = (tree: RedactTree, path: string): void => {
  const segments = path.split('.').map((segment) => segment.trim()).filter(Boolean)
  let node = tree
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]
    const existing = node[segment]
    if (existing === true) {
      // A shorter path already removes this whole subtree.
      return
    }
    if (i === segments.length - 1) {
      node[segment] = true
      return
    }
    if (existing === undefined) {
      node[segment] = {}
    }
    node = node[segment] as RedactTree
  }
}

/**
 * Paths of the fields a collection or global config marks as not for
 * readers: `hidden: true`, or any `access.read` function.
 *
 * A read access function is not called: its answer depends on who asks, and
 * a run is read by other people than the one whose request triggered it. A
 * field that restricts reading at all is therefore left out for everybody.
 *
 * Fields without a name (rows, collapsibles, unnamed tabs) only group other
 * fields in the admin panel, so their children sit at the parent's path.
 */
const collectHiddenFieldPaths = (fields: Field[], prefix: string, found: string[]): string[] => {
  for (const field of fields) {
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        const tabPrefix = 'name' in tab && tab.name ? `${prefix}${tab.name}.` : prefix
        collectHiddenFieldPaths(tab.fields, tabPrefix, found)
      }
      continue
    }
    const name = 'name' in field && typeof field.name === 'string' ? field.name : undefined
    if (name === undefined) {
      if ('fields' in field && Array.isArray(field.fields)) {
        collectHiddenFieldPaths(field.fields, prefix, found)
      }
      continue
    }
    const restricted = ('hidden' in field && field.hidden === true) ||
      typeof (field as { access?: { read?: unknown } }).access?.read === 'function'
    if (restricted) {
      found.push(`${prefix}${name}`)
      continue
    }
    if ('fields' in field && Array.isArray(field.fields)) {
      collectHiddenFieldPaths(field.fields, `${prefix}${name}.`, found)
    }
    if (field.type === 'blocks') {
      // Every block of the field is stored as an item of the same array, so
      // the paths of all block types are merged under the field's name.
      for (const block of field.blocks) {
        collectHiddenFieldPaths(block.fields, `${prefix}${name}.`, found)
      }
    }
  }
  return found
}

// The tree for a slug only depends on the Payload config and the plugin
// options, so it is built once per Payload instance. Module scope is enough:
// a second copy of the plugin would merely build the same trees again.
const treeCache = new WeakMap<Payload, Map<string, RedactTree | undefined>>()

/**
 * The fields to redact for documents of collection or global `slug`, or
 * undefined when there are none. Combines the paths listed in the plugin
 * options with, when `hiddenFields` is on, the fields the config hides.
 */
export const getRedactTree = (
  payload: Payload,
  options: WorkflowsPluginConfig['redactFields'],
  kind: 'collection' | 'global',
  slug: string
): RedactTree | undefined => {
  if (!options) {
    return undefined
  }
  let cache = treeCache.get(payload)
  if (!cache) {
    cache = new Map()
    treeCache.set(payload, cache)
  }
  const cacheKey = `${kind}:${slug}`
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey)
  }

  const listed = (kind === 'collection' ? options.collections : options.globals) as
    | Record<string, string[] | undefined>
    | undefined
  const paths = [...(listed?.[slug] ?? [])]
  if (options.hiddenFields === true) {
    const config = kind === 'collection'
      ? payload.config.collections?.find((collection) => collection.slug === slug)
      : payload.config.globals?.find((global) => global.slug === slug)
    if (config) {
      collectHiddenFieldPaths(config.fields, '', paths)
    }
  }

  const tree: RedactTree = {}
  for (const path of paths) {
    addPath(tree, path)
  }
  const result = Object.keys(tree).length > 0 ? tree : undefined
  cache.set(cacheKey, result)
  return result
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * Returns `value` without the fields in `tree`. Arrays are passed through
 * transparently: a path applies to every item, which is how the rows of an
 * array or blocks field are addressed. Objects that lose nothing are
 * returned as they are.
 */
export const redactDocument = (value: unknown, tree: RedactTree, copies?: RedactedCopies): unknown => {
  if (Array.isArray(value)) {
    const known = copies?.get(value)
    if (known !== undefined) {
      return known
    }
    const copy: unknown[] = []
    // Registered before the items are visited, so a document that contains
    // itself ends in the copy instead of in endless recursion.
    copies?.set(value, copy)
    for (const item of value) {
      copy.push(redactDocument(item, tree, copies))
    }
    return copy
  }
  if (!isPlainObject(value)) {
    return value
  }
  const known = copies?.get(value)
  if (known !== undefined) {
    return known
  }
  const copy: Record<string, unknown> = { ...value }
  copies?.set(value, copy)
  for (const [key, subtree] of Object.entries(tree)) {
    if (!(key in copy)) {
      continue
    }
    if (subtree === true) {
      delete copy[key]
    } else {
      copy[key] = redactDocument(copy[key], subtree, copies)
    }
  }
  return copy
}

/** Keys of a hook's arguments that hold the document, or the data written to it. */
const DOCUMENT_ARGUMENT_KEYS = ['data', 'doc', 'originalDoc', 'previousDoc'] as const

/**
 * Returns the trigger context of a collection or global hook with the
 * redacted fields removed from every document in it:
 * - `doc`, `previousDoc`, `originalDoc` and `data`;
 * - `args.data` (the operation hooks pass the incoming data there);
 * - `result` of an afterOperation hook: the document itself, each of
 *   `result.docs`, and `result.doc`.
 * A trigger that is not a collection or global hook (manual, webhook,
 * scheduled) has no document of a known collection and is returned as it is.
 */
export const redactTrigger = (
  payload: Payload,
  options: WorkflowsPluginConfig['redactFields'],
  trigger: Record<string, unknown>,
  copies?: RedactedCopies
): Record<string, unknown> => {
  if (!options || trigger === null || typeof trigger !== 'object') {
    return trigger
  }
  const tree = typeof trigger.collection === 'string'
    ? getRedactTree(payload, options, 'collection', trigger.collection)
    : typeof trigger.global === 'string'
      ? getRedactTree(payload, options, 'global', trigger.global)
      : undefined
  if (!tree) {
    return trigger
  }

  const redacted: Record<string, unknown> = { ...trigger }
  for (const key of DOCUMENT_ARGUMENT_KEYS) {
    if (key in redacted) {
      redacted[key] = redactDocument(redacted[key], tree, copies)
    }
  }
  if (isPlainObject(redacted.args) && 'data' in redacted.args) {
    redacted.args = { ...redacted.args, data: redactDocument(redacted.args.data, tree, copies) }
  }
  if (isPlainObject(redacted.result)) {
    // Covers a result that is the document; the keys below cover results
    // that wrap it (find, bulk update and delete, login).
    const result = redactDocument(redacted.result, tree, copies) as Record<string, unknown>
    const wrapped: Record<string, unknown> = { ...result }
    for (const key of ['doc', 'docs'] as const) {
      if (key in wrapped) {
        wrapped[key] = redactDocument(wrapped[key], tree, copies)
      }
    }
    copies?.set(redacted.result, wrapped)
    redacted.result = wrapped
  }
  return redacted
}

/**
 * Removes redacted fields from the documents in a step's output.
 *
 * A step's output has no fixed shape, so this follows the convention of the
 * built-in document steps: the step's input names the collection as
 * `collectionSlug`, and the output holds the document(s) under `doc` and
 * `docs`. Without it, a read-document step would put a field back into the
 * run that was just kept out of the trigger data.
 */
export const redactStepOutput = <T>(
  payload: Payload,
  options: WorkflowsPluginConfig['redactFields'],
  input: unknown,
  output: T
): T => {
  if (!options || !isPlainObject(input) || typeof input.collectionSlug !== 'string' || !isPlainObject(output)) {
    return output
  }
  const tree = getRedactTree(payload, options, 'collection', input.collectionSlug)
  if (!tree) {
    return output
  }
  const redacted: Record<string, unknown> = { ...output }
  for (const key of ['doc', 'docs']) {
    if (key in redacted) {
      redacted[key] = redactDocument(redacted[key], tree)
    }
  }
  return redacted as T
}
