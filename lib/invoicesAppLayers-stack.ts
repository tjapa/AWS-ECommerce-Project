import * as cdk from 'aws-cdk-lib'
import { Construct } from 'constructs'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as ssm from 'aws-cdk-lib/aws-ssm'

export class InvoicesAppLayersStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const invoiceTransactionLayer = new lambda.LayerVersion(
      this,
      'InvoiceTransactionLayer',
      {
        compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
        code: lambda.Code.fromAsset(
          'lambda/invoices/layers/invoiceTransactionLayer',
        ),
        layerVersionName: 'InvoiceTransactionLayer',
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    )
    new ssm.StringParameter(this, 'InvoiceTransactionLayerVersionArn', {
      parameterName: 'InvoiceTransactionLayerVersionArn',
      stringValue: invoiceTransactionLayer.layerVersionArn,
    })

    const invoiceRepositoryLayer = new lambda.LayerVersion(
      this,
      'InvoiceRepositoryLayer',
      {
        compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
        code: lambda.Code.fromAsset(
          'lambda/invoices/layers/invoiceRepositoryLayer',
        ),
        layerVersionName: 'InvoiceRepositoryLayer',
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    )
    new ssm.StringParameter(this, 'InvoiceRepositoryLayerVersionArn', {
      parameterName: 'InvoiceRepositoryLayerVersionArn',
      stringValue: invoiceRepositoryLayer.layerVersionArn,
    })

    const invoiceWSConnectionLayer = new lambda.LayerVersion(
      this,
      'InvoiceWSConnectionLayer',
      {
        compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
        code: lambda.Code.fromAsset(
          'lambda/invoices/layers/invoiceWSConnectionLayer',
        ),
        layerVersionName: 'InvoiceWSConnectionLayer',
        removalPolicy: cdk.RemovalPolicy.RETAIN,
      },
    )
    new ssm.StringParameter(this, 'InvoiceWSConnectionLayerVersionArn', {
      parameterName: 'InvoiceWSConnectionLayerVersionArn',
      stringValue: invoiceWSConnectionLayer.layerVersionArn,
    })
  }
}
