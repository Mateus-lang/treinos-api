
import "dotenv/config"

import { fastifySwagger } from '@fastify/swagger';
import { fastifySwaggerUi } from '@fastify/swagger-ui';
import Fastify from 'fastify'
import {
    jsonSchemaTransform,
    serializerCompiler,
    validatorCompiler,
    ZodTypeProvider,
} from 'fastify-type-provider-zod';
import z from "zod";

const app = Fastify({
    logger: true
})

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(fastifySwagger, {
    openapi: {
        info: {
            title: "Treinos API",
            description: "API para o app de Treinos",
            version: "1.0.0",
        },
        servers: [{
            description: "Local",
            url: "http://localhost:8080",
        }]
    },
    transform: jsonSchemaTransform,
});

await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
})

app.withTypeProvider<ZodTypeProvider>().route({
    method: 'GET',
    url: "/",
    schema: {
        description: "Hello World",
        tags: ["hello"],
        response: {
            200: z.object({
                message: z.string(),
            }),
        },
    },
    handler: () => {
        return { message: "Hello World" }
    },
})

try {
    await app.listen({ port: Number(process.env.PORT) || 8080 })
} catch (err) {
    app.log.error(err)
    process.exit(1)
}
