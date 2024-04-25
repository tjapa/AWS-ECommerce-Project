import { DocumentClient } from 'aws-sdk/clients/dynamodb'

export type OrderEventDdb = {
  pk: string
  sk: string
  ttl: number
  email: string
  createdAt: number
  requestId: string
  eventType: string
  info: {
    orderId: string
    productCodes: string[]
    messageId: string
  }
}

export class OrderEventRepository {
  private ddbClient: DocumentClient
  private eventsDdb: string

  constructor(ddbClient: DocumentClient, eventsDdb: string) {
    this.ddbClient = ddbClient
    this.eventsDdb = eventsDdb
  }

  async createdOrderEvent(orderEvent: OrderEventDdb) {
    return this.ddbClient
      .put({
        TableName: this.eventsDdb,
        Item: orderEvent,
      })
      .promise()
  }

  async getOrderEventsByEmail(email: string): Promise<OrderEventDdb[]> {
    const data = await this.ddbClient
      .query({
        TableName: this.eventsDdb,
        IndexName: 'emailIndex',
        KeyConditionExpression: 'email = :email AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':email': email,
          ':prefix': 'ORDER_',
        },
      })
      .promise()
    return (data?.Items as OrderEventDdb[]) ?? []
  }

  async getOrderEventsByEmailAndEventType(
    email: string,
    eventType: string,
  ): Promise<OrderEventDdb[]> {
    const data = await this.ddbClient
      .query({
        TableName: this.eventsDdb,
        IndexName: 'emailIndex',
        KeyConditionExpression: 'email = :email AND begins_with(sk, :prefix)',
        ExpressionAttributeValues: {
          ':email': email,
          ':prefix': eventType,
        },
      })
      .promise()
    return (data?.Items as OrderEventDdb[]) ?? []
  }
}
