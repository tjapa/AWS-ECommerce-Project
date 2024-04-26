import * as cdk from 'aws-cdk-lib'
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2'
import * as apigatewayv2Integration from 'aws-cdk-lib/aws-apigatewayv2-integrations'
import * as lambdaNodeJS from 'aws-cdk-lib/aws-lambda-nodejs'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import * as s3 from 'aws-cdk-lib/aws-s3'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as s3n from 'aws-cdk-lib/aws-s3-notifications'
import * as ssm from 'aws-cdk-lib/aws-ssm'
import { Construct } from 'constructs'

export class InvoiceWSApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const invoiceTransactionLayerArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        'InvoiceTransactionLayerVersionArn',
      )
    const invoiceTransactionLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'InvoiceTransactionLayerVersionArn',
      invoiceTransactionLayerArn,
    )

    const invoiceRepositoryLayerArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        'InvoiceRepositoryLayerVersionArn',
      )
    const invoiceRepositoryLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'InvoiceRepositoryLayerVersionArn',
      invoiceRepositoryLayerArn,
    )

    const invoiceWSConnectionLayerArn =
      ssm.StringParameter.valueForStringParameter(
        this,
        'InvoiceWSConnectionLayerVersionArn',
      )
    const invoiceWSConnectionLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      'InvoiceWSConnectionLayerVersionArn',
      invoiceWSConnectionLayerArn,
    )

    const invoicesDdb = new dynamodb.Table(this, 'InvoicesDdb', {
      tableName: 'invoices',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      partitionKey: {
        name: 'pk',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk',
        type: dynamodb.AttributeType.STRING,
      },
      timeToLiveAttribute: 'ttl',
      billingMode: dynamodb.BillingMode.PROVISIONED,
      readCapacity: 1,
      writeCapacity: 1,
    })

    const bucket = new s3.Bucket(this, 'InvoiceBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          enabled: true,
          expiration: cdk.Duration.days(1),
        },
      ],
    })

    const connectionHandler = new lambdaNodeJS.NodejsFunction(
      this,
      'InvoiceConnectionFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: 'InvoiceConnectionFunction',
        entry: 'lambda/invoices/invoiceConnectionFunction.ts',
        handler: 'handler',
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        tracing: lambda.Tracing.ACTIVE,
      },
    )

    const disconnectionHandler = new lambdaNodeJS.NodejsFunction(
      this,
      'InvoiceDisconnectionFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: 'InvoiceDisconnectionFunction',
        entry: 'lambda/invoices/invoiceDisconnectionFunction.ts',
        handler: 'handler',
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        tracing: lambda.Tracing.ACTIVE,
      },
    )

    const webSocketApi = new apigatewayv2.WebSocketApi(this, 'InvoicesWSApi', {
      apiName: 'InvoiceWSApi',
      connectRouteOptions: {
        integration: new apigatewayv2Integration.WebSocketLambdaIntegration(
          'ConnectionHandler',
          connectionHandler,
        ),
      },
      disconnectRouteOptions: {
        integration: new apigatewayv2Integration.WebSocketLambdaIntegration(
          'DisconnectionHandler',
          disconnectionHandler,
        ),
      },
    })

    const stage = 'prod'
    const wsApiEndpoint = `${webSocketApi.apiEndpoint}/${stage}`
    new apigatewayv2.WebSocketStage(this, 'InvoiceWSApiStage', {
      webSocketApi: webSocketApi,
      stageName: stage,
      autoDeploy: true,
    })

    const getUrlHandler = new lambdaNodeJS.NodejsFunction(
      this,
      'InvoiceGetUrlFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: 'InvoiceGetUrlFunction',
        entry: 'lambda/invoices/invoiceGetUrlFunction.ts',
        handler: 'handler',
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        environment: {
          INVOICES_DDB: invoicesDdb.tableName,
          BUCKET_NAME: bucket.bucketName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
        },
        layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
      },
    )
    const invoicesDdbWriteTransactionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:PutItem'],
      resources: [invoicesDdb.tableArn],
      conditions: {
        ['ForAllValues:StringLike']: {
          'dynamodb:LeadingKeys': ['#transaction'],
        },
      },
    })
    getUrlHandler.addToRolePolicy(invoicesDdbWriteTransactionPolicy)
    const invoicesBucketPutObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject'],
      resources: [`${bucket.bucketArn}/*`],
    })
    getUrlHandler.addToRolePolicy(invoicesBucketPutObjectPolicy)
    webSocketApi.grantManageConnections(getUrlHandler)

    const invoiceImportHandler = new lambdaNodeJS.NodejsFunction(
      this,
      'InvoiceImportFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: 'InvoiceImportFunction',
        entry: 'lambda/invoices/invoiceImportFunction.ts',
        handler: 'handler',
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        environment: {
          INVOICES_DDB: invoicesDdb.tableName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
        },
        layers: [
          invoiceTransactionLayer,
          invoiceRepositoryLayer,
          invoiceWSConnectionLayer,
        ],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
      },
    )
    invoicesDdb.grantReadWriteData(invoiceImportHandler)
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED_PUT,
      new s3n.LambdaDestination(invoiceImportHandler),
    )
    const invoicesBucketGetDeleteObjectPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:DeleteObject'],
      resources: [`${bucket.bucketArn}/*`],
    })
    invoiceImportHandler.addToRolePolicy(invoicesBucketGetDeleteObjectPolicy)
    webSocketApi.grantManageConnections(invoiceImportHandler)

    const cancelImportHandler = new lambdaNodeJS.NodejsFunction(
      this,
      'CancelImportFunction',
      {
        runtime: lambda.Runtime.NODEJS_20_X,
        functionName: 'CancelImportFunction',
        entry: 'lambda/invoices/cancelImportFunction.ts',
        handler: 'handler',
        memorySize: 512,
        timeout: cdk.Duration.seconds(2),
        bundling: {
          minify: true,
          sourceMap: false,
        },
        environment: {
          INVOICES_DDB: invoicesDdb.tableName,
          INVOICE_WSAPI_ENDPOINT: wsApiEndpoint,
        },
        layers: [invoiceTransactionLayer, invoiceWSConnectionLayer],
        tracing: lambda.Tracing.ACTIVE,
        insightsVersion: lambda.LambdaInsightsVersion.VERSION_1_0_229_0,
      },
    )
    const invoicesDdbGetUpdateTransactionPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
      resources: [invoicesDdb.tableArn],
      conditions: {
        ['ForAllValues:StringLike']: {
          'dynamodb:LeadingKeys': ['#transaction'],
        },
      },
    })
    cancelImportHandler.addToRolePolicy(invoicesDdbGetUpdateTransactionPolicy)
    webSocketApi.grantManageConnections(cancelImportHandler)

    webSocketApi.addRoute('getImportUrl', {
      integration: new apigatewayv2Integration.WebSocketLambdaIntegration(
        'GetUrlHandler',
        getUrlHandler,
      ),
    })
    webSocketApi.addRoute('cancelImport', {
      integration: new apigatewayv2Integration.WebSocketLambdaIntegration(
        'CancelImportHandler',
        cancelImportHandler,
      ),
    })
  }
}
