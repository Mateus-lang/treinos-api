import { NotFoundError } from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
  workoutDayId: string;
  sessionId: string;
  completedAt: string;
}

interface OutputDto {
  id: string;
  completedAt: string;
  startedAt: string;
}

export class UpdateWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlan = await prisma.workoutPlan.findUnique(
      {
        where: { id: dto.workoutPlanId },
      },
    );

    if (!workoutPlan || workoutPlan.userId !== dto.userId) {
      throw new NotFoundError("Workout plan not found");
    }

    const workoutDay = await prisma.workoutDay.findUnique({
      where: { id: dto.workoutDayId },
    });

    if (
      !workoutDay ||
      workoutDay.workoutPlanId !== dto.workoutPlanId
    ) {
      throw new NotFoundError("Workout day not found");
    }

    const workoutSession =
      await prisma.workoutSession.findUnique({
        where: { id: dto.sessionId },
      });

    if (
      !workoutSession ||
      workoutSession.workoutDayId !== dto.workoutDayId
    ) {
      throw new NotFoundError("Workout session not found");
    }

    const updatedSession =
      await prisma.workoutSession.update({
        where: { id: dto.sessionId },
        data: {
          completedAt: new Date(dto.completedAt),
        },
      });

    return {
      id: updatedSession.id,
      completedAt:
        updatedSession.completedAt!.toISOString(),
      startedAt: updatedSession.startedAt.toISOString(),
    };
  }
}
