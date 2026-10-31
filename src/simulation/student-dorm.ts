import type { Building } from '../types';

/** Student dormitories (2026-10-29, new cities). Students live in every district but every school is in 文澜学苑:
 * 58 of 64 students walked 1.4–3.7 km to class, the walk outweighed the pull of a lesson, and they studied about
 * 4% of the time — so the study grant paid per lesson minute hardly reached them (64 students, mean cash 77).
 * A declared city houses its students, in the same round-robin, in the DORM_HOME_COUNT homes nearest a school
 * instead; who they are, their district, their school (still the one nearest their home) and every rule of
 * study, grants, needs and walking are unchanged. Old saves and undeclared cities are untouched. */
export const STUDENT_DORM_POLICY = 'student-dorm-v1' as const;
export type StudentDormPolicy = typeof STUDENT_DORM_POLICY;
export const STUDENT_DORM_POLICIES: readonly StudentDormPolicy[] = [STUDENT_DORM_POLICY];
export const DORM_HOME_COUNT = 10;

/** The DORM_HOME_COUNT homes whose doors are nearest a school door (ties by id). */
export function dormHomes(homes: readonly Building[], schools: readonly Building[]): Building[] {
  if (!schools.length) return [];
  const near = (b: Building) => Math.min(...schools.map(s => Math.hypot(b.door.x - s.door.x, b.door.z - s.door.z)));
  return [...homes].sort((a, b) => near(a) - near(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, DORM_HOME_COUNT);
}

export function validateStudentDormPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'studentDormPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'studentDormPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !STUDENT_DORM_POLICIES.includes(data.studentDormPolicyId)
    || data.runtime.studentDormPolicyId !== data.studentDormPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：student dorm policy pair。');
}
