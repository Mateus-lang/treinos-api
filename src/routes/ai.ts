import { openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  UIMessage,
} from "ai";
import { fromNodeHeaders } from "better-auth/node";
import { FastifyInstance } from "fastify";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import z from "zod";

import { WeekDay } from "../generated/prisma/enums.js";
import { auth } from "../lib/auth.js";
import { CreateWorkoutPlan } from "../usecases/CreateWorkoutPlan.js";
import { GetUserTrainData } from "../usecases/GetUserTrainData.js";
import { GetWorkoutPlans } from "../usecases/GetWorkoutPlans.js";
import { UpsertUserTrainData } from "../usecases/UpsertUserTrainData.js";

const SYSTEM_PROMPT = `Você é um personal trainer virtual especialista em montagem de planos de treino personalizados.

Tom: amigável, motivador, linguagem simples e direta. Seu público principal são pessoas leigas em musculação — evite jargões técnicos.

Respostas sempre curtas e objetivas.

## Regras obrigatórias

1. **SEMPRE** chame a tool \`getUserTrainData\` ANTES de qualquer interação com o usuário. Nunca responda sem antes consultar os dados.
2. Se o retorno for **null** (usuário sem dados cadastrados): pergunte em uma ÚNICA mensagem o nome, peso (kg), altura (cm), idade e percentual de gordura corporal. Perguntas simples e diretas. Após receber as respostas, salve com a tool \`updateUserTrainData\` (converta o peso de kg para gramas multiplicando por 1000).
3. Se o usuário **já tem dados cadastrados**: cumprimente-o pelo nome.
4. Para **criar um plano de treino**: pergunte o objetivo, quantos dias por semana ele pode treinar e se tem alguma restrição física ou lesão. Poucas perguntas, simples e diretas.

## Regras do plano de treino

- O plano DEVE ter exatamente **7 dias** (MONDAY, TUESDAY, WEDNESDAY, THURSDAY, FRIDAY, SATURDAY, SUNDAY).
- Dias sem treino: \`isRest: true\`, \`exercises: []\`, \`estimatedDurationInSeconds: 0\`.
- Use a tool \`createWorkoutPlan\` para criar o plano.

## Divisões de treino (splits) por dias disponíveis

- **2-3 dias/semana**: Full Body ou ABC (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas+Ombros)
- **4 dias/semana**: Upper/Lower (recomendado, cada grupo 2x/semana) ou ABCD (A: Peito+Tríceps, B: Costas+Bíceps, C: Pernas, D: Ombros+Abdômen)
- **5 dias/semana**: PPLUL — Push/Pull/Legs + Upper/Lower (superior 3x, inferior 2x/semana)
- **6 dias/semana**: PPL 2x — Push/Pull/Legs repetido

## Princípios de montagem

- Músculos sinérgicos juntos (peito+tríceps, costas+bíceps).
- Exercícios compostos primeiro, isoladores depois.
- 4 a 8 exercícios por sessão.
- 3-4 séries por exercício. 8-12 repetições para hipertrofia, 4-6 repetições para força.
- Descanso entre séries: 60-90 segundos (hipertrofia), 2-3 minutos (compostos pesados).
- Evitar treinar o mesmo grupo muscular em dias consecutivos.
- Nomes descritivos para cada dia (ex: "Superior A - Peito e Costas", "Descanso").

## Imagens de capa (coverImageUrl)

SEMPRE forneça um coverImageUrl para cada dia de treino. Escolha com base no foco muscular do dia:

**Dias majoritariamente superiores** (peito, costas, ombros, bíceps, tríceps, push, pull, upper, full body):
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO3y8pQ6GBg8iqe9pP2JrHjwd1nfKtVSQskI0v
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOW3fJmqZe4yoUcwvRPQa8kmFprzNiC30hqftL

**Dias majoritariamente inferiores** (pernas, glúteos, quadríceps, posterior, panturrilha, legs, lower):
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCOgCHaUgNGronCvXmSzAMs1N3KgLdE5yHT6Ykj
- https://gw8hy3fdcv.ufs.sh/f/ccoBDpLoAPCO85RVu3morROwZk5NPhs1jzH7X8TyEvLUCGxY

Alterne entre as duas opções de cada categoria para variar. Dias de descanso usam imagem de superior.`;

