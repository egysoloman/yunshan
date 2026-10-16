using System.Linq;

namespace Yunshan.Core
{
    public sealed class DoorwayGlowPanel { public double X, Y, Z, Width, Height, Yaw; }

    /// <summary>Port of src/rendering/doorway-glow.ts: the lit interior seen
    /// through an open market's entrance after dusk, a warm panel just inside
    /// the entrance opening facing out.</summary>
    public static class DoorwayGlow
    {
        public const int Limit = 48; public const double Range = 160, Strength = .38;

        public static DoorwayGlowPanel Panel(Building building)
        {
            if (building.Kind != "market") return null;
            var plan = ArchitectureFloorPlan.GetBuildingFloorPlan(building, 0); var wall = plan?.Walls.FirstOrDefault(w => w.Opening?.Use == "entrance");
            if (plan == null || wall?.Opening == null) return null;
            double dx = wall.B.X - wall.A.X, dz = wall.B.Z - wall.A.Z, length = JsMath.Hypot(dx, dz), t = (wall.Opening.From + wall.Opening.To) / 2;
            double mx = wall.A.X + dx * t / length, mz = wall.A.Z + dz * t / length;
            double nx = -dz / length, nz = dx / length; if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
            double inset = wall.Thickness / 2 + .08;
            var at = ArchitectureFloorPlan.BuildingWorldPosition(building, new Vec3(mx - nx * inset, plan.Y + wall.Opening.Height / 2, mz - nz * inset));
            double c = JsMath.Cos(building.Rotation), s = JsMath.Sin(building.Rotation);
            return new DoorwayGlowPanel { X = at.X, Y = at.Y, Z = at.Z, Width = wall.Opening.To - wall.Opening.From - .1, Height = wall.Opening.Height - .05, Yaw = JsMath.Atan2(nx * c + nz * s, -nx * s + nz * c) };
        }

        /// <summary>0 by day or while closed; rises to 1 as daylight falls from .55 to .2.</summary>
        public static double Level(bool open, double daylight) => open ? System.Math.Max(0, System.Math.Min(1, (.55 - daylight) / .35)) : 0;
    }
}
