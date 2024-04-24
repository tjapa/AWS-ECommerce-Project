export enum PaymentType {
  CASH = 'CASH',
  DEBIT_CARD = 'DEBIT_CARD',
  CREDIT_CARD = 'CREDIT_CARD',
}

export enum ShippingType {
  ECONOMIC = 'ECONOMIC',
  URGENT = 'URGENT',
}

export enum CarrierType {
  CORREIOS = 'CORREIOS',
  FEDEX = 'FEDEX',
}

export type OrderRequest = {
  email: string
  productIds: string[]
  payment: PaymentType
  shipping: {
    type: ShippingType
    carrier: CarrierType
  }
}

export type OrderProductResponse = {
  code: string
  price: number
}

export type OrderResponse = {
  email: string
  id: string
  createdAt: number
  billing: {
    payment: PaymentType
    totalPrice: number
  }
  shipping: {
    type: ShippingType
    carrier: CarrierType
  }
  products?: OrderProductResponse[]
}
