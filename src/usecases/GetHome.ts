import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

import { NotFoundError } from "../errors/index.js";
import { WeekDay } from "../generated/prisma/enums.js";
import { prisma } from "../lib/db.js";

dayjs.extend(utc);

const WEEKDAY_MAP: Record<number, WeekDay> = {
  0: "SUNDAY",
  1: "MONDAY",
  2: "TUESDAY",
  3: "WEDNESDAY",
  4: "THURSDAY",
  5: "FRIDAY",
  6: "SATURDAY",
};

interface InputDto {
  userId: string;
  date: string;
}

interface OutputDto {
  activeWorkoutPlanId: string;
  todayWorkoutDay: {
    workoutPlanId: string;
    id: string;
    name: string;
    isRest: boolean;
    weekDay: WeekDay;
    estimatedDurationInSeconds: number;
    coverImageUrl?: string;
    exercisesCount: number;
  };
  workoutStreak: number;
  consistencyByDay: Record<
    string,
    {
      workoutDayCompleted: boolean;
      workoutDayStarted: boolean;
    }
  >;
}

export class GetHome {
  async execute(dto: InputDto): Promise<OutputDto> {
    const currentDate = dayjs.utc(dto.date);
    const currentWeekDay = WEEKDAY_MAP[currentDate.day()];

    const workoutPlan = await prisma.workoutPlan.findFirst({
      where: {
        userId: dto.userId,
        isActive: true,
      },
      include: {
        workoutDays: {
          include: {
            exercises: true,
          },
        },
      },
    });

    if (!workoutPlan) {
      throw new NotFoundError(
        "Active workout plan not found",
      );
    }

    const todayWorkoutDay = workoutPlan.workoutDays.find(
      (day) => day.weekDay === currentWeekDay,
    );

    if (!todayWorkoutDay) {
      throw new NotFoundError(
        "Workout day not found for today",
      );
    }

    // Week range: Sunday 00:00:00 to Saturday 23:59:59 UTC
    const weekStart = currentDate
      .startOf("day")
      .subtract(currentDate.day(), "day");
    const weekEnd = weekStart.add(6, "day").endOf("day");

    const sessions = await prisma.workoutSession.findMany({
      where: {
        workoutPlan: {
          userId: dto.userId,
        },
        startedAt: {
          gte: weekStart.toDate(),
          lte: weekEnd.toDate(),
        },
      },
    });

    // Build consistencyByDay for all 7 days of the week
    const consistencyByDay: OutputDto["consistencyByDay"] =
      {};

    for (let i = 0; i < 7; i++) {
      const day = weekStart.add(i, "day");
      const dateKey = day.format("YYYY-MM-DD");

      const daySessions = sessions.filter((s) => {
        const sessionDate = dayjs
          .utc(s.startedAt)
          .format("YYYY-MM-DD");
        return sessionDate === dateKey;
      });

      const workoutDayStarted = daySessions.length > 0;
      const workoutDayCompleted = daySessions.some(
        (s) => s.completedAt !== null,
      );

      consistencyByDay[dateKey] = {
        workoutDayCompleted,
        workoutDayStarted,
      };
    }

    // Calculate workout streak
    const workoutStreak = await this.calculateStreak(
      dto.userId,
      currentDate,
      workoutPlan.workoutDays,
    );

    return {
      activeWorkoutPlanId: workoutPlan.id,
      todayWorkoutDay: {
        workoutPlanId: workoutPlan.id,
        id: todayWorkoutDay.id,
        name: todayWorkoutDay.name,
        isRest: todayWorkoutDay.isRest,
        weekDay: todayWorkoutDay.weekDay,
        estimatedDurationInSeconds:
          todayWorkoutDay.estimatedDurationInSeconds,
        coverImageUrl:
          todayWorkoutDay.coverImageUrl ?? undefined,
        exercisesCount: todayWorkoutDay.exercises.length,
      },
      workoutStreak,
      consistencyByDay,
    };
  }

  private async calculateStreak(
    userId: string,
    currentDate: dayjs.Dayjs,
    workoutDays: Array<{ weekDay: WeekDay }>,
  ): Promise<number> {
    const planWeekDays = new Set(
      workoutDays.map((d) => d.weekDay),
    );

    let streak = 0;
    let checkDate = currentDate;

    for (let i = 0; i < 365; i++) {
      const dayOfWeek = WEEKDAY_MAP[checkDate.day()];

      if (!planWeekDays.has(dayOfWeek)) {
        checkDate = checkDate.subtract(1, "day");
        continue;
      }

      const dayStart = checkDate.startOf("day");
      const dayEnd = checkDate.endOf("day");

      const completedSession =
        await prisma.workoutSession.findFirst({
          where: {
            workoutPlan: {
              userId,
            },
            startedAt: {
              gte: dayStart.toDate(),
              lte: dayEnd.toDate(),
            },
            completedAt: { not: null },
          },
        });

      if (!completedSession) {
        break;
      }

      streak++;
      checkDate = checkDate.subtract(1, "day");
    }

    return streak;
  }
}
