import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda'
import { Product, ProductRepository } from '/opt/nodejs/productsLayer'
import { DynamoDB } from 'aws-sdk'

const productsDdb = process.env.PRODUCTS_DDB!
const ddbClient = new DynamoDB.DocumentClient()
const productRepository = new ProductRepository(ddbClient, productsDdb)

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  const lambdaRequestId = context.awsRequestId
  const apiRequestId = event.requestContext.requestId

  console.log(
    `API Gateway RequestId: ${apiRequestId} - Lambda RequestId: ${lambdaRequestId}`,
  )

  if (event.resource === '/products') {
    console.log('POST /products')
    const product: Product = JSON.parse(event.body!)
    const productCreated = await productRepository.create(product)
    return {
      statusCode: 201,
      body: JSON.stringify(productCreated),
    }
  } else if (event.resource === '/products/{id}') {
    const productId = event.pathParameters!.id as string
    const method = event.httpMethod
    if (method === 'PUT') {
      console.log(`PUT /products/${productId}`)
      try {
        const product: Product = JSON.parse(event.body!)
        const productUpdated = await productRepository.updateProduct(
          productId,
          product,
        )
        return {
          statusCode: 200,
          body: JSON.stringify(productUpdated),
        }
      } catch (ConditionalCheckFailedException) {
        return {
          statusCode: 404,
          body: 'Product not found',
        }
      }
    } else if (method === 'DELETE') {
      console.log(`DELETE /products/${productId}`)
      try {
        const productDeleted = await productRepository.deleteProduct(productId)
        return {
          statusCode: 200,
          body: JSON.stringify(productDeleted),
        }
      } catch (error) {
        console.error((<Error>error).message)
        return {
          statusCode: 404,
          body: (<Error>error).message,
        }
      }
    }
  }

  return {
    statusCode: 400,
    body: JSON.stringify({
      message: 'Bad request',
    }),
  }
}
