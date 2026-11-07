// Port of src/site-fixtures.ts (market counters: one physical description
// for drawing and walking).
using System.Collections.Generic;

namespace Yunshan.Core
{
    public sealed class MarketCounter
    {
        public string Id, BuildingId; public Vec3 Position, LocalPosition, Size; public double Rotation;
    }

    public static class SiteFixtures
    {
        static double Quantum(double value) => JsMath.Round(value / .2) * .2;
        static (double x, double z) ToWorld(Building b, double x, double z) =>
            (b.Position.X + x * JsMath.Cos(b.Rotation) + z * JsMath.Sin(b.Rotation), b.Position.Z + z * JsMath.Cos(b.Rotation) - x * JsMath.Sin(b.Rotation));

        public static List<MarketCounter> MarketCounters(WorldDefinition world, Building building)
        {
            var result = new List<MarketCounter>();
            if (building.Kind != "market") return result;
            var plan = ArchitectureFloorPlan.GetBuildingFloorPlan(building, 0);
            if (plan != null)
            {
                foreach (var fixture in plan.Fixtures)
                {
                    if (fixture.Kind != "counter") continue;
                    var rect = fixture.Rect;
                    var local = new Vec3((rect.X0 + rect.X1) / 2, plan.Y + (fixture.Bottom + fixture.Top) / 2, (rect.Z0 + rect.Z1) / 2);
                    var position = ArchitectureFloorPlan.BuildingWorldPosition(building, local);
                    result.Add(new MarketCounter
                    {
                        Id = $"{building.Id}-{fixture.Id}", BuildingId = building.Id, Position = position,
                        LocalPosition = new Vec3(local.X, position.Y - building.Position.Y, local.Z),
                        Size = new Vec3(rect.X1 - rect.X0, fixture.Top - fixture.Bottom, rect.Z1 - rect.Z0), Rotation = building.Rotation,
                    });
                }
                return result;
            }
            double width = Quantum(JsMath.Min(3.2, building.Width * .18)), depth = 1.2;
            foreach (int side in new[] { -1, 1 })
            {
                double x = Quantum(side * building.Width * .3), z = Quantum(building.Depth / 2 + 1.2);
                var center = ToWorld(building, x, z);
                var offsets = new[] { (0d, 0d), (-width / 2, -depth / 2), (-width / 2, depth / 2), (width / 2, -depth / 2), (width / 2, depth / 2) };
                var supports = new double[offsets.Length];
                for (int i = 0; i < offsets.Length; i++)
                {
                    var point = ToWorld(building, x + offsets[i].Item1, z + offsets[i].Item2);
                    supports[i] = World.GetWalkHeight(world, point.x, point.z, building.Door.Y);
                }
                if (JsMath.Max(supports) - JsMath.Min(supports) > .4 + 1e-7) continue;
                double baseY = JsMath.Max(supports);
                result.Add(new MarketCounter
                {
                    Id = $"{building.Id}-counter-{(side < 0 ? "west" : "east")}", BuildingId = building.Id,
                    Position = new Vec3(center.x, baseY + .5, center.z), LocalPosition = new Vec3(x, baseY + .5 - building.Position.Y, z),
                    Size = new Vec3(width, 1, depth), Rotation = building.Rotation,
                });
            }
            return result;
        }

        /// <summary>A body may walk outward from inside a counter but not deeper or in.</summary>
        public static bool BlocksMarketCounter(IReadOnlyList<MarketCounter> counters, Vec3 from, Vec3 to, double radius = .35, double height = 1.72)
        {
            foreach (var counter in counters)
            {
                double bottom = counter.Position.Y - counter.Size.Y / 2, top = bottom + counter.Size.Y;
                if (from.Y >= top - .01 || from.Y + height <= bottom + .01) continue;
                (double x, double z) Local(Vec3 p)
                {
                    double dx = p.X - counter.Position.X, dz = p.Z - counter.Position.Z;
                    return (dx * JsMath.Cos(counter.Rotation) - dz * JsMath.Sin(counter.Rotation), dz * JsMath.Cos(counter.Rotation) + dx * JsMath.Sin(counter.Rotation));
                }
                var before = Local(from); var after = Local(to);
                double halfX = counter.Size.X / 2 + radius, halfZ = counter.Size.Z / 2 + radius;
                double Penetration((double x, double z) p) => JsMath.Min(halfX - System.Math.Abs(p.x), halfZ - System.Math.Abs(p.z));
                double Radial((double x, double z) p) { double a = p.x / halfX, c = p.z / halfZ; return a * a + c * c; }
                double next = Penetration(after);
                bool escaping = Penetration(before) > 1e-7 && (next < Penetration(before) - 1e-7 || Radial(after) > Radial(before) + 1e-7);
                if (next > 1e-7 && !escaping) return true;
            }
            return false;
        }
    }
}
