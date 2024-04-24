import { DynamoDB } from 'aws-sdk'
import * as AWSXRay from 'aws-xray-sdk'
import {
  OrderEventDdb,
  OrderEventRepository,
} from '/opt/nodejs/orderEventRepositoryLayer'
import { Context, SNSEvent, SNSMessage } from 'aws-lambda'
import { Envelope, OrderEvent } from '/opt/nodejs/orderEventsLayer'

AWSXRay.captureAWS(require('aws-sdk'))

const eventsDdb = process.env.EVENTS_DDB!

const ddbClient = new DynamoDB.DocumentClient()
const orderEventRepository = new OrderEventRepository(ddbClient, eventsDdb)

export async function handler(
  event: SNSEvent,
  context: Context,
): Promise<void> {
  const promises = event.Records.map((record) => createEvent(record.Sns))
  await Promise.all(promises)
}

function createEvent(body: SNSMessage) {
  const envelope: Envelope = JSON.parse(body.Message)
  const event = JSON.parse(envelope.data) as OrderEvent
  console.log(`Order event - MessageId: ${body.MessageId}`)
  const timestamp = Date.now()
  const ttl = Math.floor(timestamp / 1000 + 5 * 60)
  const orderEventDdb: OrderEventDdb = {
    pk: `#order_${event.orderId}`,
    sk: `${envelope.eventType}#${timestamp}`,
    email: event.email,
    createdAt: timestamp,
    requestId: event.requestId,
    eventType: envelope.eventType,
    info: {
      orderId: event.orderId,
      productCodes: event.productCodes,
      messageId: body.MessageId,
    },
    ttl,
  }
  return orderEventRepository.createdOrderEvent(orderEventDdb)
}
