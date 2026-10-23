// Port of src/rendering/lantern-strings.ts and the lantern part of the web
// renderer's buildNetwork: 千灯市集's strings of red lanterns across the
// current-v8 market streets. Display only: not walkable, no collision.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public sealed class LanternString { public Vec3[] Poles; public List<Vec3> Lanterns; }

    public static class LanternStrings
    {
        public const double Span = 24;

        public static List<LanternString> Of(WorldDefinition world, string districtId = "market")
        {
            var output = new List<LanternString>();
            if (world.LayoutVersion != "current-v8") return output;
            var nodes = new Dictionary<string, NetworkNode>(); foreach (var n in world.Nodes) nodes[n.Id] = n;
            string District(string id) => nodes.TryGetValue(id, out var n) ? n.DistrictId : null;
            foreach (var edge in world.Edges)
            {
                if (edge.Mode != "road" || edge.Id.Contains("runway") || District(edge.From) != districtId || District(edge.To) != districtId) continue;
                double half = TransportGeometry.DeckWidth(edge) / 2 + .8, carry = Span / 2;
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    Vec3 a = edge.Points[i - 1], b = edge.Points[i]; double len = JsMath.Hypot(b.X - a.X, b.Z - a.Z);
                    if (len < 1e-6) continue;
                    double nx = -(b.Z - a.Z) / len, nz = (b.X - a.X) / len;
                    for (; carry <= len; carry += Span)
                    {
                        double t = carry / len, x = a.X + (b.X - a.X) * t, y = a.Y + (b.Y - a.Y) * t, z = a.Z + (b.Z - a.Z) * t;
                        var lanterns = new List<Vec3>();
                        for (int k = 1; k <= 5; k++) { double u = (double)k / 6 * 2 - 1; lanterns.Add(new Vec3(x + nx * half * u, y + 5.6 - (1 - u * u) * .9, z + nz * half * u)); }
                        output.Add(new LanternString { Poles = new[] { new Vec3(x + nx * half, y, z + nz * half), new Vec3(x - nx * half, y, z - nz * half) }, Lanterns = lanterns });
                    }
                    carry -= len;
                }
            }
            return output;
        }

        public const double TerraceSpan = 36;

        /// <summary>Port of terraceLanternStrings: a lighter string of three lanterns every
        /// TerraceSpan metres along the other districts' terrace streets, left out where a pole
        /// would stand in a building footprint (+0.4 m) or within 2.5 m of a door.</summary>
        public static List<LanternString> Terrace(WorldDefinition world)
        {
            var output = new List<LanternString>();
            if (world.LayoutVersion != "current-v8") return output;
            var nodes = new Dictionary<string, NetworkNode>(); foreach (var n in world.Nodes) nodes[n.Id] = n;
            string District(string id) => nodes.TryGetValue(id, out var n) ? n.DistrictId : null;
            bool Blocked(Vec3 p)
            {
                foreach (var b in world.Buildings)
                {
                    double dx = p.X - b.Position.X, dz = p.Z - b.Position.Z, reach = b.Width + b.Depth + 8;
                    if (dx * dx + dz * dz > reach * reach) continue;
                    double c = JsMath.Cos(b.Rotation), s = JsMath.Sin(b.Rotation), lx = dx * c - dz * s, lz = dx * s + dz * c;
                    double ddx = p.X - b.Door.X, ddz = p.Z - b.Door.Z;
                    if (Math.Abs(lx) < b.Width / 2 + .4 && Math.Abs(lz) < b.Depth / 2 + .4 || ddx * ddx + ddz * ddz < 2.5 * 2.5) return true;
                }
                return false;
            }
            foreach (var edge in world.Edges)
            {
                if (edge.Mode != "road" || !edge.Id.Contains("-terrace-") || District(edge.From) == "market" || District(edge.To) == "market") continue;
                double half = TransportGeometry.DeckWidth(edge) / 2 + .6, carry = TerraceSpan / 2;
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    Vec3 a = edge.Points[i - 1], b = edge.Points[i]; double len = JsMath.Hypot(b.X - a.X, b.Z - a.Z);
                    if (len < 1e-6) continue;
                    double nx = -(b.Z - a.Z) / len, nz = (b.X - a.X) / len;
                    for (; carry <= len; carry += TerraceSpan)
                    {
                        double t = carry / len, x = a.X + (b.X - a.X) * t, y = a.Y + (b.Y - a.Y) * t, z = a.Z + (b.Z - a.Z) * t;
                        var poles = new[] { new Vec3(x + nx * half, y, z + nz * half), new Vec3(x - nx * half, y, z - nz * half) };
                        if (Blocked(poles[0]) || Blocked(poles[1])) continue;
                        var lanterns = new List<Vec3>();
                        for (int k = 1; k <= 3; k++) { double u = (double)k / 4 * 2 - 1; lanterns.Add(new Vec3(x + nx * half * u, y + 5.6 - (1 - u * u) * .6, z + nz * half * u)); }
                        output.Add(new LanternString { Poles = poles, Lanterns = lanterns });
                    }
                    carry -= len;
                }
            }
            return output;
        }

        /// <summary>Same boxes and cord, in the same order, as the web renderer.</summary>
        public static void Emit(WorldDefinition world, INetworkSink sink)
        {
            foreach (var s in Of(world).Concat(Terrace(world)))
            {
                foreach (var pole in s.Poles) { sink.Box("wood", pole.X, pole.Y + 2.9, pole.Z, .3, 5.8, .3, "#5a3a26"); sink.Box("wood", pole.X, pole.Y + 5.85, pole.Z, .5, .2, .5, "#3d2a1d"); }
                Vec3 a = s.Poles[0], b = s.Poles[1];
                sink.Segment("wood", new Vec3(a.X, a.Y + 5.75, a.Z), new Vec3(b.X, b.Y + 5.75, b.Z), .05, .05, 0, "#2f2a24");
                foreach (var l in s.Lanterns) { sink.Box("lantern", l.X, l.Y, l.Z, .55, .7, .55, "#b8432f"); sink.Box("wood", l.X, l.Y + .42, l.Z, .35, .12, .35, "#3d2a1d"); }
            }
        }
    }
}
