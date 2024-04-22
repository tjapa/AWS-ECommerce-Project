import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as cdk from 'aws-cdk-lib'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'

export class ProductsAppLayersStack extends cdk.Stack {
  readonly productsLayer: lambda.LayerVersion

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    this.productsLayer = new lambda.LayerVersion(this, 'ProductsLayer', {
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      code: lambda.Code.fromAsset('lambda/products/layers/productsLayer'),
      layerVersionName: 'ProductsLayer',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    })

    new ssm.StringParameter(this, 'ProductsLayerVersionArn', {
      parameterName: 'ProductsLayerVersionArn',
      stringValue: this.productsLayer.layerVersionArn,
    })
  }
}
