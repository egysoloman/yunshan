// Port of src/transport-geometry.ts: guard rails on raised roads and bridges
// (openings at same-grade joins), shared by drawing and body collision.
using System.Collections.Generic;
using System.Runtime.CompilerServices;

namespace Yunshan.Core
{
    public static class TransportGeometry
    {
        public const double GuardrailThickness = .2, BridgeOpenEnd = 6;
        const double SameGradeTolerance = .26, JoinBodyClearance = .35;

        sealed class Interval { public double Start, End; }
        sealed class GuardLayout { public double Length; public List<double> Lengths, Preceding; public List<Interval> Intervals; }
        sealed class GuardSegment { public NetworkEdge Edge; public Vec3 A, B; public double Dx, Dz, Horizontal, Length, Along; public List<string> Cells; }
        sealed class Cache { public int EdgeCount; public Dictionary<NetworkEdge, GuardLayout> Edges; }
        static readonly ConditionalWeakTable<WorldDefinition, Cache> Layouts = new ConditionalWeakTable<WorldDefinition, Cache>();

        public static double DeckWidth(NetworkEdge edge)
        {
            if (edge.Id.Contains("airport-runway-strip")) return 44;
            if (edge.Mode == "bridge") return 9;
            if (edge.Mode == "maglev" || edge.Mode == "lightRail") return 6;
            return 10;
        }
        public static double GuardrailOffset(NetworkEdge edge)
        {
            if (edge.Mode == "bridge") return 4.1;
            if (edge.Mode == "maglev" || edge.Mode == "lightRail") return 2.75;
            return edge.Id.Contains("airport-runway-strip") ? 21.75 : 4.75;
        }

        public static void Invalidate(WorldDefinition world) => Layouts.Remove(world);

        static Dictionary<NetworkEdge, GuardLayout> GuardLayouts(WorldDefinition world)
        {
            if (Layouts.TryGetValue(world, out var cached) && cached.EdgeCount == world.Edges.Count) return cached.Edges;
            var edges = new Dictionary<NetworkEdge, GuardLayout>();
            var cutOrder = new List<NetworkEdge>(); var cuts = new Dictionary<NetworkEdge, List<Interval>>();
            var segments = new List<GuardSegment>(); var grid = new Dictionary<string, List<int>>();
            const double cellSize = 64;
            foreach (var edge in world.Edges)
            {
                var lengths = new List<double>();
                for (int i = 1; i < edge.Points.Count; i++) { var p = edge.Points[i]; var q = edge.Points[i - 1]; lengths.Add(JsMath.Hypot(p.X - q.X, p.Y - q.Y, p.Z - q.Z)); }
                double length = 0; var preceding = new List<double>();
                foreach (var value in lengths) { preceding.Add(length); length += value; }
                edges[edge] = new GuardLayout { Length = length, Lengths = lengths, Preceding = preceding, Intervals = length > BridgeOpenEnd * 2 ? new List<Interval> { new Interval { Start = BridgeOpenEnd, End = length - BridgeOpenEnd } } : new List<Interval>() };
                if ((edge.Mode != "road" && edge.Mode != "bridge") || edge.Id.Contains("airport-runway-strip")) continue;
                cuts[edge] = new List<Interval>(); cutOrder.Add(edge);
                for (int index = 1; index < edge.Points.Count; index++)
                {
                    Vec3 a = edge.Points[index - 1], b = edge.Points[index];
                    double dx = b.X - a.X, dz = b.Z - a.Z, horizontal = JsMath.Hypot(dx, dz);
                    if (horizontal < 1e-8) continue;
                    var cells = new List<string>(); int id = segments.Count;
                    for (double x = System.Math.Floor(JsMath.Min(a.X, b.X) / cellSize); x <= System.Math.Floor(JsMath.Max(a.X, b.X) / cellSize); x++)
                        for (double z = System.Math.Floor(JsMath.Min(a.Z, b.Z) / cellSize); z <= System.Math.Floor(JsMath.Max(a.Z, b.Z) / cellSize); z++)
                        {
                            var cell = JsMath.ToJsString(x) + ":" + JsMath.ToJsString(z);
                            if (!grid.TryGetValue(cell, out var entries)) grid[cell] = entries = new List<int>();
                            entries.Add(id); cells.Add(cell);
                        }
                    segments.Add(new GuardSegment { Edge = edge, A = a, B = b, Dx = dx, Dz = dz, Horizontal = horizontal, Length = lengths[index - 1], Along = preceding[index - 1], Cells = cells });
                }
            }
            void Cut(GuardSegment current, GuardSegment crossing, double progress, double cos, double sin)
            {
                double half = (DeckWidth(crossing.Edge) / 2 + JoinBodyClearance + GuardrailOffset(current.Edge) * cos) / sin * current.Length / current.Horizontal;
                double center = current.Along + current.Length * progress;
                cuts[current.Edge].Add(new Interval { Start = center - half, End = center + half });
            }
            for (int index = 0; index < segments.Count; index++)
            {
                var segment = segments[index];
                var seen = new HashSet<int>(); var candidates = new List<int>();
                foreach (var cell in segment.Cells) if (grid.TryGetValue(cell, out var list)) foreach (var c in list) if (seen.Add(c)) candidates.Add(c);
                foreach (var candidate in candidates)
                {
                    if (candidate <= index) continue;
                    var other = segments[candidate]; if (other.Edge == segment.Edge) continue;
                    double cross = segment.Dx * other.Dz - segment.Dz * other.Dx; if (System.Math.Abs(cross) < 1e-8) continue;
                    double dx = other.A.X - segment.A.X, dz = other.A.Z - segment.A.Z;
                    double t = (dx * other.Dz - dz * other.Dx) / cross, u = (dx * segment.Dz - dz * segment.Dx) / cross;
                    if (t < -1e-7 || t > 1 + 1e-7 || u < -1e-7 || u > 1 + 1e-7) continue;
                    double y = segment.A.Y + (segment.B.Y - segment.A.Y) * t, otherY = other.A.Y + (other.B.Y - other.A.Y) * u;
                    if (System.Math.Abs(y - otherY) > SameGradeTolerance + 1e-8) continue;
                    double sin = System.Math.Abs(cross) / (segment.Horizontal * other.Horizontal), cos = System.Math.Abs(segment.Dx * other.Dx + segment.Dz * other.Dz) / (segment.Horizontal * other.Horizontal);
                    Cut(segment, other, t, cos, sin); Cut(other, segment, u, cos, sin);
                }
            }
            foreach (var edge in cutOrder)
            {
                var layout = edges[edge]; var intervals = layout.Intervals;
                foreach (var opening in cuts[edge])
                {
                    var next = new List<Interval>();
                    foreach (var interval in intervals)
                    {
                        if (opening.End <= interval.Start || opening.Start >= interval.End) { next.Add(interval); continue; }
                        if (opening.Start > interval.Start) next.Add(new Interval { Start = interval.Start, End = JsMath.Min(opening.Start, interval.End) });
                        if (opening.End < interval.End) next.Add(new Interval { Start = JsMath.Max(opening.End, interval.Start), End = interval.End });
                    }
                    intervals = next;
                }
                layout.Intervals = intervals;
            }
            Layouts.Remove(world);
            Layouts.Add(world, new Cache { EdgeCount = world.Edges.Count, Edges = edges });
            return edges;
        }

