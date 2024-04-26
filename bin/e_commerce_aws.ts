#!/usr/bin/env node
import 'source-map-support/register'
import * as cdk from 'aws-cdk-lib'
import { ProductsAppStack } from '../lib/productsApp-stack'
import { EcommerceApiStack } from '../lib/ecommerceApi-stack'
import { ProductsAppLayersStack } from '../lib/productsAppLayers-stack'
import { EventsDdbStack } from '../lib/eventsDdb-stack'
import { OrdersAppLayersStack } from '../lib/ordersAppLayers-stack'
import { OrdersAppStack } from '../lib/ordersApp-stack'
import { InvoiceWSApiStack } from '../lib/invoiceWSApi-stack'
import { InvoicesAppLayersStack } from '../lib/invoicesAppLayers-stack'

const app = new cdk.App()

const env: cdk.Environment = {
  account: '913184983709',
  region: 'us-east-1',
}

const tags = {
  cost: 'ECommerce',
  team: 'TamaluCode',
}

const productsAppLayersStack = new ProductsAppLayersStack(
  app,
  'ProductAppsLayers',
  {
    tags,
    env,
  },
)

const eventsDdbStack = new EventsDdbStack(app, 'EventsDdb', {
  tags,
  env,
})

const productsAppStack = new ProductsAppStack(app, 'ProductsApp', {
  tags,
  env,
  eventsDdb: eventsDdbStack.table,
})
productsAppStack.addDependency(productsAppLayersStack)
productsAppStack.addDependency(eventsDdbStack)

const ordersAppLayerStack = new OrdersAppLayersStack(app, 'OrdersAppLayers', {
  tags,
  env,
})

const ordersAppStack = new OrdersAppStack(app, 'OrdersApp', {
  tags,
  env,
  productsDdb: productsAppStack.productsDdb,
  eventsDdb: eventsDdbStack.table,
})
ordersAppStack.addDependency(productsAppStack)
ordersAppStack.addDependency(ordersAppLayerStack)
ordersAppStack.addDependency(eventsDdbStack)

const invoiceAppLayersStack = new InvoicesAppLayersStack(
  app,
  'InvoiceAppLayers',
  {
    tags: {
      cost: 'InvoiceApp',
      team: 'TamaluCode',
    },
    env,
  },
)

const invoiceWSApiStack = new InvoiceWSApiStack(app, 'InvoiceApi', {
  tags: {
    cost: 'InvoiceApp',
    team: 'TamaluCode',
  },
  env,
})
invoiceWSApiStack.addDependency(invoiceAppLayersStack)

const ecommerceApiStack = new EcommerceApiStack(app, 'ECommerceApi', {
  productsFetchHandler: productsAppStack.productsFetchHandler,
  productsAdminHandler: productsAppStack.productsAdminHandler,
  ordersHandler: ordersAppStack.ordersHandler,
  orderEventsFetchHandler: ordersAppStack.ordersEventsFetchHandler,
  tags,
  env,
})
ecommerceApiStack.addDependency(productsAppStack)
ecommerceApiStack.addDependency(ordersAppStack)
