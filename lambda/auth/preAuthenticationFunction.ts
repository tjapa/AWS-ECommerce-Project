import { PreAuthenticationTriggerEvent, Context, Callback } from 'aws-lambda'

export async function handler(
  event: PreAuthenticationTriggerEvent,
  context: Context,
  callback: Callback,
): Promise<void> {
  console.log(event)
  callback(null, event)
}
