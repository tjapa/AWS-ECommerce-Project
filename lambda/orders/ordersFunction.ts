import { DynamoDB } from 'aws-sdk'
import * as AWSXRay from 'aws-xray-sdk'
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda'
import { Order, OrderProduct, OrderRepository } from '/opt/nodejs/ordersLayer'
import { Product, ProductRepository } from '/opt/nodejs/productsLayer'
import {
  CarrierType,
  OrderProductResponse,
  OrderRequest,
  OrderResponse,
  PaymentType,
  ShippingType,
} from '/opt/nodejs/ordersApiLayer'

AWSXRay.captureAWS(require('aws-sdk'))

const productsDdb = process.env.PRODUCTS_DDB!
const ordersDdb = process.env.ORDERS_DDB!

const ddbClient = new DynamoDB.DocumentClient()
const orderRepository = new OrderRepository(ddbClient, ordersDdb)
const productRepository = new ProductRepository(ddbClient, productsDdb)

export async function handler(
  event: APIGatewayProxyEvent,
  context: Context,
): Promise<APIGatewayProxyResult> {
  const method = event.httpMethod
  const apiRequestId = event.requestContext.requestId
  const lambaRequestId = context.awsRequestId

  console.log(
    `API Gateway RequestId: ${apiRequestId} - LambdaRequestId: ${lambaRequestId}`,
  )

  if (!(event.resource === '/orders')) {
    return {
      statusCode: 400,
      body: 'Bad request',
    }
  }

  if (method === 'GET') {
    console.log('GET /orders')
    if (event.queryStringParameters) {
      const email = event.queryStringParameters!.email
      const orderId = event.queryStringParameters!.orderId
      if (email && orderId) {
        try {
          const order = await orderRepository.getOrder(email, orderId)
          const orderResponse = convertToOrderResponse(order)
          return {
            statusCode: 200,
            body: JSON.stringify(orderResponse),
          }
        } catch (error) {
          console.error((<Error>error).message)
          return {
            statusCode: 404,
            body: (<Error>error).message,
          }
        }
      } else if (email) {
        const orders = await orderRepository.getOrdersByEmail(email)
        const orderResponses = orders.map(convertToOrderResponse)
        return {
          statusCode: 200,
          body: JSON.stringify(orderResponses),
        }
      }
    } else {
      const orders = await orderRepository.getAllOrders()
      const orderResponses = orders.map(convertToOrderResponse)
      return {
        statusCode: 200,
        body: JSON.stringify(orderResponses),
      }
    }
  } else if (method === 'POST') {
    console.log('POST /orders')
    const orderRequest = JSON.parse(event.body!) as OrderRequest
    const products = await productRepository.getProductsByIds(
      orderRequest.productIds,
    )
    if (products.length !== orderRequest.productIds.length) {
      return {
        statusCode: 404,
        body: 'Some product was not found',
      }
    }
    const order = buildOrder(orderRequest, products)
    const orderCreated = await orderRepository.createOrder(order)
    const orderResponse = convertToOrderResponse(orderCreated)
    return {
      statusCode: 201,
      body: JSON.stringify(orderResponse),
    }
  } else if (method === 'DELETE') {
    try {
      console.log('DELETE /orders')
      const email = event.queryStringParameters!.email!
      const orderId = event.queryStringParameters!.orderId!
      const orderDeleted = await orderRepository.deleteOrder(email, orderId)
      const orderResponse = convertToOrderResponse(orderDeleted)
      return {
        statusCode: 200,
        body: JSON.stringify(orderResponse),
      }
    } catch (error) {
      console.error((<Error>error).message)
      return {
        statusCode: 404,
        body: (<Error>error).message,
      }
    }
  }

  return {
    statusCode: 400,
    body: 'Bad request',
  }
}

function buildOrder(orderRequest: OrderRequest, products: Product[]): Order {
  const orderProducts: OrderProductResponse[] = []
  let totalPrice = 0
  for (const product of products) {
    totalPrice += product.price
    orderProducts.push({
      code: product.code,
      price: product.price,
    })
  }

  const order: Order = {
    pk: orderRequest.email,
    billing: {
      payment: orderRequest.payment,
      totalPrice,
    },
    shipping: {
      type: orderRequest.shipping.type,
      carrier: orderRequest.shipping.carrier,
    },
    products: orderProducts,
  }

  return order
}

function convertToOrderResponse(order: Order): OrderResponse {
  const orderProducts: OrderProductResponse[] = order.products.map(
    (product) => ({
      code: product.code,
      price: product.price,
    }),
  )
  const orderResponse: OrderResponse = {
    email: order.pk,
    products: orderProducts,
    id: order.sk!,
    createdAt: order.createdAt!,
    billing: {
      payment: order.billing.payment as PaymentType,
      totalPrice: order.billing.totalPrice,
    },
    shipping: {
      type: order.shipping.type as ShippingType,
      carrier: order.shipping.carrier as CarrierType,
    },
  }

  return orderResponse
}
