import { ClientConfig, Message, PubSub, Subscription, Topic } from '@google-cloud/pubsub'
import { PublishOptions } from '@google-cloud/pubsub/build/src/publisher'
import { SubscriberOptions } from '@google-cloud/pubsub/build/src/subscriber'
import { Observable } from 'rxjs'
import {
	CustomTransportStrategy,
	IncomingRequest,
	OutgoingResponse,
	Server,
} from '@nestjs/microservices'
import { Logger } from '@nestjs/common'
import { ERROR_EVENT, MESSAGE_EVENT, NO_MESSAGE_HANDLER } from '@nestjs/microservices/constants'
import { isString, isUndefined } from '@nestjs/common/utils/shared.utils'

import {
	GCD_ALREADY_EXISTS,
	GCD_CLIENT_CONFIG,
	GCD_NO_ACK,
	GCD_PUBLISHER_CONFIG,
	GCD_SUBSCRIBER_CONFIG,
	GCD_SUBSCRIPTION,
	GCD_TOPIC,
} from './constants'
import { GCPubSubOptions } from './interfaces'
import { PubsubContext } from './contexts'

export class GCPubSubServer extends Server implements CustomTransportStrategy {
	protected logger = new Logger(GCPubSubServer.name)

	protected readonly clientConfig: ClientConfig
	protected readonly topicName: string
	protected readonly publisherConfig: PublishOptions
	protected readonly subscriptionName: string
	protected readonly subscriberConfig: SubscriberOptions
	protected readonly noAck: boolean

	protected client: PubSub | null = null
	protected readonly topics: Map<string, Topic> = new Map()
	protected subscription: Subscription | null = null

	constructor(protected readonly options: GCPubSubOptions) {
		super()

		this.clientConfig = this.options.client || GCD_CLIENT_CONFIG
		this.topicName = this.options.topic || GCD_TOPIC
		this.subscriptionName = this.options.subscription || GCD_SUBSCRIPTION
		this.subscriberConfig = this.options.subscriber || GCD_SUBSCRIBER_CONFIG
		this.publisherConfig = this.options.publisher || GCD_PUBLISHER_CONFIG
		this.noAck = this.options.noAck || GCD_NO_ACK

		this.initializeSerializer(options)
		this.initializeDeserializer(options)
	}

	public async listen(callback: () => void) {
		this.client = this.createClient()
		const topic = this.client.topic(this.topicName)
		await this.createIfNotExists(topic.create.bind(topic))
		this.subscription = topic.subscription(this.subscriptionName, this.subscriberConfig)
		await this.createIfNotExists(this.subscription.create.bind(this.subscription))
		this.subscription
			.on(MESSAGE_EVENT, async (message: Message) => {
				await this.handleMessage(message)
				if (this.noAck) message.ack()
			})
			.on(ERROR_EVENT, (err: any) => this.logger.error(err))
		callback()
	}

	public async close() {
		this.subscription && (await this.subscription.close())
		await this.client.close()
	}

	public async handleMessage(message: Message) {
		const { data, attributes } = message
		const rawMessage = JSON.parse(data.toString())
		const packet = this.deserializer.deserialize(rawMessage)
		// @ts-ignore
		const pattern = isString(packet.pattern) ? packet.pattern : JSON.stringify(packet.pattern)
		const context = new PubsubContext([message, pattern])
		const correlationId = (packet as IncomingRequest).id
		// @ts-ignore
		if (isUndefined(correlationId)) return this.handleEvent(pattern, packet, context)
		const handler = this.getHandlerByPattern(pattern)
		if (!handler) {
			const status = 'error'
			const noHandlerPacket = { id: correlationId, status, err: NO_MESSAGE_HANDLER }
			return this.sendMessage(noHandlerPacket, attributes.replyTo, correlationId)
		}

		const response$ = this.transformToObservable(
			// @ts-ignore
			await handler(packet.data, context),
		) as Observable<any>
		const publish = <T>(data: T) => this.sendMessage(data, attributes.replyTo, correlationId)
		response$ && this.send(response$, publish)
	}

	public async sendMessage<T = any>(message: T, replyTo: string, id: string): Promise<void> {
		Object.assign(message, { id })
		const outgoingResponse = this.serializer.serialize(message as unknown as OutgoingResponse)
		await this.client.topic(replyTo, this.publisherConfig).publishJSON(outgoingResponse)
	}

	public async createIfNotExists(create: () => Promise<any>) {
		try {
			await create()
		} catch (error) {
			// @ts-ignore
			if (error.code !== GCD_ALREADY_EXISTS) throw error
		}
	}

	public createClient() {
		return new PubSub(this.clientConfig)
	}
}
