// Port of src/rendering/cable-rope.ts: the display-only ropeway rope of street layouts, hung from the
// edge's ends and lattice towers with a sag, never closer than Clearance above the path. Cabins stay at
// their authoritative positions; their grip arm reaches the rope. Nothing here enters the simulation.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public static class CableRope
    {
        public const double Top = 9, Sag = .035, Clearance = 7.9, Sample = 6, TowerSpacing = 120, Grip = .4;

        sealed class Profile { public NetworkEdge Edge; public List<double> Cumulative; public List<(double Along, double Y)> Supports; public double Total; }
        static readonly System.Runtime.CompilerServices.ConditionalWeakTable<WorldDefinition, Dictionary<string, Profile>> cache = new System.Runtime.CompilerServices.ConditionalWeakTable<WorldDefinition, Dictionary<string, Profile>>();

        static Profile ProfileOf(WorldDefinition world, string edgeId)
        {
            var byEdge = cache.GetOrCreateValue(world);
            lock (byEdge) if (byEdge.TryGetValue(edgeId, out var known)) return known;
            Profile profile = null;
            var edge = world.Edges.FirstOrDefault(e => e.Id == edgeId);
            if (edge != null && edge.Mode == "cable" && edge.Points.Count >= 2 && StreetLayouts.IsStreetLayout(world.LayoutVersion))
            {
                var cumulative = new List<double> { 0 };
                for (int i = 1; i < edge.Points.Count; i++) cumulative.Add(cumulative[i - 1] + JsMath.Hypot(edge.Points[i].X - edge.Points[i - 1].X, edge.Points[i].Z - edge.Points[i - 1].Z));
                var supports = new List<(double Along, double Y)> { (0, edge.Points[0].Y + Top) };
                double remainder = 0;
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    Vec3 a = edge.Points[i - 1], b = edge.Points[i]; double length = cumulative[i] - cumulative[i - 1];
                    for (double along = TowerSpacing - remainder; along <= length; along += TowerSpacing)
                    {
                        double t = along / JsMath.Max(.01, length), x = a.X + (b.X - a.X) * t, z = a.Z + (b.Z - a.Z) * t, top = a.Y + (b.Y - a.Y) * t + Top, tall = top - World.TerrainHeight(world, x, z);
                        if (tall > 6 && tall < 240) supports.Add((cumulative[i - 1] + along, top));
                    }
                    remainder = (remainder + length) % TowerSpacing;
                }
                double total = cumulative[cumulative.Count - 1]; supports.Add((total, edge.Points[edge.Points.Count - 1].Y + Top));
                profile = new Profile { Edge = edge, Cumulative = cumulative, Supports = supports, Total = total };
            }
            lock (byEdge) byEdge[edgeId] = profile;
            return profile;
        }
        static double Clamp01(double v) => Math.Min(1, Math.Max(0, v));
        static double PathY(Profile p, double along)
        {
            int i = 1; while (i < p.Cumulative.Count - 1 && p.Cumulative[i] < along) i++;
            double span = p.Cumulative[i] - p.Cumulative[i - 1], t = span > 0 ? Clamp01((along - p.Cumulative[i - 1]) / span) : 0;
            return p.Edge.Points[i - 1].Y + (p.Edge.Points[i].Y - p.Edge.Points[i - 1].Y) * t;
        }
        static double RopeY(Profile p, double along)
        {
            int k = 1; while (k < p.Supports.Count - 1 && p.Supports[k].Along < along) k++;
            var a = p.Supports[k - 1]; var b = p.Supports[k]; double span = b.Along - a.Along, u = span > 0 ? Clamp01((along - a.Along) / span) : 0;
            return Math.Max(PathY(p, along) + Clearance, a.Y + (b.Y - a.Y) * u - Sag * span * 4 * u * (1 - u));
        }

        /// <summary>The rope's top line every Sample m and at every support, or null where the layout keeps the plain rope.</summary>
        public static List<Vec3> Line(WorldDefinition world, string edgeId)
        {
            var p = ProfileOf(world, edgeId); if (p == null) return null;
            var marks = new HashSet<double>(p.Supports.Select(s => s.Along));
            for (double along = 0; along < p.Total; along += Sample) marks.Add(along);
            var output = new List<Vec3>();
            foreach (var along in marks.OrderBy(v => v))
            {
                int i = 1; while (i < p.Cumulative.Count - 1 && p.Cumulative[i] < along) i++;
                double span = p.Cumulative[i] - p.Cumulative[i - 1], t = span > 0 ? Clamp01((along - p.Cumulative[i - 1]) / span) : 0; Vec3 a = p.Edge.Points[i - 1], b = p.Edge.Points[i];
                output.Add(new Vec3(a.X + (b.X - a.X) * t, RopeY(p, along), a.Z + (b.Z - a.Z) * t));
            }
            return output;
        }

        /// <summary>The rope's top height above a point of a cable edge (its nearest place along the edge), or null without a hung rope.</summary>
        public static double? HeightAt(WorldDefinition world, string edgeId, Vec3 position)
        {
            var p = ProfileOf(world, edgeId); if (p == null) return null;
            double bestD = double.PositiveInfinity, bestAlong = 0;
            for (int i = 1; i < p.Edge.Points.Count; i++)
            {
                Vec3 a = p.Edge.Points[i - 1], b = p.Edge.Points[i]; double dx = b.X - a.X, dz = b.Z - a.Z, n = dx * dx + dz * dz, t = n > 0 ? Clamp01(((position.X - a.X) * dx + (position.Z - a.Z) * dz) / n) : 0;
                double d = JsMath.Hypot(position.X - a.X - dx * t, position.Z - a.Z - dz * t); if (d < bestD) { bestD = d; bestAlong = p.Cumulative[i - 1] + (p.Cumulative[i] - p.Cumulative[i - 1]) * t; }
            }
            return RopeY(p, bestAlong);
        }

        /// <summary>A cabin's grip arm from its roof (footY above the cabin position y) up to the hung rope: centre and height relative to y.</summary>
        public static (double Y, double Height) GripArm(double footY, double y, double rope)
        {
            double top = rope - Grip - y; return ((footY + top) / 2, Math.Max(.1, top - footY));
        }
    }
}
