import type {Field, TextField, SelectField} from "payload"

import type {Trigger} from "./types.js"

type FieldWithName = TextField | SelectField | (Field & { name: string })

type Options = {
  slug: string,
  fields?: FieldWithName[]
}

export const trigger = ({
                                slug,
                                fields
                              }: Options): Trigger => {
  return {
    slug,
    fields: (fields || []).map(triggerField) as Field[]
  }
}

export const triggerField = (field: FieldWithName): Field => ({
  ...field,
  name: '__trigger_' + field.name,
  admin: {
    ...(field.admin as any || {}),
    condition: (_, siblingData, __) => {
      const previous = field.admin?.condition?.call(null, _, siblingData, __)
      return previous !== false // Preserve existing condition if it exists
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
