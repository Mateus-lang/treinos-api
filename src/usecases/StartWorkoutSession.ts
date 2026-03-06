import {
  ConflictError,
  NotFoundError,
  WorkoutPlanNotActiveError,
} from "../errors/index.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  workoutPlanId: string;
  workoutDayId: string;
}

interface OutputDto {
  userWorkoutSessionId: string;
}

export class StartWorkoutSession {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlan = await prisma.workoutPlan.findUnique(
      {
        where: { id: dto.workoutPlanId },
      },
    );

    if (!workoutPlan || workoutPlan.userId !== dto.userId) {
      throw new NotFoundError("Workout plan not found");
    }

    if (!workoutPlan.isActive) {
      throw new WorkoutPlanNotActiveError(
        "Workout plan is not active",
      );
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

    const existingSession =
      await prisma.workoutSession.findFirst({
        where: {
          workoutDayId: dto.workoutDayId,
          completedAt: null,
        },
      });

    if (existingSession) {
      throw new ConflictError(
        "A session for this day is already in progress",
      );
    }

    const session = await prisma.workoutSession.create({
      data: {
        workoutPlanId: dto.workoutPlanId,
        workoutDayId: dto.workoutDayId,
      },
    });

    return {
      userWorkoutSessionId: session.id,
    };
  }
}
