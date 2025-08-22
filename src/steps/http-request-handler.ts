import type {TaskHandler} from "payload"

export const httpStepHandler: TaskHandler<'http-request-step'> = async ({input}) => {
  if (!input) {
    throw new Error('No input provided')
  }
  const response = await fetch(input.url)
  return {
    output: {
      response: await response.text()
    },
    state: response.ok ? 'succeeded' : undefined
  }
}
