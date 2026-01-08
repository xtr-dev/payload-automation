import type {Field} from "payload"


export const parameter = (slug: string, field: {name: string} & Field): Field => ({
  ...field,
  name: 'parameter' + field.name.replace(/^\w/, c => c.toUpperCase()) + Math.random().toString().replace(/\D/g, ''),
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
        // Only set the parameter if the virtual field has a defined value.
        // This preserves directly-passed parameters (e.g., from seeding) when
        // the virtual field is not used.
        if (value !== undefined) {
          if (!siblingData.parameters) {
            siblingData.parameters = {}
          }
          siblingData.parameters[field.name] = value
        }
        return undefined // Virtual field, don't store directly
      }
    ]
  },
  virtual: true,
} as Field)
