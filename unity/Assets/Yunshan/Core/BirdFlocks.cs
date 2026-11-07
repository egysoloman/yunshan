// Port of src/rendering/bird-flocks.ts: by day a few birds circle above each district, flapping.
// Display only; a pure function of the world and the clock in seconds.
using System.Collections.Generic;

namespace Yunshan.Core
{
    public sealed class Flock { public double X, Y, Z, Radius, Direction, Phase; }
    public struct Bird { public double X, Y, Z, Yaw, Flap; }

    public static class BirdFlocks
    {
        public const int PerFlock = 7;
        public const double Lift = 25, Radius = 130, Spread = 25, Speed = .06, FlapRate = 7, Daylight = .3, Wingspan = 2.2;

        public static List<Flock> Of(WorldDefinition world)
        {
            var output = new List<Flock>();
            for (int i = 0; i < world.Districts.Count; i++)
            {
                var d = world.Districts[i]; double top = d.Center.Y;
                foreach (var b in world.Buildings) if (b.DistrictId == d.Id) top = JsMath.Max(top, b.Position.Y + .6 + b.Height);
                output.Add(new Flock { X = d.Center.X, Y = top + Lift, Z = d.Center.Z, Radius = Radius + (i % 3) * 20, Direction = i % 2 == 1 ? -1 : 1, Phase = i * 2.399 });
            }
            return output;
        }

        public static List<Bird> At(IReadOnlyList<Flock> flocks, double seconds)
        {
            var output = new List<Bird>(flocks.Count * PerFlock);
            foreach (var f in flocks) for (int k = 0; k < PerFlock; k++)
            {
                double a = f.Phase + f.Direction * seconds * Speed - f.Direction * k * .9, r = f.Radius + JsMath.Sin(k * 1.7 + f.Phase) * Spread;
                double x = f.X + JsMath.Cos(a) * r, z = f.Z + JsMath.Sin(a) * r, y = f.Y + JsMath.Sin(seconds * .5 + k * 1.3 + f.Phase) * 3 + (k % 3) * 2;
                double vx = -JsMath.Sin(a) * f.Direction, vz = JsMath.Cos(a) * f.Direction;
                output.Add(new Bird { X = x, Y = y, Z = z, Yaw = JsMath.Atan2(vx, vz), Flap = JsMath.Sin(seconds * FlapRate + k * 2.1 + f.Phase) });
            }
            return output;
        }
    }
}
