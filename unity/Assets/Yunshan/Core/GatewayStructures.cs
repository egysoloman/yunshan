// Port of the web renderer's buildGateways (src/renderer.ts): the core
// forecourt (only when the studio BUILT-092 forecourt is not placed), the
// runway centre dash with its two lights, and the starport tower and ring.
// The web ring is a torus; here it is 32 tube segments at the same radius.
using System;
using System.Linq;

namespace Yunshan.Core
{
    public static class GatewayStructures
    {
        public static void Emit(WorldDefinition world, INetworkSink sink, bool forecourtDressed)
        {
            var civic = world.Buildings.FirstOrDefault(b => b.Kind == "core");
            if (civic != null && !forecourtDressed)
            {
                double x = civic.Position.X, z = civic.Door.Z + 67, y = civic.Position.Y;
                sink.Box("stone", x, y + .04, z, 96, .12, 84, "#82958a");
                foreach (var side in new[] { -1, 1 }) foreach (var offset in new[] { -30.0, 0, 30 })
                {
                    sink.Box("wood", x + side * 39, y + 2, z + offset, .4, 4, .4);
                    sink.Box("amber", x + side * 39, y + 4.15, z + offset, 1.2, 1.4, 1.2);
                    sink.Box("red", x + side * 39, y + 4.9, z + offset, 1.5, .2, 1.5);
                }
                foreach (var side in new[] { -1, 1 }) { sink.Box("wood", x + side * 44, y + 5, z - 37, .45, 10, .45); sink.Box("red", x + side * 44 + 1.8, y + 7.4, z - 37, 3.6, 4.5, .2); }
                sink.Box("cyan", x, y + .2, z, 1.2, .08, 80);
            }
            foreach (var b in world.Buildings)
            {
                if (b.Kind == "airport")
                {
                    var runway = world.Edges.FirstOrDefault(e => e.Id == "road-airport-runway-strip");
                    if (runway != null) for (int i = 1; i < runway.Points.Count; i++)
                    {
                        Vec3 a = runway.Points[i - 1], next = runway.Points[i]; var c = new Vec3((a.X + next.X) / 2, (a.Y + next.Y) / 2 + .18, (a.Z + next.Z) / 2);
                        sink.Box("amber", c.X, c.Y, c.Z, 6, .07, 1);
                        foreach (var side in new[] { -1, 1 }) sink.Box("cyan", c.X, c.Y + .12, c.Z + side * 16, .9, .3, .9);
                    }
                }
                if (b.Kind == "starport")
                {
                    double radius = Math.Max(42, b.Width * .6), ringY = b.Position.Y + b.Height + 12;
                    for (int k = 0; k < 32; k++)
                    {
                        double a0 = k / 32.0 * Math.PI * 2, a1 = (k + 1) / 32.0 * Math.PI * 2;
                        sink.Segment("cyan", new Vec3(b.Position.X + Math.Cos(a0) * radius, ringY, b.Position.Z + Math.Sin(a0) * radius), new Vec3(b.Position.X + Math.Cos(a1) * radius, ringY, b.Position.Z + Math.Sin(a1) * radius), 4.4, 4.4);
                    }
                    sink.Box("cyan", b.Position.X, b.Position.Y + b.Height + 26, b.Position.Z, 2.5, 35, 2.5);
                }
            }
        }
    }
}