        /// <summary>Port of guardrailSpans: the visible rail pieces of one segment,
        /// split where a same-level street crosses the side rail.</summary>
        public static List<(Vec3 A, Vec3 B)> GuardrailSpans(WorldDefinition world, NetworkEdge edge, int segmentIndex)
        {
            var result = new List<(Vec3, Vec3)>();
            if (segmentIndex - 1 < 0 || segmentIndex >= edge.Points.Count) return result;
            Vec3 a = edge.Points[segmentIndex - 1], b = edge.Points[segmentIndex];
            if (edge.Mode != "road" && edge.Mode != "bridge") { result.Add((a, b)); return result; }
            if (!GuardLayouts(world).TryGetValue(edge, out var layout)) return result;
            double preceding = layout.Preceding[segmentIndex - 1], length = layout.Lengths[segmentIndex - 1];
            if (length < 1e-8) return result;
            Vec3 At(double along) { double t = (along - preceding) / length; return new Vec3(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t); }
            foreach (var interval in layout.Intervals)
            {
                double start = System.Math.Max(interval.Start, preceding), end = System.Math.Min(interval.End, preceding + length);
                if (end > start + 1e-8) result.Add((At(start), At(end)));
            }
            return result;
        }

        public static bool HasGuardrailAt(WorldDefinition world, NetworkEdge edge, double along)
        {
            if (!GuardLayouts(world).TryGetValue(edge, out var layout)) return false;
            foreach (var interval in layout.Intervals) if (along >= interval.Start && along <= interval.End) return true;
            return false;
        }

        struct Nearest { public double Distance, Y, Along, Length; }
        static Nearest NearestOn(NetworkEdge edge, Vec3 p)
        {
            var result = new Nearest { Distance = double.PositiveInfinity }; double along = 0;
            for (int i = 1; i < edge.Points.Count; i++)
            {
                Vec3 a = edge.Points[i - 1], b = edge.Points[i];
                double dx = b.X - a.X, dz = b.Z - a.Z;
                double segment = JsMath.Hypot(dx, b.Y - a.Y, dz), denominator = dx * dx + dz * dz;
                if (denominator == 0) denominator = 1;
                double t = JsMath.Max(0, JsMath.Min(1, ((p.X - a.X) * dx + (p.Z - a.Z) * dz) / denominator));
                double distance = JsMath.Hypot(p.X - a.X - dx * t, p.Z - a.Z - dz * t);
                if (distance < result.Distance) result = new Nearest { Distance = distance, Y = a.Y + (b.Y - a.Y) * t, Along = along + segment * t };
                along += segment;
            }
            result.Length = along; return result;
        }

        /// <summary>Railings block bodies at deck level; openings at joins let pedestrians enter.</summary>
        public static bool BlocksTransportBarrier(WorldDefinition world, Vec3 from, Vec3 to, double bodyRadius = .35)
        {
            foreach (var edge in world.Edges)
            {
                if ((edge.Mode != "road" && edge.Mode != "bridge") || edge.Id.Contains("airport-runway-strip")) continue;
                var a = NearestOn(edge, from);
                if (a.Distance > GuardrailOffset(edge) + bodyRadius + 1 || System.Math.Abs(a.Y - from.Y) > 1.1) continue;
                if (!HasGuardrailAt(world, edge, a.Along)) continue;
                if (edge.Mode == "road" && a.Y - World.TerrainHeight(world, from.X, from.Z) <= 4) continue;
                var b = NearestOn(edge, to); double inner = GuardrailOffset(edge) - GuardrailThickness / 2 - bodyRadius;
                if (a.Distance <= inner && b.Distance > inner || a.Distance >= GuardrailOffset(edge) + bodyRadius && b.Distance < GuardrailOffset(edge) + bodyRadius) return true;
            }
            return false;
        }
    }
}
