// Port of the walking core of src/controller.ts (PlayerController): the
// player's body on authoritative surfaces, doors, stairs, floor permissions,
// market counters, guard rails and placed voxels. Camera and input handling
// stay in the engine layer; yaw/pitch keep the web (three.js) convention:
// forward is (-sin yaw, 0, -cos yaw) in game space, positive pitch looks up.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public sealed class PlayerWalker
    {
        public const double EyeHeight = 1.72, BodyRadius = .35;

        readonly WorldDefinition world;
        readonly List<MarketCounter> marketCounters;
        readonly Func<Building, int, bool> canAccess;
        readonly Func<IReadOnlyList<Vec3>> modifications;
        readonly Func<Vec3, Vec3, bool> mayWalkTo;
        Vec3 feet;
        Building supportingSite;

        public string Mode = "walk";
        public double Yaw, Pitch = -.35;
        public Building Inside;
        public int Floor;
        /// <summary>Last refusal message (permissions, closed road); the host UI clears it.</summary>
        public string BlockedAccess;
        public Vec3 Feet => feet.Copy();

        /// <param name="canAccess">Access.CanAccessFloor for the player's identities.</param>
        /// <param name="modifications">Positions of placed 0.2 m voxels.</param>
        /// <param name="mayWalkTo">Road-closure permission (roads.ts roadMovementAllowed); null allows all.</param>
        public PlayerWalker(WorldDefinition world, Func<Building, int, bool> canAccess = null, Func<IReadOnlyList<Vec3>> modifications = null, Func<Vec3, Vec3, bool> mayWalkTo = null)
        {
            this.world = world;
            this.canAccess = canAccess ?? ((_, __) => true);
            this.modifications = modifications ?? (() => Array.Empty<Vec3>());
            this.mayWalkTo = mayWalkTo ?? ((_, __) => true);
            marketCounters = world.Buildings.SelectMany(b => SiteFixtures.MarketCounters(world, b)).ToList();
            feet = world.Spawn.Copy();
            SetWalk(world.Spawn);
        }

        static double Clamp(double v, double min, double max) => JsMath.Max(min, JsMath.Min(max, v));
        static double Distance2(Vec3 a, Vec3 b) => JsMath.Hypot(a.X - b.X, a.Z - b.Z);

        /// <summary>setMode('walk', position): finds the room or site supporting the body.</summary>
        public void SetWalk(Vec3 playerPosition)
        {
            Mode = "walk"; Floor = 0; Inside = null; supportingSite = null;
            feet = playerPosition.Copy();
            Building room = null;
            foreach (var building in world.Buildings)
            {
                int floor = (int)JsMath.Round((feet.Y - building.Position.Y - .6) / (building.Height / building.Floors));
                if (ArchitectureFloorPlan.GetBuildingBody(building) != null)
                {
                    var support = ArchitectureFloorPlan.FloorPlanSupport(building, floor, feet, BodyRadius) ?? ArchitectureFloorPlan.GetFloorPlanRoofSupport(building, feet, BodyRadius);
                    if (support == null || Math.Abs(support.Y - feet.Y) >= 1.5) continue;
                    supportingSite = building; Floor = support.Floor;
                    if (support.Kind == "room" || support.Kind == "stairs") { room = building; break; }
                    continue;
                }
                if (floor < -(building.Basements ?? 0) || floor >= building.Floors) continue;
                var size = Access.GetFloorDimensions(building, floor);
                if (Math.Abs(feet.X - building.Position.X) < size.Width / 2 - BodyRadius && Math.Abs(feet.Z - building.Position.Z) < size.Depth / 2 - BodyRadius
                    && Math.Abs(feet.Y - (building.Position.Y + .6 + floor * building.Height / building.Floors)) < 1.5) { room = building; break; }
            }
            if (room != null)
            {
                Inside = room;
                if (ArchitectureFloorPlan.GetBuildingBody(room) == null)
                {
                    double level = JsMath.Round((feet.Y - room.Position.Y - .6) / (room.Height / room.Floors));
                    Floor = level == 0 ? 0 : (int)level;
                }
            }
            Pitch = -.05;
        }

        /// <summary>Body follows a vehicle; it is no longer inside any building.</summary>
        public void SyncPassenger(Vec3 position) { feet = position.Copy(); Inside = null; supportingSite = null; }

        /// <summary>Aircraft carry the body (feet 0.3 m above the craft).</summary>
        public void SyncAircraft(Vec3 craft) { feet = new Vec3(craft.X, craft.Y + .3, craft.Z); Inside = null; supportingSite = null; Floor = 0; }

        /// <summary>Door use crosses only the existing opening; doors do not teleport between buildings.</summary>
        public bool UseDoor(Building building)
        {
            if (Mode != "walk" || Distance2(feet, building.Door) > 6) return false;
            if (ArchitectureFloorPlan.GetBuildingBody(building) != null)
            {
                var support = ArchitectureFloorPlan.FloorPlanSupport(building, 0, feet, 0);
                bool isInside = support != null && (support.Kind == "room" || support.Kind == "stairs");
                if (!isInside && !canAccess(building, 0)) { BlockedAccess = $"{building.Name}需要相应权限。"; return false; }
                var local = ArchitectureFloorPlan.BuildingLocalPosition(building, ArchitectureFloorPlan.GetBuildingEntrance(building));
                var next = ArchitectureFloorPlan.BuildingWorldPosition(building, new Vec3(local.X, local.Y, local.Z + (isInside ? 2 : -2)));
                if (ArchitectureFloorPlan.BlocksFloorPlanMovement(building, 0, feet, next, BodyRadius, EyeHeight)) return false;
                if (!MayWalkTo(next)) return false;
                feet = next; Floor = 0; supportingSite = isInside ? null : building; Inside = isInside ? null : building;
                Yaw = building.Rotation + (isInside ? Math.PI : 0); Pitch = 0; return true;
            }
            bool inside = Contains(building, feet, 0);
            if (!inside && !canAccess(building, 0)) { BlockedAccess = $"{building.Name}的核心区域需要相应权限。公共政务大厅始终开放。"; return false; }
            var target = new Vec3(building.Door.X, building.Position.Y + .6, building.Door.Z + (inside ? 2 : -2));
            if (!MayWalkTo(target)) return false;
            feet = target; Floor = 0; Inside = inside ? null : building;
            Yaw = inside ? Math.PI : 0; Pitch = 0; return true;
        }

        public bool UseStairs()
        {
            if (Inside == null || Inside.Floors + (Inside.Basements ?? 0) < 2) return false;
            var b = Inside;
            var stair = Access.GetStairPosition(b, Floor);
            bool profiled = ArchitectureFloorPlan.GetBuildingBody(b) != null;
            var relative = profiled ? ArchitectureFloorPlan.BuildingLocalPosition(b, feet) : feet;
            var trigger = profiled ? ArchitectureFloorPlan.BuildingLocalPosition(b, stair) : stair;
            if (Math.Abs(relative.X - trigger.X) > 3 || Math.Abs(relative.Z - trigger.Z) > 5) return false;
            int basements = b.Basements ?? 0;
            var floors = Enumerable.Range(0, b.Floors + basements).Select(i => i - basements).ToList();
            int current = floors.IndexOf(Floor);
            var order = floors.Skip(current + 1).Concat(floors.Take(current + 1));
            int? next = null;
            foreach (var floor in order) if (floor != Floor && canAccess(b, floor)) { next = floor; break; }
            if (next == null) { BlockedAccess = "此处其他楼层需要相应权限。"; return false; }
            Floor = next.Value;
            double floorHeight = b.Height / b.Floors;
            if (profiled) feet = ArchitectureFloorPlan.GetFloorPlanStairPosition(b, Floor);
            else feet = new Vec3(feet.X, b.Position.Y + .6 + Floor * floorHeight, feet.Z);
            return true;
        }

        /// <summary>One walking step (the web clamps dt to 0.1 s and replays in ≤1/30 s slices).</summary>
        public void Step(double seconds, double forward, double strafe, bool sprint, bool passenger)
        {
            double dt = JsMath.Min(seconds, .1);
            if (passenger || Mode != "walk") return;
            double length = JsMath.Hypot(forward, strafe);
            if (length > 1) { forward /= length; strafe /= length; }
            double speed = sprint ? 10 : 4.8;
            double dx = (-JsMath.Sin(Yaw) * forward + JsMath.Cos(Yaw) * strafe) * speed * dt;
            double dz = (-JsMath.Cos(Yaw) * forward - JsMath.Sin(Yaw) * strafe) * speed * dt;
            WalkTo(feet.X + dx, feet.Z);
            WalkTo(feet.X, feet.Z + dz);
        }

        void WalkTo(double x, double z)
        {
            bool near = false;
            foreach (var b in world.Buildings)
            {
                if (ArchitectureFloorPlan.GetBuildingBody(b) == null) continue;
                var p = ArchitectureFloorPlan.BuildingLocalPosition(b, new Vec3(x, feet.Y, z)); var a = ArchitectureFloorPlan.BuildingLocalPosition(b, feet);
                if (Math.Abs(p.X) <= b.Width / 2 + 2 && Math.Abs(p.Z) <= b.Depth / 2 + 2 || Math.Abs(a.X) <= b.Width / 2 + 2 && Math.Abs(a.Z) <= b.Depth / 2 + 2) { near = true; break; }
            }
            if (!near) { WalkToLegacy(x, z); return; }
            var from = feet.Copy();
            int steps = (int)JsMath.Max(1, Math.Ceiling(JsMath.Hypot(x - from.X, z - from.Z) / .1));
            for (int i = 1; i <= steps; i++) if (!WalkFloorPlan(from.X + (x - from.X) * i / steps, from.Z + (z - from.Z) * i / steps)) break;
        }

        FloorSupport GroundEdgeSupport(Building b, FloorPlan plan, Vec3 position, FloorSupport center)
        {
            if (plan.Floor != 0 || center == null || (center.Kind != "courtyard" && center.Kind != "gallery")) return null;
            var local = ArchitectureFloorPlan.BuildingLocalPosition(b, position); var stone = ArchitectureFloorPlan.GetFloorPlanSlabRegions(plan);
            double x0 = JsMath.Min(stone.Select(r => r.X0).ToArray()), x1 = JsMath.Max(stone.Select(r => r.X1).ToArray()), z0 = JsMath.Min(stone.Select(r => r.Z0).ToArray()), z1 = JsMath.Max(stone.Select(r => r.Z1).ToArray());
            if (JsMath.Min(local.X - x0, x1 - local.X, local.Z - z0, z1 - local.Z) >= BodyRadius) return null;
            bool Outside(double x, double z) => x < x0 - 1e-7 || x > x1 + 1e-7 || z < z0 - 1e-7 || z > z1 + 1e-7;
            for (double ix = Math.Floor((local.X - BodyRadius) / .2); ix <= Math.Floor((local.X + BodyRadius) / .2); ix++)
                for (double iz = Math.Floor((local.Z - BodyRadius) / .2); iz <= Math.Floor((local.Z + BodyRadius) / .2); iz++)
                {
                    double cx = ix * .2, cz = iz * .2;
                    double ex = JsMath.Max(cx - local.X, 0, local.X - cx - .2), ez = JsMath.Max(cz - local.Z, 0, local.Z - cz - .2);
                    if (ex * ex + ez * ez > BodyRadius * BodyRadius + 1e-7) continue;
                    foreach (var (px, pz) in new[] { (cx, cz), (cx + .2, cz), (cx, cz + .2), (cx + .2, cz + .2), (cx + .1, cz + .1) })
                    {
                        if (!Outside(px, pz)) continue;
                        var point = ArchitectureFloorPlan.BuildingWorldPosition(b, new Vec3(px, plan.Y, pz));
                        double height = World.GetWalkHeight(world, point.X, point.Z, center.Y);
                        if (!double.IsFinite(height) || Math.Abs(height - center.Y) > 2.6 + 1e-7) return null;
                    }
                }
            double range = .6, loX = local.X - range, hiX = local.X + range, loZ = local.Z - range, hiZ = local.Z + range;
            var terrain = new[] { new Rect(loX, x0, loZ, hiZ), new Rect(x1, hiX, loZ, hiZ), new Rect(loX, hiX, loZ, z0), new Rect(loX, hiX, z1, hiZ) }.Where(r => r.X1 > r.X0 && r.Z1 > r.Z0);
            foreach (var loop in ArchitectureFloorPlan.BoundaryLoops(stone.Concat(terrain).ToList()))
                for (int i = 0; i < loop.Count; i++)
                {
                    var a = loop[i]; var to = loop[(i + 1) % loop.Count];
                    double dx = to.X - a.X, dz = to.Z - a.Z, t = JsMath.Max(0, JsMath.Min(1, ((local.X - a.X) * dx + (local.Z - a.Z) * dz) / (dx * dx + dz * dz)));
                    double ox = local.X - a.X - t * dx, oz = local.Z - a.Z - t * dz;
                    if (ox * ox + oz * oz < BodyRadius * BodyRadius - 1e-7) return null;
                }
            return center;
        }

        bool WalkFloorPlan(double x, double z)
        {
            double limit = world.Size / 2 - 8; x = Clamp(x, -limit, limit); z = Clamp(z, -limit, limit);
            var candidate = new Vec3(x, feet.Y, z);
            if (SiteFixtures.BlocksMarketCounter(marketCounters, feet, candidate, BodyRadius, EyeHeight) || (Inside == null && TransportGeometry.BlocksTransportBarrier(world, feet, candidate, BodyRadius))) return false;
            Building occupied = null, site = null; int nextFloor = 0; double height = World.GetWalkHeight(world, x, z, feet.Y);
            foreach (var b in world.Buildings)
            {
                if (ArchitectureFloorPlan.GetBuildingBody(b) == null) continue;
                var local = ArchitectureFloorPlan.BuildingLocalPosition(b, candidate); var a = ArchitectureFloorPlan.BuildingLocalPosition(b, feet);
                if (Math.Abs(local.X) > b.Width / 2 + 2 || Math.Abs(local.Z) > b.Depth / 2 + 2) { if (b != supportingSite) continue; }
                int floor = b == supportingSite || b == Inside ? Floor : (int)JsMath.Round((feet.Y - b.Position.Y - .6) / (b.Height / b.Floors));
                var plan = ArchitectureFloorPlan.GetBuildingFloorPlan(b, floor); if (plan == null) continue;
                var support = ArchitectureFloorPlan.FloorPlanSupport(b, floor, candidate, BodyRadius); var center = ArchitectureFloorPlan.FloorPlanSupport(b, floor, candidate, 0);
                var walkable = new List<Rect>(plan.Interior); walkable.AddRange(plan.Circulation); walkable.AddRange(plan.Courtyard);
                bool within = ArchitectureFloorPlan.ContainsUnion(walkable, local.X, local.Z);
                var entrance = ArchitectureFloorPlan.BuildingLocalPosition(b, ArchitectureFloorPlan.GetBuildingEntrance(b));
                var opening = plan.Walls.FirstOrDefault(w => w.Opening?.Use == "entrance")?.Opening;
                bool doorEdge = floor == 0 && opening != null && Math.Abs(local.Z - entrance.Z) <= BodyRadius + .21 && Math.Abs(local.X - entrance.X) < (opening.To - opening.From) / 2 - BodyRadius;
                var roof = ArchitectureFloorPlan.GetFloorPlanRoofSupport(b, candidate, BodyRadius);
                var actual = support ?? (doorEdge ? center : null) ?? GroundEdgeSupport(b, plan, candidate, center) ?? roof;
                if (within && actual == null && Math.Abs(local.Y - plan.Y) < b.Height / b.Floors) return false;
                double targetHeight = actual?.Y ?? height;
                if (ArchitectureFloorPlan.BlocksFloorPlanMovement(b, floor, feet, new Vec3(candidate.X, targetHeight, candidate.Z), BodyRadius, EyeHeight)) return false;
                if (b == supportingSite && Floor != 0 && actual == null) return false;
                if (actual != null)
                {
                    if (actual.Link != null && actual.Y > b.Position.Y + .6 + ArchitectureFloorPlan.GetBuildingFloorPlan(b, actual.Link.FromFloor).Y + .01 && !canAccess(b, actual.Link.ToFloor)) { BlockedAccess = $"{b.Name}的楼梯目标层需要相应权限。"; return false; }
                    if ((actual.Kind == "room" || actual.Kind == "stairs") && !canAccess(b, actual.Floor)) { BlockedAccess = $"{b.Name}需要相应权限。"; return false; }
                    bool outdoor = actual.Kind == "roof" || actual.Kind == "courtyard" || actual.Kind == "gallery";
                    if (Math.Abs(actual.Y - feet.Y) > (outdoor ? 2.6 : .42)) return false;
                    site = b; nextFloor = actual.Floor; height = actual.Y; if (actual.Kind == "room" || actual.Kind == "stairs") occupied = b;
                }
                if (actual == null && Math.Abs(a.Y - plan.Y) > 1.5) continue;
            }
            foreach (var b in world.Buildings)
            {
                if (ArchitectureFloorPlan.GetBuildingBody(b) != null || b.Kind == "pavilion") continue;
                if (Math.Abs(x - b.Position.X) > b.Width / 2 + 1 || Math.Abs(z - b.Position.Z) > b.Depth / 2 + 1) continue;
                int level = b.Id == Inside?.Id ? Floor : 0; var size = Access.GetFloorDimensions(b, level);
                bool was = Contains(b, feet, BodyRadius), now = Contains(b, candidate, BodyRadius), opening = Math.Abs(x - b.Door.X) < JsMath.Max(1.5, JsMath.Min(2.7, b.Width * .1));
                if (Math.Abs(Math.Abs(x - b.Position.X) - size.Width / 2) < .7 || Math.Abs(z - (b.Position.Z - size.Depth / 2)) < .7 || (Math.Abs(z - (b.Position.Z + size.Depth / 2)) < 1 && !opening) || (was != now && !opening) || (Floor != 0 && was != now)) return false;
                if (now) { if (!canAccess(b, level)) return false; occupied = b; nextFloor = level; height = b.Position.Y + .6 + level * b.Height / b.Floors; site = null; }
            }
            var blocks = modifications();
            foreach (var p in blocks) { double top = p.Y + .2; if (Math.Abs(x - p.X) < .1 + BodyRadius && Math.Abs(z - p.Z) < .1 + BodyRadius && top > height && top <= feet.Y + .4 + 1e-7) height = top; }
            foreach (var p in blocks) if (Math.Abs(x - p.X) < .1 + BodyRadius && Math.Abs(z - p.Z) < .1 + BodyRadius && p.Y < height + EyeHeight && p.Y + .2 > height + .01) return false;
            if (occupied == null && site == null && Math.Abs(height - feet.Y) > 2.6) return false;
            if (!MayWalkTo(new Vec3(x, height, z))) return false;
            feet = new Vec3(x, height, z); Inside = occupied; supportingSite = site; Floor = nextFloor; return true;
        }

        void WalkToLegacy(double x, double z)
        {
            double limit = world.Size / 2 - 8; x = Clamp(x, -limit, limit); z = Clamp(z, -limit, limit);
            var candidate = new Vec3(x, feet.Y, z);
            if (SiteFixtures.BlocksMarketCounter(marketCounters, feet, candidate, BodyRadius, EyeHeight)) return;
            if (Inside == null && TransportGeometry.BlocksTransportBarrier(world, feet, candidate, BodyRadius)) return;
            foreach (var b in world.Buildings)
            {
                if (b.Kind == "pavilion" || ArchitectureFloorPlan.GetBuildingBody(b) != null) continue;
                if (Math.Abs(x - b.Position.X) > b.Width / 2 + 1 || Math.Abs(z - b.Position.Z) > b.Depth / 2 + 1) continue;
                int level = b.Id == Inside?.Id ? Floor : 0; var size = Access.GetFloorDimensions(b, level);
                bool wasInside = Contains(b, feet, BodyRadius), nowInside = Contains(b, candidate, BodyRadius);
                bool opening = Math.Abs(x - b.Door.X) < JsMath.Max(1.5, JsMath.Min(2.7, b.Width * .1));
                bool southWall = Math.Abs(z - (b.Position.Z + size.Depth / 2)) < 1;
                bool otherWall = Math.Abs(Math.Abs(x - b.Position.X) - size.Width / 2) < .7 || Math.Abs(z - (b.Position.Z - size.Depth / 2)) < .7;
                if (otherWall || (southWall && !opening) || (wasInside != nowInside && !opening)) return;
                if (Floor != 0 && wasInside != nowInside) return;
            }
            var building = world.Buildings.FirstOrDefault(b => ArchitectureFloorPlan.GetBuildingBody(b) == null && Contains(b, candidate, BodyRadius));
            if (building != null && !canAccess(building, building.Id == Inside?.Id ? Floor : 0)) { BlockedAccess = $"{building.Name}需要相应权限。"; return; }
            int nextFloor = building != null && building.Id == Inside?.Id ? Floor : 0;
            double height = building != null ? building.Position.Y + .6 + nextFloor * building.Height / building.Floors : World.GetWalkHeight(world, x, z, feet.Y);
            var blocks = modifications();
            foreach (var p in blocks) { double top = p.Y + .2; if (Math.Abs(x - p.X) < .1 + BodyRadius && Math.Abs(z - p.Z) < .1 + BodyRadius && top > height && top <= feet.Y + .4 + 1e-7) height = top; }
            foreach (var p in blocks) if (Math.Abs(x - p.X) < .1 + BodyRadius && Math.Abs(z - p.Z) < .1 + BodyRadius && p.Y < height + EyeHeight && p.Y + .2 > height + .01) return;
            if (Math.Abs(height - feet.Y) > 2.6 && building == null) return;
            if (!MayWalkTo(new Vec3(x, height, z))) return;
            Floor = nextFloor; Inside = building; feet = new Vec3(x, height, z);
        }

        bool MayWalkTo(Vec3 to)
        {
            if (mayWalkTo(feet, to)) return true;
            BlockedAccess = "道路已关闭；请等待通行，已在封闭路段内的行人须沿许可方向退出。";
            return false;
        }

        bool Contains(Building b, Vec3 p, double margin)
        {
            int level = b.Id == Inside?.Id ? Floor : 0;
            if (ArchitectureFloorPlan.GetBuildingBody(b) != null) { var s = ArchitectureFloorPlan.FloorPlanSupport(b, level, p, margin); return s != null && (s.Kind == "room" || s.Kind == "stairs"); }
            var size = Access.GetFloorDimensions(b, level);
            return Math.Abs(p.X - b.Position.X) < size.Width / 2 - margin && Math.Abs(p.Z - b.Position.Z) < size.Depth / 2 - margin;
        }
    }
}
