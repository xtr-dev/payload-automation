/**
 * Grouped hook options for better UX in the admin panel.
 * Organized by category instead of a flat list of 32+ hooks.
 */

export interface HookOption {
  value: string
  label: string
  description?: string
}

export interface HookOptionGroup {
  label: string
  options: HookOption[]
}

/**
 * Collection hook options grouped by category.
 */
export const collectionHookGroups: HookOptionGroup[] = [
  {
    label: 'Document Lifecycle',
    options: [
      { value: 'afterChange', label: 'After Create/Update', description: 'Fires after a document is created or updated' },
      { value: 'afterDelete', label: 'After Delete', description: 'Fires after a document is deleted' },
      { value: 'afterRead', label: 'After Read', description: 'Fires after a document is fetched' },
    ]
  },
  {
    label: 'Before Operations',
    options: [
      { value: 'beforeValidate', label: 'Before Validate', description: 'Fires before field validation runs' },
      { value: 'beforeChange', label: 'Before Save', description: 'Fires after validation, before saving' },
      { value: 'beforeDelete', label: 'Before Delete', description: 'Fires before a document is deleted' },
      { value: 'beforeRead', label: 'Before Read', description: 'Fires before a document is fetched' },
    ]
  },
  {
    label: 'Authentication',
    options: [
      { value: 'afterLogin', label: 'After Login', description: 'Fires after user successfully logs in' },
      { value: 'afterLogout', label: 'After Logout', description: 'Fires after user logs out' },
      { value: 'beforeLogin', label: 'Before Login', description: 'Fires before login attempt' },
      { value: 'afterForgotPassword', label: 'After Forgot Password', description: 'Fires after forgot password request' },
      { value: 'afterRefresh', label: 'After Token Refresh', description: 'Fires after auth token is refreshed' },
      { value: 'afterMe', label: 'After Me Query', description: 'Fires after /me endpoint is called' },
    ]
  },
  {
    label: 'Advanced',
    options: [
      { value: 'beforeOperation', label: 'Before Operation', description: 'Fires before any CRUD operation' },
      { value: 'afterOperation', label: 'After Operation', description: 'Fires after any CRUD operation' },
      { value: 'afterError', label: 'After Error', description: 'Fires when an error occurs' },
    ]
  }
]

/**
 * Global hook options grouped by category.
 */
export const globalHookGroups: HookOptionGroup[] = [
  {
    label: 'Document Lifecycle',
    options: [
      { value: 'afterChange', label: 'After Update', description: 'Fires after the global is updated' },
      { value: 'afterRead', label: 'After Read', description: 'Fires after the global is fetched' },
    ]
  },
  {
    label: 'Before Operations',
    options: [
      { value: 'beforeValidate', label: 'Before Validate', description: 'Fires before field validation runs' },
      { value: 'beforeChange', label: 'Before Save', description: 'Fires after validation, before saving' },
      { value: 'beforeRead', label: 'Before Read', description: 'Fires before the global is fetched' },
    ]
  }
]

/**
 * Flat list of collection hook options for select fields.
 */
export const collectionHookOptions: HookOption[] = collectionHookGroups.flatMap(group => group.options)

/**
 * Flat list of global hook options for select fields.
 */
export const globalHookOptions: HookOption[] = globalHookGroups.flatMap(group => group.options)

/**
 * All hook values as a simple string array for validation.
 */
export const allCollectionHooks = collectionHookOptions.map(opt => opt.value)
export const allGlobalHooks = globalHookOptions.map(opt => opt.value)
