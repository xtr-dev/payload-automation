import type {Field} from "payload"


export const parameter = (slug: string, field: {name: string} & Field): Field => ({
  ...field,
  name: 'parameter' + field.name.replace(/^\w/, c => c.toUpperCase()),
  admin: {
    ...(field.admin as unknown || {}),
    condition: (_, siblingData, __) => {
      const previous = field.admin?.condition?.call(null, _, siblingData, __)
      return (previous === undefined || previous) && (siblingData?.type === slug)
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
