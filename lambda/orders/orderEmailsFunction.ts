import { Context, SQSEvent } from 'aws-lambda'
import * as AWSXRay from 'aws-xray-sdk'

AWSXRay.captureAWS(require('aws-sdk'))

export async function handler(
  event: SQSEvent,
  context: Context,
): Promise<void> {
  for (const record of event.Records) {
    console.log(record)
    const body = JSON.parse(record.body)
    console.log(body)
  }
}
