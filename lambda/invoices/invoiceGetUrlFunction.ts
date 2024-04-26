import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda'
import { ApiGatewayManagementApi, DynamoDB, S3 } from 'aws-sdk'
import * as AWSXRay from 'aws-xray-sdk'
import { v4 as uuid } from 'uuid'
import {
  InvoiceTransactionRepository,
  InvoiceTransactionStatus,
} from '/opt/nodejs/invoiceTransactionLayer'
import { InvoiceWSService } from '/opt/nodejs/invoiceWSConnectionLayer'

AWSXRay.captureAWS(require('aws-sdk'))

const invoicesDdb = process.env.INVOICES_DDB!
const bucketName = process.env.BUCKET_NAME!
const invoiceWsApiEndpoint = process.env.INVOICE_WSAPI_ENDPOINT!.substring(6)

const s3Client = new S3()
const ddbClient = new DynamoDB.DocumentClient()
const apigwManagementApi = new ApiGatewayManagementApi({
  endpoint: invoiceWsApiEndpoint,
})
const invoiceTransactionRepository = new InvoiceTransactionRepository(
  ddbClient,
  invoicesDdb,
)
const invoiceWSService = new InvoiceWSService(apigwManagementApi)

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  console.log(event)

  const lambdaRequestId = context.awsRequestId
  const connectionId = event.requestContext.connectionId!

  console.log(
    `ConnectionId: ${connectionId} - Lambda RequestId: ${lambdaRequestId}`,
  )

  const key = uuid()
  const expires = 5 * 60

  const signedUrlPut = await s3Client.getSignedUrlPromise('putObject', {
    Bucket: bucketName,
    Key: key,
    Expires: expires,
  })

  const timestamp = Date.now()
  const ttl = Math.floor(timestamp / 1000 + 2 * 60)
  await invoiceTransactionRepository.createInvoiceTransaction({
    pk: '#transaction',
    sk: key,
    ttl: ttl,
    requestId: lambdaRequestId,
    transactionStatus: InvoiceTransactionStatus.GENERATED,
    timestamp,
    expiresIn: expires,
    connectionId,
    endpoint: invoiceWsApiEndpoint,
  })

  const postData = JSON.stringify({
    url: signedUrlPut,
    expires: expires,
    transactionId: key,
  })
  await invoiceWSService.sendData(connectionId, postData)

  return {
    statusCode: 200,
    body: 'OK',
  }
}
