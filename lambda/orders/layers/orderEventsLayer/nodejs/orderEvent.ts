export enum OrderEventType {
  CREATED = 'ORDER_CREATED',
  DELETED = 'ORDER_DELETED',
}

export type Envelope = {
  eventType: OrderEventType
  data: string
}

export type OrderEvent = {
  email: string
  orderId: string
  shipping: {
    type: string
    carrier: string
  }
  billing: {
    payment: string
    totalPrice: number
  }
  productCodes: string[]
  requestId: string
}
