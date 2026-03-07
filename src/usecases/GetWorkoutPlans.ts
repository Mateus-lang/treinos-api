import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

interface InputDto {
  userId: string;
  active?: boolean;
}

interface OutputDto {
  workoutPlans: Array<{
    id: string;
    name: string;
    isActive: boolean;
    workoutDays: Array<{
      id: string;
      name: string;
      weekDay: WeekDay;
      isRest: boolean;
      coverImageUrl?: string;
      estimatedDurationInSeconds: number;
      exercises: Array<{
        id: string;
        name: string;
        order: number;
        workoutDayId: string;
        sets: number;
        reps: number;
        restTimeInSeconds: number;
        weight: number;
      }>;
    }>;
  }>;
}

export class GetWorkoutPlans {
  async execute(dto: InputDto): Promise<OutputDto> {
    const workoutPlans = await prisma.workoutPlan.findMany({
      where: {
        userId: dto.userId,
        ...(dto.active !== undefined && {
          isActive: dto.active,
        }),
      },
      include: {
        workoutDays: {
          include: {
            exercises: true,
          },
        },
      },
    });

    return {
      workoutPlans: workoutPlans.map((plan) => ({
        id: plan.id,
        name: plan.name,
        isActive: plan.isActive,
        workoutDays: plan.workoutDays.map((day) => ({
          id: day.id,
          name: day.name,
          weekDay: day.weekDay,
          isRest: day.isRest,
          coverImageUrl: day.coverImageUrl ?? undefined,
          estimatedDurationInSeconds:
            day.estimatedDurationInSeconds,
          exercises: day.exercises.map((exercise) => ({
            id: exercise.id,
            name: exercise.name,
            order: exercise.order,
            workoutDayId: exercise.workoutDayId,
            sets: exercise.sets,
            reps: exercise.reps,
            restTimeInSeconds: exercise.restTimeInSeconds,
            weight: exercise.weight,
          })),
        })),
      })),
    };
  }
}