export const aiRoutes = async (app: FastifyInstance) => {
  app.withTypeProvider<ZodTypeProvider>().route({
    method: "POST",
    url: "/",
    schema: {
      tags: ["AI"],
      summary: "Chat com personal trainer virtual",
    },
    handler: async (request, reply) => {
      const session = await auth.api.getSession({
        headers: fromNodeHeaders(request.headers),
      });
      if (!session) {
        return reply.status(401).send({
          error: "Unauthorized",
          code: "UNAUTHORIZED",
        });
      }
      const { messages } = request.body as {
        messages: UIMessage[];
      };
      const userId = session.user.id;
      const result = streamText({
        model: openai("gpt-4o-mini"),
        system: SYSTEM_PROMPT,
        tools: {
          getUserTrainData: tool({
            description:
              "Busca os dados de treino do usuário (nome, peso, altura, idade, % gordura). Retorna null se não houver dados cadastrados.",
            inputSchema: z.object({}),
            execute: async () => {
              const getUserTrainData =
                new GetUserTrainData();
              return getUserTrainData.execute({ userId });
            },
          }),
          updateUserTrainData: tool({
            description:
              "Salva ou atualiza os dados de treino do usuário (peso em gramas, altura em cm, idade, % gordura).",
            inputSchema: z.object({
              weightInGrams: z
                .number()
                .describe("Peso do usuário em gramas"),
              heightInCentimeters: z
                .number()
                .describe(
                  "Altura do usuário em centímetros",
                ),
              age: z
                .number()
                .describe("Idade do usuário em anos"),
              bodyFatPercentage: z
                .number()
                .describe(
                  "Percentual de gordura corporal do usuário",
                ),
            }),
            execute: async (input) => {
              const upsertUserTrainData =
                new UpsertUserTrainData();
              return upsertUserTrainData.execute({
                userId,
                ...input,
              });
            },
          }),
          getWorkoutPlans: tool({
            description:
              "Lista todos os planos de treino do usuário.",
            inputSchema: z.object({}),
            execute: async () => {
              const getWorkoutPlans = new GetWorkoutPlans();
              return getWorkoutPlans.execute({ userId });
            },
          }),
          createWorkoutPlan: tool({
            description:
              "Cria um novo plano de treino completo com 7 dias (MONDAY a SUNDAY).",
            inputSchema: z.object({
              name: z
                .string()
                .describe("Nome do plano de treino"),
              workoutDays: z
                .array(
                  z.object({
                    name: z
                      .string()
                      .describe(
                        "Nome do dia (ex: Peito e Tríceps, Descanso)",
                      ),
                    weekDay: z
                      .enum(WeekDay)
                      .describe("Dia da semana"),
                    isRest: z
                      .boolean()
                      .describe(
                        "Se é dia de descanso (true) ou treino (false)",
                      ),
                    estimatedDurationInSeconds: z
                      .number()
                      .describe(
                        "Duração estimada em segundos (0 para dias de descanso)",
                      ),
                    coverImageUrl: z
                      .url()
                      .describe(
                        "URL da imagem de capa do dia de treino",
                      ),
                    exercises: z
                      .array(
                        z.object({
                          order: z
                            .number()
                            .describe(
                              "Ordem do exercício no dia",
                            ),
                          name: z
                            .string()
                            .describe("Nome do exercício"),
                          sets: z
                            .number()
                            .describe("Número de séries"),
                          reps: z
                            .number()
                            .describe(
                              "Número de repetições",
                            ),
                          weight: z
                            .number()
                            .describe(
                              "Carga em kg (0 para exercícios sem carga)",
                            ),
                          restTimeInSeconds: z
                            .number()
                            .describe(
                              "Tempo de descanso entre séries em segundos",
                            ),
                        }),
                      )
                      .describe(
                        "Lista de exercícios (vazia para dias de descanso)",
                      ),
                  }),
                )
                .describe(
                  "Array com exatamente 7 dias de treino (MONDAY a SUNDAY)",
                ),
            }),
            execute: async (input) => {
              const createWorkoutPlan =
                new CreateWorkoutPlan();
              return createWorkoutPlan.execute({
                userId,
                name: input.name,
                workoutDays: input.workoutDays,
              });
            },
          }),
        },
        stopWhen: stepCountIs(5),
        messages: await convertToModelMessages(messages),
      });
      const response = result.toUIMessageStreamResponse();
      reply.status(response.status);
      response.headers.forEach((value, key) =>
        reply.header(key, value),
      );

      return reply.send(response.body);
    },
  });
};
