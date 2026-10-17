// Port of src/rendering/lantern-glow.ts: where the city's lanterns glow after
// dusk (a pair beside every door, eave corners and mid-eaves of low buildings,
// street lamps along roads, and the lantern strings). Display only; a pure
// function of the world.
using System.Collections.Generic;

namespace Yunshan.Core
{
    public sealed class LanternGlowPoint { public double X, Y, Z; public string Kind; }

    public static class LanternGlow
    {
        static readonly HashSet<string> NoEave = new HashSet<string> { "station", "airport", "starport", "core", "facility" };

        public static List<LanternGlowPoint> Of(WorldDefinition world, double streetSpacing = 36)
        {
            var output = new List<LanternGlowPoint>();
            foreach (var b in world.Buildings)
            {
                var p = b.Position; double dx = b.Door.X - p.X, dz = b.Door.Z - p.Z, len = JsMath.Hypot(dx, dz); if (len == 0 || double.IsNaN(len)) len = 1;
                double tx = -dz / len, tz = dx / len;
                foreach (var s in new[] { -1.3, 1.3 }) output.Add(new LanternGlowPoint { X = b.Door.X + tx * s + dx / len * .5, Y = b.Door.Y + 2.2, Z = b.Door.Z + tz * s + dz / len * .5, Kind = "door" });
                if (b.Floors > 7 || NoEave.Contains(b.Kind)) continue;
                double c = JsMath.Cos(b.Rotation), sn = JsMath.Sin(b.Rotation), hw = b.Width / 2 + .6, hd = b.Depth / 2 + .6, y = p.Y + b.Height - .4;
                foreach (var (u, v) in new[] { (-hw, -hd), (0.0, -hd), (hw, -hd), (hw, 0.0), (hw, hd), (0.0, hd), (-hw, hd), (-hw, 0.0) })
                    output.Add(new LanternGlowPoint { X = p.X + u * c + v * sn, Y = y, Z = p.Z - u * sn + v * c, Kind = "eave" });
            }
            foreach (var edge in world.Edges)
            {
                if ((edge.Mode != "road" && edge.Mode != "bridge") || edge.Id.Contains("runway")) continue;
                double carry = streetSpacing / 2;
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    Vec3 a = edge.Points[i - 1], b = edge.Points[i]; double seg = JsMath.Hypot(b.X - a.X, b.Y - a.Y, b.Z - a.Z);
                    for (; carry <= seg; carry += streetSpacing) { double t = carry / seg; output.Add(new LanternGlowPoint { X = a.X + (b.X - a.X) * t, Y = a.Y + (b.Y - a.Y) * t + 3.6, Z = a.Z + (b.Z - a.Z) * t, Kind = "street" }); }
                    carry -= seg;
                }
            }
            foreach (var list in new[] { LanternStrings.Of(world), LanternStrings.Terrace(world) })
                foreach (var s in list) foreach (var l in s.Lanterns) output.Add(new LanternGlowPoint { X = l.X, Y = l.Y, Z = l.Z, Kind = "string" });
            return output;
        }

        /// <summary>The web renderer's night factor: max(0, 1 − daylight × 1.6).</summary>
        public static double Night(double daylight) => JsMath.Max(0, 1 - daylight * 1.6);
    }
}
