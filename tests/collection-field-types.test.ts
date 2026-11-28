import type { Config, Field } from 'payload'

import { describe, expect, it } from 'vitest'

import { workflowsPlugin } from '../src/plugin/index.js'

/**
 * Collects the `type` of every field in a field tree, descending into the
 * containers that can hold fields (groups, arrays, rows, collapsibles, tabs
 * and blocks).
 */
const collectFieldTypes = (fields: Field[], found = new Set<string>()): Set<string> => {
  for (const field of fields) {
    found.add(field.type)
    if ('fields' in field && Array.isArray(field.fields)) {
      collectFieldTypes(field.fields, found)
    }
    if (field.type === 'tabs') {
      for (const tab of field.tabs) {
        collectFieldTypes(tab.fields, found)
      }
    }
    if (field.type === 'blocks') {
      for (const block of field.blocks) {
        collectFieldTypes(block.fields, found)
      }
    }
  }
  return found
}

describe('field types of the plugin collections', () => {
  // On Postgres a `point` field becomes a PostGIS `geometry` column, and the
  // adapter then needs the PostGIS extension to create the schema at all. The
  // plugin must stay installable on a plain Postgres server.
  it('uses no point field, so Postgres needs no PostGIS extension', () => {
    const config = workflowsPlugin({ collectionTriggers: {}, steps: [] })({
      collections: [],
    } as unknown as Config)

    const jobsCollection = config.jobs!.jobsCollectionOverrides!({
      defaultJobsCollection: { slug: 'payload-jobs', fields: [] },
    })

    const slugs = (config.collections ?? []).map((collection) => collection.slug)
    expect(slugs).toEqual(expect.arrayContaining([
      'automation-steps',
      'automation-triggers',
      'workflow-runs',
      'workflows',
    ]))

    for (const collection of [...(config.collections ?? []), jobsCollection]) {
      expect(
        [...collectFieldTypes(collection.fields)],
        `collection "${collection.slug}"`
      ).not.toContain('point')
    }
  })
})
