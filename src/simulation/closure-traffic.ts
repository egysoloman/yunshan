/** Road closures stop traffic only on the closed edge (2026-10-28, new cities). A vehicle drives
 * 1.3 m right of its edge's centreline, so where a closed deck reaches a shared junction a vehicle
 * waiting there in its own lane already stands on the closed deck, and the swept closure test
 * refused even its last 1.3 m to the node. In audit v9z4 a storm closed the market dock bridge
 * on day 2 and the vehicles coming up two roads into the market station stopped there for good:
 * by day 14, 160 road vehicles stood in the two queues, 55 of them food carriers (of 58), and the
 * seven residents who died had been riding in them. A sweep of
 * the 41 river-side edges a storm can close found each of them stopping vehicles on another open
 * road. In a declared city a road vehicle on an open edge follows that edge's own polyline and
 * another edge's closure cannot stop it. Vehicles on the closed edge still leave only by their
 * exit permit, departures never choose a closed edge, and walkers keep the swept test.
 * Old saves and undeclared cities keep stopping as before. */
export const CLOSURE_TRAFFIC_POLICY = 'closure-traffic-v1' as const;
export type ClosureTrafficPolicy = typeof CLOSURE_TRAFFIC_POLICY;
export const CLOSURE_TRAFFIC_POLICIES: readonly ClosureTrafficPolicy[] = [CLOSURE_TRAFFIC_POLICY];

/** Whether a vehicle's step must pass the swept closure test: always for an undeclared city,
 * otherwise only while the vehicle's own edge is closed. */
export function closureTestsVehicle(policy: ClosureTrafficPolicy | undefined, ownEdgeOpen: boolean): boolean {
  return policy !== CLOSURE_TRAFFIC_POLICY || !ownEdgeOpen;
}

export function validateClosureTrafficPolicy(data: Record<string, any>): void {
  const envelope = Object.hasOwn(data, 'closureTrafficPolicyId');
  const runtime = !!data.runtime && Object.hasOwn(data.runtime, 'closureTrafficPolicyId');
  if (!envelope && !runtime) return;
  if (!envelope || !runtime || !CLOSURE_TRAFFIC_POLICIES.includes(data.closureTrafficPolicyId)
    || data.runtime.closureTrafficPolicyId !== data.closureTrafficPolicyId
    || data.version !== 4 || data.motionVersion !== 2) throw new Error('无效存档字段：closure traffic policy pair。');
}
