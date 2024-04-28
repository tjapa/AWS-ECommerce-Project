import { Context, S3Event, S3EventRecord } from 'aws-lambda'
import { ApiGatewayManagementApi, DynamoDB, EventBridge, S3 } from 'aws-sdk'
import * as AWSXRay from 'aws-xray-sdk'
import {
  InvoiceTransactionRepository,
  InvoiceTransactionStatus,
} from '/opt/nodejs/invoiceTransactionLayer'
import { InvoiceWSService } from '/opt/nodejs/invoiceWSConnectionLayer'
import {
  InvoiceFile,
  InvoiceRepository,
} from '/opt/nodejs/invoiceRepositoryLayer'

AWSXRay.captureAWS(require('aws-sdk'))

const invoicesDdb = process.env.INVOICES_DDB!
const invoiceWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6)
const auditBusName = process.env.AUDIT_BUS_NAME!

const s3Client = new S3()
const ddbClient = new DynamoDB.DocumentClient()
const apigwManagementApi = new ApiGatewayManagementApi({
  endpoint: invoiceWsApiEndpoint,
})
const eventBridgeClient = new EventBridge()
const invoiceTransactionRepository = new InvoiceTransactionRepository(
  ddbClient,
  invoicesDdb,
)
const invoiceWSService = new InvoiceWSService(apigwManagementApi)
const invoiceRepository = new InvoiceRepository(ddbClient, invoicesDdb)

export async function handler(event: S3Event, context: Context): Promise<void> {
  console.log(event)

  const promises = event.Records.map((record) => processRecord(record))
  await Promise.all(promises)
}

async function processRecord(record: S3EventRecord): Promise<void> {
  try {
    const key = record.s3.object.key
    const invoiceTransaction =
      await invoiceTransactionRepository.getInvoiceTransaction(key)

    if (
      invoiceTransaction.transactionStatus !==
      InvoiceTransactionStatus.GENERATED
    ) {
      await invoiceWSService.sendInvoiceStatus(
        key,
        invoiceTransaction.connectionId,
        invoiceTransaction.transactionStatus,
      )
      console.error(`Non valid transaction status`)
      return
    }

    await Promise.all([
      invoiceWSService.sendInvoiceStatus(
        key,
        invoiceTransaction.connectionId,
        InvoiceTransactionStatus.RECEIVED,
      ),
      invoiceTransactionRepository.updateInvoiceTransaction(
        key,
        InvoiceTransactionStatus.RECEIVED,
      ),
    ])

    const object = await s3Client
      .getObject({
        Key: key,
        Bucket: record.s3.bucket.name,
      })
      .promise()
    const invoice = JSON.parse(object.Body!.toString('utf-8')) as InvoiceFile
    console.log(invoice)

    if (invoice.invoiceNumber && invoice.invoiceNumber.length > 5) {
      await Promise.all([
        invoiceRepository.create({
          pk: `#invoice_${invoice.customerName}`,
          sk: invoice.invoiceNumber,
          ttl: 0,
          totalValue: invoice.totalValue,
          productId: invoice.productId,
          quantity: invoice.quantity,
          transactionId: key,
          createdAt: Date.now(),
        }),
        invoiceTransactionRepository.updateInvoiceTransaction(
          key,
          InvoiceTransactionStatus.PROCESSED,
        ),
        invoiceWSService.sendInvoiceStatus(
          key,
          invoiceTransaction.connectionId,
          InvoiceTransactionStatus.PROCESSED,
        ),
        s3Client
          .deleteObject({ Key: key, Bucket: record.s3.bucket.name })
          .promise(),
      ])
    } else {
      console.error(
        `Invoice import failed - non valid invoice number - TransactionId: ${key}`,
      )
      await Promise.all([
        invoiceTransactionRepository.updateInvoiceTransaction(
          key,
          InvoiceTransactionStatus.NON_VALID_INVOICE_NUMBER,
        ),
        invoiceWSService.sendInvoiceStatus(
          key,
          invoiceTransaction.connectionId,
          InvoiceTransactionStatus.NON_VALID_INVOICE_NUMBER,
        ),
        eventBridgeClient
          .putEvents({
            Entries: [
              {
                Source: 'app.invoice',
                EventBusName: auditBusName,
                DetailType: 'invoice',
                Time: new Date(),
                Detail: JSON.stringify({
                  errorDetail: 'FAIL_NO_INVOICE_NUMBER',
                  info: {
                    invoiceKey: key,
                    customerName: invoice.customerName,
                  },
                }),
              },
            ],
          })
          .promise(),
      ])
      await invoiceWSService.disconnectClient(invoiceTransaction.connectionId)
    }
  } catch (err) {
    console.error((<Error>err).message)
  }
}
