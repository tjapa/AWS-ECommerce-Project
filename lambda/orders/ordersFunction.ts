import {
  CognitoIdentityServiceProvider,
  DynamoDB,
  EventBridge,
  SNS,
} from 'aws-sdk'
import * as AWSXRay from 'aws-xray-sdk'
import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from 'aws-lambda'
import { Order, OrderRepository } from '/opt/nodejs/ordersLayer'
import { Product, ProductRepository } from '/opt/nodejs/productsLayer'
import {
  CarrierType,
  OrderProductResponse,
  OrderRequest,
  OrderResponse,
  PaymentType,
  ShippingType,
} from '/opt/nodejs/ordersApiLayer'
import {
  OrderEvent,
  OrderEventType,
  Envelope,
} from '/opt/nodejs/orderEventsLayer'
import { v4 as uuid } from 'uuid'
import { AuthInfoService } from '/opt/nodejs/authUserInfoLayer'

AWSXRay.captureAWS(require('aws-sdk'))

const productsDdb = process.env.PRODUCTS_DDB!
const ordersDdb = process.env.ORDERS_DDB!
const orderEventsTopicArn = process.env.ORDER_EVENTS_TOPIC_ARN!
const auditBusName = process.env.AUDIT_BUS_NAME!

const ddbClient = new DynamoDB.DocumentClient()
const snsClient = new SNS()
const eventBridgeClient = new EventBridge()

const orderRepository = new OrderRepository(ddbClient, ordersDdb)
const productRepository = new ProductRepository(ddbClient, productsDdb)
const cognitoIdentityServiceProvicer = new CognitoIdentityServiceProvider()
const authInfoService = new AuthInfoService(cognitoIdentityServiceProvicer)

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

  const isAdmin = !authInfoService.isAdminUser(event.requestContext.authorizer)
  const authenticatedEmailUser = await authInfoService.getUserInfo(
    event.requestContext.authorizer,
  )

  if (method === 'GET') {
    console.log('GET /orders')
    if (event.queryStringParameters) {
      const email = event.queryStringParameters!.email
      const orderId = event.queryStringParameters!.orderId
      if (!isAdmin && authenticatedEmailUser !== email) {
        return {
          statusCode: 403,
          body: "You don't have permission to access this operation",
        }
      }
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
      if (!authInfoService.isAdminUser(event.requestContext.authorizer)) {
        return {
          statusCode: 403,
          body: "You don't have permission to access this operation",
        }
      }
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

    if (!isAdmin) {
      orderRequest.email = authenticatedEmailUser
    } else if (!orderRequest.email) {
      return {
        statusCode: 403,
        body: 'Missing the order owner email',
      }
    }

    const products = await productRepository.getProductsByIds(
      orderRequest.productIds,
    )
    if (products.length !== orderRequest.productIds.length) {
      console.error('Some product was not found')
      const result = await eventBridgeClient
        .putEvents({
          Entries: [
            {
              Source: 'app.order',
              EventBusName: auditBusName,
              DetailType: 'order',
              Time: new Date(),
              Detail: JSON.stringify({
                reason: 'PRODUCT_NOT_FOUND',
                orderRequest: orderRequest,
              }),
            },
          ],
        })
        .promise()
      console.log(result)
      return {
        statusCode: 404,
        body: 'Some product was not found',
      }
    }
    const order = buildOrder(orderRequest, products)
    const orderCreatedPromise = orderRepository.createOrder(order)
    const eventResultPromise = sendOrderEvent(
      order,
      OrderEventType.CREATED,
      lambaRequestId,
    )
    const [orderCreated, eventResult] = await Promise.all([
      orderCreatedPromise,
      eventResultPromise,
    ])
    console.log(
      `Order created event sent - OrderId: ${orderCreated.sk} - MessageId: ${eventResult.MessageId}`,
    )
    const orderResponse = convertToOrderResponse(orderCreated)
    return {
      statusCode: 201,
      body: JSON.stringify(orderResponse),
    }
  } else if (method === 'DELETE') {
    try {
      console.log('DELETE /orders')
      const email = event.queryStringParameters!.email!

      if (!isAdmin && authenticatedEmailUser !== email) {
        return {
          statusCode: 403,
          body: "You don't have permission to access this operation",
        }
      }

      const orderId = event.queryStringParameters!.orderId!
      const orderDeleted = await orderRepository.deleteOrder(email, orderId)
      const eventResult = await sendOrderEvent(
        orderDeleted,
        OrderEventType.DELETED,
        lambaRequestId,
      )
      console.log(
        `Order deleted event sent - OrderId: ${orderDeleted.sk} - MessageId: ${eventResult.MessageId}`,
      )
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
    sk: uuid(),
    createdAt: Date.now(),
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
  const orderProducts: OrderProductResponse[] | undefined = order.products?.map(
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

async function sendOrderEvent(
  order: Order,
  eventType: OrderEventType,
  lambdaRequestId: string,
) {
  const productCodes: string[] =
    order.products?.map((product) => product.code) ?? []
  const orderEvent: OrderEvent = {
    email: order.pk,
    orderId: order.sk!,
    billing: order.billing,
    shipping: order.shipping,
    requestId: lambdaRequestId,
    productCodes,
  }

  const envelope: Envelope = {
    eventType,
    data: JSON.stringify(orderEvent),
  }

  return snsClient
    .publish({
      TopicArn: orderEventsTopicArn,
      Message: JSON.stringify(envelope),
      MessageAttributes: {
        eventType: {
          DataType: 'String',
          StringValue: eventType,
        },
      },
    })
    .promise()
}
