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
  from: string;
  to: string;
}

interface OutputDto {
  workoutStreak: number;
  consistencyByDay: Record<
    string,
    {
      workoutDayCompleted: boolean;
      workoutDayStarted: boolean;
    }
  >;
  completedWorkoutsCount: number;
  conclusionRate: number;
  totalTimeInSeconds: number;
}

export class GetStats {
  async execute(dto: InputDto): Promise<OutputDto> {
    const fromDate = dayjs.utc(dto.from).startOf("day");
    const toDate = dayjs.utc(dto.to).endOf("day");

    const workoutPlan = await prisma.workoutPlan.findFirst({
      where: {
        userId: dto.userId,
        isActive: true,
      },
      include: {
        workoutDays: true,
      },
    });

    if (!workoutPlan) {
      throw new NotFoundError(
        "Active workout plan not found",
      );
    }

    const sessions = await prisma.workoutSession.findMany({
      where: {
        workoutPlan: {
          userId: dto.userId,
        },
        startedAt: {
          gte: fromDate.toDate(),
          lte: toDate.toDate(),
        },
      },
    });

    // consistencyByDay: only days that have at least one session
    const sessionsByDate = new Map<
      string,
      typeof sessions
    >();

    for (const session of sessions) {
      const dateKey = dayjs
        .utc(session.startedAt)
        .format("YYYY-MM-DD");

      if (!sessionsByDate.has(dateKey)) {
        sessionsByDate.set(dateKey, []);
      }

      sessionsByDate.get(dateKey)!.push(session);
    }

    const consistencyByDay: OutputDto["consistencyByDay"] =
      {};

    for (const [dateKey, daySessions] of sessionsByDate) {
      consistencyByDay[dateKey] = {
        workoutDayStarted: true,
        workoutDayCompleted: daySessions.some(
          (s) => s.completedAt !== null,
        ),
      };
    }

    // completedWorkoutsCount
    const completedWorkoutsCount = sessions.filter(
      (s) => s.completedAt !== null,
    ).length;

    // conclusionRate
    const conclusionRate =
      sessions.length > 0
        ? completedWorkoutsCount / sessions.length
        : 0;

    // totalTimeInSeconds
    let totalTimeInSeconds = 0;

    for (const session of sessions) {
      if (session.completedAt) {
        const diff = dayjs
          .utc(session.completedAt)
          .diff(dayjs.utc(session.startedAt), "second");
        totalTimeInSeconds += diff;
      }
    }

    // workoutStreak
    const workoutStreak = await this.calculateStreak(
      dto.userId,
      dayjs.utc(dto.to),
      workoutPlan.workoutDays,
    );

    return {
      workoutStreak,
      consistencyByDay,
      completedWorkoutsCount,
      conclusionRate,
      totalTimeInSeconds,
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

      if (completedSession) {
        streak++;
      } else if (planWeekDays.has(dayOfWeek)) {
        break;
      }

      checkDate = checkDate.subtract(1, "day");
    }

    return streak;
  }
}
