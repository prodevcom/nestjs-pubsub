import { ClientConfig, Message, PubSub, Subscription, Topic } from '@google-cloud/pubsub'
import { PublishOptions } from '@google-cloud/pubsub/build/src/publisher'
import { SubscriberOptions } from '@google-cloud/pubsub/build/src/subscriber'
import { ClientProxy, ReadPacket, WritePacket } from '@nestjs/microservices'
import { ERROR_EVENT, MESSAGE_EVENT } from '@nestjs/microservices/constants'
import { Logger } from '@nestjs/common'

import {
	GCD_ALREADY_EXISTS,
	GCD_CLIENT_CONFIG,
	GCD_NO_ACK,
	GCD_PUBLISHER_CONFIG,
	GCD_REPLY_SUBSCRIPTION,
	GCD_REPLY_TOPIC,
	GCD_SUBSCRIBER_CONFIG,
	GCD_TOPIC,
} from './constants'
import { GCPubSubOptions } from './interfaces'

export class GCPubSubClient extends ClientProxy {
	protected readonly logger = new Logger(GCPubSubClient.name)

	protected readonly topicName: string
	protected readonly publisherConfig: PublishOptions
	protected readonly replyTopicName: string
	protected readonly clientConfig: ClientConfig
	protected readonly replySubscriptionName: string
	protected readonly subscriberConfig: SubscriberOptions
	protected readonly noAck: boolean

	protected client: PubSub | null = null
	protected replySubscription: Subscription | null = null
	protected topic: Topic | null = null

	constructor(protected readonly options: GCPubSubOptions) {
		super()

		this.clientConfig = this.options.client || GCD_CLIENT_CONFIG
		this.topicName = this.options.topic || GCD_TOPIC
		this.subscriberConfig = this.options.subscriber || GCD_SUBSCRIBER_CONFIG
		this.publisherConfig = this.options.publisher || GCD_PUBLISHER_CONFIG
		this.replyTopicName = this.options.replyTopic || GCD_REPLY_TOPIC
		this.replySubscriptionName = this.options.replySubscription || GCD_REPLY_SUBSCRIPTION
		this.noAck = this.options.noAck || GCD_NO_ACK

		this.initializeSerializer(options)
		this.initializeDeserializer(options)
	}

	public async close(): Promise<void> {
		this.replySubscription && (await this.replySubscription.close())
		this.client && (await this.client.close())
		this.client = null
		this.topic = null
		this.replySubscription = null
	}

	async connect(): Promise<PubSub> {
		if (this.client) return this.client
		this.client = this.createClient()
		this.topic = this.client.topic(this.topicName, this.publisherConfig)
		const replyTopic = this.client.topic(this.replyTopicName)
		await this.createIfNotExists(replyTopic.create.bind(replyTopic))
		this.replySubscription = replyTopic.subscription(
			this.replySubscriptionName,
			this.subscriberConfig
		)
		await this.createIfNotExists(this.replySubscription.create.bind(this.replySubscription))
		this.replySubscription
			.on(MESSAGE_EVENT, async (message: Message) => {
				await this.handleResponse(message.data)
				if (this.noAck) message.ack()
			})
			.on(ERROR_EVENT, (err: any) => this.logger.error(err))
		return this.client
	}

	public createClient(): PubSub {
		return new PubSub(this.clientConfig)
	}

	protected async dispatchEvent(packet: ReadPacket): Promise<any> {
		const pattern = this.normalizePattern(packet.pattern)
		const serializedPacket = this.serializer.serialize({ ...packet, pattern })
		if (this.topic) await this.topic.publishJSON(serializedPacket)
	}

	protected publish(partialPacket: ReadPacket, callback: (packet: WritePacket) => void): any {
		try {
			const packet = this.assignPacketId(partialPacket)
			const serializedPacket = this.serializer.serialize(packet)
			this.routingMap.set(packet.id, callback)
			if (this.topic) {
				this.topic
					.publishJSON(serializedPacket, {
						replyTo: this.replyTopicName,
					})
					.catch((err) => callback({ err }))
			} else {
				callback({ err: new Error('Topic is not created') })
			}

			return () => this.routingMap.delete(packet.id)
		} catch (err) {
			callback({ err })
		}
	}

	public async handleResponse(data: Buffer) {
		const rawMessage = JSON.parse(data.toString())
		// @ts-ignore
		const { err, response, isDisposed, id } = this.deserializer.deserialize(rawMessage)
		const callback = this.routingMap.get(id)
		if (!callback) return
		if (err || isDisposed) return callback({ err, response, isDisposed })
		callback({ err, response })
	}

	public async createIfNotExists(create: () => Promise<any>) {
		try {
			await create()
		} catch (error) {
			// @ts-ignore
			if (error.code !== GCD_ALREADY_EXISTS) throw error
		}
	}
}
