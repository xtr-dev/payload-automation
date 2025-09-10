import type {Field} from "payload"

import type {Trigger} from "./types.js"

type Options = {
  slug: string,
  fields?: ({name: string} & Field)[]
}

export const trigger = ({
                                slug,
                                fields
                              }: Options): Trigger => {
  return {
    slug,
    fields: (fields || []).map(f => triggerField(slug, f))
  }
}

export const triggerField = (slug: string, field: {name: string} & Field): Field => ({
  ...field,
  name: '__trigger_' + field.name,
  admin: {
    ...(field.admin as unknown || {}),
    condition: (_, siblingData, __) => {
      const previous = field.admin?.condition?.call(null, _, siblingData, __)
      return previous || (siblingData?.type === slug)
    },
  },
  hooks: {
    afterRead: [
      ({ siblingData }) => {
        const parameters = siblingData?.parameters || {}
        return parameters[field.name]
      }
    ],
    beforeChange: [
      ({ siblingData, value }) => {
        if (!siblingData.parameters) {
          siblingData.parameters = {}
        }
        siblingData.parameters[field.name] = value
        return undefined // Virtual field, don't store directly
      }
    ]
  },
  virtual: true,
} as Field)
