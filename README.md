## NestJS GCloud Pub/Sub Transporter
Pacote exclusivo para NestJS para gerenciar filas utilizando Google Pub/Sub
***
### Instalação
```bash
$ npm i --save @google-cloud/pubsub @prodevcom/nestjs-pubsub
```
### Configurando Cliente
```typescript
 const options: GCPubSubOptions = {
	topic: 'queue',
	subscription: 'queue-sub',
	client: {
		projectId: 'projeto-filas',
		keyFilename: './credentials.json'
	}
}
const pubsub = new GCPubSubClient(options)
```
#### Disparando um Evento
Para este caso, utilizamos o método `emit` pois vamos disparar um evento sem necessário esperar o retorno.
```typescript
const alterar = ({ id, body }) => pubsub.emit('alterar-produto', { id, body })
alterar(123, { nome: 'XBox Series X' })
```
#### Disparando uma Mensagem
Para este caso, vamos utilizar o método `send` pois necessitados de uma resposta para o cliente final
```typescript
return pubsub.send('ver-produto', { id: 123 })
```
***
### Configurando Servidor
```typescript
 const options: GCPubSubOptions = {
	topic: 'queue',
	subscription: 'queue-sub',
	client: {
		projectId: 'projeto-filas',
		keyFilename: './credentials.json'
	}
}
const app = await NestFactory.createMicroservice(ApplicationModule, {
  strategy: new GCPubSubServer(options),
});
```

#### Recebendo um evento do lado cliente

```typescript
@MessagePattern('alterar-produto')
update(@Payload() data: any, @Ctx() context: GCPubSubContext) {
	this.service.alterarProduto(data.id, data.body)
	context.ack() // Usar quando a opcão noAck for false
}
```

#### Recebendo uma mensagem do lado cliente

```typescript
@MessagePattern('ver-produto')
get(@Payload() data: any, @Ctx() context: GCPubSubContext) {
	try {
		return this.service.get(data.id)
	} finally {
		context.ack()
	}
}
```
***
#### Fonte de origem do código:
Credit
by [p-fedyukovich/nestjs-google-pubsub-microservice](https://github.com/p-fedyukovich/nestjs-google-pubsub-microservice)

_Este código segue os padrões fornecidos pelo seu pacote original, apenas contendo algumas alterações para atender os
padrões de projetos desenvolvidos internamente._
***

Não nos responsabilizados por bugs ou erros que possam acontecer ao utilizar esta biblioteca.

Dúvidas: [support@prodev.com.br](mailto:support@prodev.com.br)
