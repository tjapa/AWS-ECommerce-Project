import { Context, SNSEvent } from 'aws-lambda'

export async function handler(
  event: SNSEvent,
  context: Context,
): Promise<void> {
  for (const record of event.Records) {
    console.log(record.Sns)
  }
}
