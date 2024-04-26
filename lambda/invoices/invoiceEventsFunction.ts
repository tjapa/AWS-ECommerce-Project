import {
  AttributeValue,
  Context,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from 'aws-lambda'
import { ApiGatewayManagementApi, DynamoDB } from 'aws-sdk'
import { InvoiceWSService } from '/opt/nodejs/invoiceWSConnectionLayer'
import * as AWSXRay from 'aws-xray-sdk'

AWSXRay.captureAWS(require('aws-sdk'))

const eventsDdb = process.env.EVENTS_DDB!
const invoiceWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6)

const ddbClient = new DynamoDB.DocumentClient()
const apigwManagementApi = new ApiGatewayManagementApi({
  endpoint: invoiceWsApiEndpoint,
})

const invoiceWSService = new InvoiceWSService(apigwManagementApi)

export async function handler(
  event: DynamoDBStreamEvent,
  context: Context,
): Promise<void> {
  const promises = event.Records.map((record) => handleRecord(record))
  await Promise.all(promises)
}

async function handleRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName === 'INSERT') {
    if (record.dynamodb?.NewImage?.pk?.S?.startsWith('#transaction')) {
      console.log('Invoice transaction event received')
    } else {
      console.log('Invoice event received')
      await createEvent(record.dynamodb!.NewImage!, 'INVOICE_CREATED')
    }
  } else if (record.eventName === 'MODIFY') {
  } else if (record.eventName === 'REMOVE') {
    if (record.dynamodb?.OldImage?.pk?.S === '#transaction') {
      console.log('Invoice transaction event received')
      processExpiredTransaction(record.dynamodb!.OldImage!)
    } else {
    }
  }
}

async function createEvent(
  invoiceImage: { [key: string]: AttributeValue },
  eventType: string,
): Promise<void> {
  const timestamp = Date.now()
  const ttl = Math.floor(timestamp / 1000 + 60 * 60)
  await ddbClient
    .put({
      TableName: eventsDdb,
      Item: {
        pk: `#invoice_${invoiceImage.sk.S}`,
        sk: `${eventType}#${timestamp}`,
        ttl,
        email: invoiceImage.email.S!.split('_')[1],
        createdAt: timestamp,
        eventType,
        info: {
          transactionId: invoiceImage.transactionId.S,
          productId: invoiceImage.productId.S,
          quantity: invoiceImage.quantity.N,
        },
      },
    })
    .promise()
}

async function processExpiredTransaction(invoiceImage: {
  [key: string]: AttributeValue
}): Promise<void> {
  const timestamp = Date.now()
  const ttl = Math.floor(timestamp / 1000 + 60 * 60)
  const transactionId = invoiceImage.sk.S!
  const connectionId = invoiceImage.connectionId.S!

  console.log(`TransactionId: ${transactionId} - ConnectionId: ${connectionId}`)

  if (invoiceImage.transactionStatus.S === 'INVOICE_PROCESSED') {
    console.log('Invoice processed')
  } else {
    console.log(
      `Invoice import failed - Status: ${invoiceImage.transactionStatus.S}`,
    )
    await invoiceWSService.sendInvoiceStatus(
      transactionId,
      connectionId,
      'TIMEOUT',
    )
    await invoiceWSService.disconnectClient(connectionId)
  }
}
