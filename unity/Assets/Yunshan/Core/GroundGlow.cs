// Port of src/rendering/ground-glow.ts: warm pools of light on the ground under
// street lamps and doorway lamps after dusk. Display only; a pure function of the world.
using System.Collections.Generic;

namespace Yunshan.Core
{
    public sealed class GroundPool { public double X, Y, Z, Radius; public double[] Along; }

    public static class GroundGlow
    {
        public const double StreetLampHeight = 3.6, DoorLampHeight = 2.2, GroundLift = .06, StreetPoolRadius = 4.5, DoorPoolRadius = 2.6;

        public static List<GroundPool> Pools(WorldDefinition world, double streetSpacing = 36)
        {
            var output = new List<GroundPool>();
            foreach (var g in LanternGlow.Of(world, streetSpacing)) if (g.Kind == "door") output.Add(new GroundPool { X = g.X, Y = g.Y - DoorLampHeight + GroundLift, Z = g.Z, Radius = DoorPoolRadius });
            foreach (var edge in world.Edges)
            {
                if ((edge.Mode != "road" && edge.Mode != "bridge") || edge.Id.Contains("runway")) continue;
                double carry = streetSpacing / 2;
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    Vec3 a = edge.Points[i - 1], b = edge.Points[i]; double seg = JsMath.Hypot(b.X - a.X, b.Y - a.Y, b.Z - a.Z);
                    for (; carry <= seg; carry += streetSpacing)
                    {
                        double t = carry / seg;
                        output.Add(new GroundPool { X = a.X + (b.X - a.X) * t, Y = a.Y + (b.Y - a.Y) * t + GroundLift, Z = a.Z + (b.Z - a.Z) * t, Radius = StreetPoolRadius, Along = new[] { (b.X - a.X) / seg, (b.Y - a.Y) / seg, (b.Z - a.Z) / seg } });
                    }
                    carry -= seg;
                }
            }
            return output;
        }
    }
}
