// Port of src/world.ts: deterministic city generation, terrain and walk heights.
// Behaviour must stay bit-identical to the TypeScript reference (see the
// world parity test); keep statement order and floating-point grouping.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;

namespace Yunshan.Core
{
    public static class World
    {
        public static readonly string[] CityLayoutVersions = { "legacy-ee3e7a1", "current-v2-r5", "current-v2", "current-v3", "current-v4", "current-v5", "current-v6", "current-v7" };
        public const string CurrentCityLayout = "current-v6";
        public const string GeologicalGeometryVersion = "yunshan-geology-v3-terraced-cellular-1";

        const double Unit = .2;
        static double Q(double n) => JsMath.Round(n / Unit) * Unit;
        static double Clamp(double n, double min, double max) => JsMath.Max(min, JsMath.Min(max, n));
        static double Smooth(double n) { n = Clamp(n, 0, 1); return n * n * (3 - 2 * n); }
        static double Distance(Vec3 a, Vec3 b) => JsMath.Hypot(a.X - b.X, a.Y - b.Y, a.Z - b.Z);

        sealed class DistrictPlan
        {
            public string Id, Name, Kind, Color; public double X, Z, Y, Radius; public int Count; public string[] Kinds;
        }
        static readonly DistrictPlan[] Plans =
        {
            new DistrictPlan { Id = "river", Name = "清溪水岸", Kind = "waterfront", X = -740, Z = 980, Y = 18, Radius = 410, Color = "#69b7b0", Count = 60, Kinds = new[] { "dock", "market", "home", "farm" } },
            new DistrictPlan { Id = "market", Name = "千灯市集", Kind = "market", X = -330, Z = 460, Y = 52, Radius = 420, Color = "#dcad69", Count = 76, Kinds = new[] { "market", "market", "home", "bank" } },
            new DistrictPlan { Id = "workshop", Name = "青铜工坊", Kind = "industry", X = -1190, Z = 210, Y = 142, Radius = 420, Color = "#ae906e", Count = 62, Kinds = new[] { "workshop", "workshop", "home", "farm" } },
            new DistrictPlan { Id = "west", Name = "松风里", Kind = "residential", X = -1080, Z = -550, Y = 270, Radius = 430, Color = "#91b7b6", Count = 76, Kinds = new[] { "home", "home", "home", "market" } },
            new DistrictPlan { Id = "academy", Name = "文澜学苑", Kind = "education", X = -370, Z = -410, Y = 206, Radius = 395, Color = "#aebfc6", Count = 56, Kinds = new[] { "school", "home", "clinic", "home" } },
            new DistrictPlan { Id = "government", Name = "玉衡官署", Kind = "government", X = 500, Z = -710, Y = 324, Radius = 360, Color = "#c29b78", Count = 48, Kinds = new[] { "hall", "police", "bank", "home" } },
            new DistrictPlan { Id = "core", Name = "瀑云天枢", Kind = "civic", X = 400, Z = -160, Y = 254, Radius = 340, Color = "#8ec9c9", Count = 42, Kinds = new[] { "hall", "station", "clinic", "home" } },
            new DistrictPlan { Id = "summit", Name = "九霄观云", Kind = "scenic", X = -60, Z = -1250, Y = 526, Radius = 310, Color = "#c9b396", Count = 24, Kinds = new[] { "pavilion", "home", "market", "hall" } },
            new DistrictPlan { Id = "east", Name = "临岚坊", Kind = "residential", X = 1110, Z = -280, Y = 190, Radius = 430, Color = "#c0b4a2", Count = 76, Kinds = new[] { "home", "home", "market", "clinic" } },
            new DistrictPlan { Id = "airport", Name = "南岫空港", Kind = "airport", X = 1150, Z = 900, Y = 64, Radius = 430, Color = "#9fb6c7", Count = 48, Kinds = new[] { "station", "workshop", "market", "home" } },
            new DistrictPlan { Id = "starport", Name = "云外星港", Kind = "starport", X = 1370, Z = -1280, Y = 368, Radius = 390, Color = "#aaa5d2", Count = 44, Kinds = new[] { "station", "workshop", "hall", "home" } },
        };

        /// <summary>mulberry32 exactly as JavaScript evaluates it: the counter is an
        /// unwrapped double; every bitwise use converts it with ToInt32/ToUint32.</summary>
        public static Func<double> Random(double seed)
        {
            long value = JsMath.ToUint32(seed);
            return () =>
            {
                unchecked
                {
                    value += 0x6D2B79F5;
                    int t = (int)(uint)(value & 0xFFFFFFFF);
                    t = JsMath.Imul(t ^ (int)((uint)t >> 15), t | 1);
                    long sum = (long)t + JsMath.Imul(t ^ (int)((uint)t >> 7), t | 61);
                    t ^= (int)(uint)(sum & 0xFFFFFFFF);
                    return (uint)(t ^ (int)((uint)t >> 14)) / 4294967296.0;
                }
            };
        }

        sealed class RoadSegment { public NetworkEdge Edge; public Vec3 A, B; }
        sealed class SpatialIndex
        {
            public Dictionary<(int, int), List<RoadSegment>> Segments = new Dictionary<(int, int), List<RoadSegment>>();
            public Dictionary<(int, int), List<RoadSegment>> Elevated = new Dictionary<(int, int), List<RoadSegment>>();
            public Dictionary<(int, int), List<Building>> Buildings = new Dictionary<(int, int), List<Building>>();
            public Dictionary<(int, int), List<NetworkEdge>> Roads = new Dictionary<(int, int), List<NetworkEdge>>();
            public int IndexedEdges;
            public List<NetworkNode> Quarters;
            public Dictionary<(int, int), double> LandHeights = new Dictionary<(int, int), double>();
        }
        static readonly ConditionalWeakTable<WorldDefinition, SpatialIndex> Indices = new ConditionalWeakTable<WorldDefinition, SpatialIndex>();
        const double Cell = 80;
        static (int, int) Key(double x, double z) => ((int)Math.Floor(x / Cell), (int)Math.Floor(z / Cell));
        static readonly List<Building> NoBuildings = new List<Building>();
        static readonly List<RoadSegment> NoSegments = new List<RoadSegment>();
        static readonly List<NetworkEdge> NoEdges = new List<NetworkEdge>();

        static void Buckets<T>(Dictionary<(int, int), List<T>> map, T item, double minX, double maxX, double minZ, double maxZ) where T : class
        {
            for (int x = (int)Math.Floor(minX / Cell); x <= (int)Math.Floor(maxX / Cell); x++)
                for (int z = (int)Math.Floor(minZ / Cell); z <= (int)Math.Floor(maxZ / Cell); z++)
                {
                    if (map.TryGetValue((x, z), out var list)) { if (!list.Contains(item)) list.Add(item); }
                    else map[(x, z)] = new List<T> { item };
                }
        }

        static bool CurrentMargin(string layout) => layout == "current-v2" || layout == "current-v3" || layout == "current-v4" || layout == "current-v5" || layout == "current-v6" || layout == "current-v7";

        static SpatialIndex IndexFor(WorldDefinition world)
        {
            if (!Indices.TryGetValue(world, out var index))
            {
                index = new SpatialIndex { Quarters = world.Nodes.Where(n => n.Id.Contains("-quarter-")).ToList() };
                double margin = CurrentMargin(world.LayoutVersion) ? 70 : 14;
                foreach (var b in world.Buildings)
                {
                    double halfWidth = b.Width / 2, halfDepth = b.Depth / 2;
                    if (b.FloorPlanProfile != null)
                    {
                        double c = Math.Abs(JsMath.Cos(b.Rotation)), s = Math.Abs(JsMath.Sin(b.Rotation));
                        halfWidth = (b.Width * c + b.Depth * s) / 2; halfDepth = (b.Width * s + b.Depth * c) / 2;
                    }
                    Buckets(index.Buildings, b, b.Position.X - halfWidth - margin, b.Position.X + halfWidth + margin, b.Position.Z - halfDepth - margin, b.Position.Z + halfDepth + margin);
                }
                Indices.Add(world, index);
            }
            while (index.IndexedEdges < world.Edges.Count)
            {
                var edge = world.Edges[index.IndexedEdges++];
                if (edge.Mode != "road" && edge.Mode != "bridge")
                {
                    if (edge.Mode == "maglev" || edge.Mode == "lightRail" || edge.Mode == "cable")
                        for (int i = 1; i < edge.Points.Count; i++) { Vec3 a = edge.Points[i - 1], b = edge.Points[i]; Buckets(index.Elevated, new RoadSegment { Edge = edge, A = a, B = b }, JsMath.Min(a.X, b.X) - 9, JsMath.Max(a.X, b.X) + 9, JsMath.Min(a.Z, b.Z) - 9, JsMath.Max(a.Z, b.Z) + 9); }
                    continue;
                }
                double margin = edge.Id.Contains("airport-runway-strip") ? 38 : 14;
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    Vec3 a = edge.Points[i - 1], b = edge.Points[i];
                    Buckets(index.Roads, edge, JsMath.Min(a.X, b.X) - margin, JsMath.Max(a.X, b.X) + margin, JsMath.Min(a.Z, b.Z) - margin, JsMath.Max(a.Z, b.Z) + margin);
                    Buckets(index.Segments, new RoadSegment { Edge = edge, A = a, B = b }, JsMath.Min(a.X, b.X) - margin, JsMath.Max(a.X, b.X) + margin, JsMath.Min(a.Z, b.Z) - margin, JsMath.Max(a.Z, b.Z) + margin);
                }
            }
            return index;
        }
        /// <summary>Drop cached spatial indices after a world's edges or buildings are replaced.</summary>
        public static void InvalidateIndex(WorldDefinition world) => Indices.Remove(world);

        struct Nearest { public double Distance, Y; }
        static Nearest NearestSegment(IReadOnlyList<Vec3> points, double x, double z)
        {
            var result = new Nearest { Distance = double.PositiveInfinity, Y = 0 };
            for (int i = 1; i < points.Count; i++)
            {
                Vec3 a = points[i - 1], b = points[i]; double dx = b.X - a.X, dz = b.Z - a.Z;
                double denominator = dx * dx + dz * dz; if (denominator == 0) denominator = 1;
                double t = Clamp(((x - a.X) * dx + (z - a.Z) * dz) / denominator, 0, 1);
                double d = JsMath.Hypot(x - a.X - dx * t, z - a.Z - dz * t);
                if (d < result.Distance - 1e-7) result = new Nearest { Distance = d, Y = a.Y + (b.Y - a.Y) * t };
            }
            return result;
        }
        static Nearest NearestSegment(Vec3 a, Vec3 b, double x, double z) => NearestSegment(new[] { a, b }, x, z);

        /// <summary>Smooth mountain massifs, interrupted by district terraces and riverbed.</summary>
        static double NaturalHeight(WorldDefinition world, double x, double z)
        {
            double y = 5;
            foreach (var m in world.Mountains) y += m.Height * JsMath.Exp(-2.7 * ((x - m.X) * (x - m.X) + (z - m.Z) * (z - m.Z)) / (m.Radius * m.Radius));
            y += JsMath.Sin(x / 160) * JsMath.Cos(z / 210) * 8 + JsMath.Sin((x + z) / 72) * 2.2;
            foreach (var district in world.Districts)
            {
                double r = JsMath.Hypot(x - district.Center.X, z - district.Center.Z);
                double blend = 1 - Smooth((r - district.Radius * .62) / (district.Radius * .68));
                y += (district.Center.Y - y) * blend;
            }
            var quarters = Indices.TryGetValue(world, out var index) ? index.Quarters : world.Nodes.Where(n => n.Id.Contains("-quarter-")).ToList();
            foreach (var quarter in quarters)
            {
                double r = JsMath.Hypot(x - quarter.Position.X, z - quarter.Position.Z);
                double blend = 1 - Smooth((r - 70) / 170);
                if (blend > 0) y += (quarter.Position.Y - .6 - y) * blend;
            }
            if (Math.Abs(x - world.Waterfall.Top.X) < 100 && z > -310 && z < 120)
            {
                double lip = 1 - Smooth((z + 85) / 135);
                double side = 1 - Smooth((Math.Abs(x - world.Waterfall.Top.X) - 25) / 75);
                double cliffY = world.Waterfall.Bottom.Y - 3 + (world.Waterfall.Top.Y - world.Waterfall.Bottom.Y + 3) * lip;
                y += (cliffY - y) * side;
            }
            var water = NearestSegment(world.River, x, z);
            double riverBlend = 1 - Smooth((water.Distance - 13) / 30);
            if (riverBlend > 0) y += (water.Y - 3 - y) * riverBlend;
            return JsMath.Max(2, y);
        }

        /// <summary>Read-only mountain sample for the render shell.</summary>
        public static double NaturalTerrainHeight(WorldDefinition world, double x, double z) => NaturalHeight(world, x, z);

        static double PlanningGroundHeight(WorldDefinition world, double x, double z, bool includeBasements, bool includeRoads = true)
        {
            var index = IndexFor(world);
            var buildings = index.Buildings.TryGetValue(Key(x, z), out var list) ? list : NoBuildings;
            foreach (var b in buildings) if (Math.Abs(x - b.Position.X) <= b.Width / 2 + 2 && Math.Abs(z - b.Position.Z) <= b.Depth / 2 + 2)
                {
                    if (includeBasements && (b.Basements ?? 0) != 0 && Math.Abs(x - b.Position.X) < b.Width / 2 - .8 && Math.Abs(z - b.Position.Z) < b.Depth / 2 - .8) return b.Position.Y - b.Basements.Value * b.Height / b.Floors - .6;
                    return b.Position.Y;
                }
            double y = NaturalHeight(world, x, z);
            double roadDistance = double.PositiveInfinity, roadY = y, roadWidth = 5;
            if (includeRoads && index.Segments.TryGetValue(Key(x, z), out var segments))
                foreach (var s in segments)
                {
                    if (s.Edge.Mode == "bridge" && s.Edge.From == "core-lift-top") continue;
                    if (s.Edge.Mode == "bridge" && NearestSegment(world.River, x, z).Distance < 25) continue;
                    var near = NearestSegment(s.A, s.B, x, z);
                    if (near.Distance < roadDistance - 1e-7) { roadDistance = near.Distance; roadY = near.Y - .6; roadWidth = s.Edge.Id.Contains("airport-runway-strip") ? 22 : 5; }
                }
            if (roadDistance < roadWidth + 14 && (roadWidth == 22 || roadY - y < 12) && NearestSegment(world.River, x, z).Distance > 20) y += (roadY - y) * (1 - Smooth((roadDistance - roadWidth) / 14));
            foreach (var b in buildings)
            {
                double dx = JsMath.Max(0, Math.Abs(x - b.Position.X) - b.Width / 2 - 2);
                double dz = JsMath.Max(0, Math.Abs(z - b.Position.Z) - b.Depth / 2 - 2);
                double outside = JsMath.Hypot(dx, dz);
                if (outside < 12) y += (b.Position.Y - y) * (1 - Smooth(outside / 12));
            }
            return y;
        }

        /// <summary>The hydraulic path shared by the visible sheet and solid terrain.</summary>
        public static List<Vec3> GetWaterfallPath(WorldDefinition world)
        {
            Vec3 top = world.Waterfall.Top, bottom = world.Waterfall.Bottom;
            return new List<Vec3> { top, new Vec3(top.X, top.Y, top.Z + 34), new Vec3(bottom.X, bottom.Y, top.Z + 44), bottom };
        }

        static double GeologicalRelief(double x, double z, double y, double seed)
        {
            double gx = (x * .81 + z * .5864) / 24, gz = (z * .81 - x * .5864) / 24;
            int ix = (int)Math.Floor(gx), iz = (int)Math.Floor(gz);
            int seed32 = JsMath.ToInt32(seed);
            double CellNoise(int a, int b, int salt)
            {
                unchecked
                {
                    int value = JsMath.Imul(a ^ seed32, 374761393) ^ JsMath.Imul(b ^ salt, 668265263);
                    value = JsMath.Imul(value ^ (int)((uint)value >> 13), 1274126177);
                    return (uint)(value ^ (int)((uint)value >> 16)) / 4294967296.0;
                }
            }
            double first = double.PositiveInfinity, second = double.PositiveInfinity, height = 0, phase = 0;
            for (int a = ix - 1; a <= ix + 1; a++) for (int b = iz - 1; b <= iz + 1; b++)
                {
                    double dx = gx - a - .25 - CellNoise(a, b, 37) * .5, dz = gz - b - .25 - CellNoise(a, b, 71) * .5;
                    double distance = dx * dx + dz * dz;
                    if (distance < first) { second = first; first = distance; height = 6 + CellNoise(a, b, 97) * 18; phase = CellNoise(a, b, 113) * 8; }
                    else if (distance < second) second = distance;
                }
            double jointWidth = (Math.Sqrt(second) - Math.Sqrt(first)) * 12;
            double cleft = 1 - Smooth(jointWidth / 2.6);
            double terrace = Math.Floor((y + phase) / 8) * 8 - phase - y;
            return height - (height + 10) * cleft + terrace * .75;
        }

        static bool ReliefLayout(string layout) => layout == "current-v3" || layout == "current-v4" || layout == "current-v5" || layout == "current-v6" || layout == "current-v7";

        /// <summary>Authoritative ground after the generated roads are fixed.</summary>
        public static double TerrainHeight(WorldDefinition world, double x, double z, bool includeBasements = true)
        {
            double y = PlanningGroundHeight(world, x, z, includeBasements);
            if (world.LayoutVersion == "legacy-ee3e7a1") return y;
            var index = IndexFor(world); var nearby = index.Buildings.TryGetValue(Key(x, z), out var list) ? list : NoBuildings;
            if (nearby.Any(b => Math.Abs(x - b.Position.X) <= b.Width / 2 + 2 && Math.Abs(z - b.Position.Z) <= b.Depth / 2 + 2)) return y;
            double roadGap = double.PositiveInfinity, foundationGap = double.PositiveInfinity, foundationY = y;
            var segments = index.Segments.TryGetValue(Key(x, z), out var segs) ? segs : NoSegments;
            foreach (var s in segments) roadGap = JsMath.Min(roadGap, NearestSegment(s.A, s.B, x, z).Distance);
            if (index.Elevated.TryGetValue(Key(x, z), out var elevated)) foreach (var s in elevated) roadGap = JsMath.Min(roadGap, NearestSegment(s.A, s.B, x, z).Distance);
            foreach (var b in nearby)
            {
                double dx = JsMath.Max(0, Math.Abs(x - b.Position.X) - b.Width / 2 - 2), dz = JsMath.Max(0, Math.Abs(z - b.Position.Z) - b.Depth / 2 - 2), gap = JsMath.Hypot(dx, dz);
                if (gap < foundationGap) { foundationGap = gap; foundationY = b.Position.Y; }
            }
            if (roadGap > 9 && foundationGap < 54) y += (foundationY - y) * (1 - Smooth(foundationGap / 54)) * .82;
            double reliefWeight = world.Buildings.Count > 0 ? Smooth((foundationGap - 10) / 38) * Smooth((roadGap - 12) / 20) * Smooth((y - 14) / 22) : 0;
            double fracture = JsMath.Sin(x * .036 + JsMath.Sin(z * .012) * 1.7) * JsMath.Cos(z * .027) * 3.2 + JsMath.Sin((x + z * .72) * .081) * 1.1;
            y += fracture * reliefWeight;
            if (ReliefLayout(world.LayoutVersion)) y += GeologicalRelief(x, z, y, world.Seed) * reliefWeight;
            if (roadGap < 9) foreach (var s in segments) if (s.Edge.Mode == "road" && !s.Edge.Id.Contains("runway"))
                    {
                        var near = NearestSegment(s.A, s.B, x, z);
                        if (near.Distance > 7) continue;
                        double valley = PlanningGroundHeight(world, x, z, includeBasements, false);
                        if (foundationGap < 54) valley += (foundationY - valley) * (1 - Smooth(foundationGap / 54)) * .82;
                        valley += fracture * Smooth((foundationGap - 10) / 38) * Smooth((valley - 14) / 22);
                        if (near.Y - valley > 12) y = JsMath.Min(y, valley);
                    }
            var water = NearestSegment(world.River, x, z); const double width = 15;
            if (water.Distance < width + 2) y = JsMath.Min(y, water.Y - 2.2 + JsMath.Max(0, water.Distance - width) * .5);
            Vec3 top = world.Waterfall.Top, bottom = world.Waterfall.Bottom; var profile = GetWaterfallPath(world);
            double poolDistance = JsMath.Hypot(x - bottom.X, z - bottom.Z);
            if (poolDistance < 50) y = JsMath.Min(y, bottom.Y - 2.4 + JsMath.Max(0, poolDistance - 42) * .25);
            for (int i = 1; i < profile.Count; i++)
            {
                Vec3 a = profile[i - 1], b = profile[i]; double dx = b.X - a.X, dz = b.Z - a.Z;
                double denominator = dx * dx + dz * dz; if (denominator == 0) denominator = 1;
                double projection = ((x - a.X) * dx + (z - a.Z) * dz) / denominator;
                if (projection < 0 || projection > 1) continue;
                var near = NearestSegment(a, b, x, z);
                double halfWidth = i == 1 ? world.Waterfall.Width / 2 + 2 : 92;
                if (near.Distance < halfWidth) y = JsMath.Min(y, near.Y - 3);
            }
            if (z > top.Z + 44 && z < 155 && Math.Abs(x - top.X) < 135)
            {
                double bank = Smooth((Math.Abs(x - top.X) - 92) / 43);
                y = JsMath.Min(y, bottom.Y - 3 + bank * JsMath.Max(0, y - bottom.Y + 3));
            }
            foreach (var s in segments) if (s.Edge.Mode == "bridge")
                {
                    var near = NearestSegment(s.A, s.B, x, z);
                    if (near.Distance < 6.6) y = JsMath.Min(y, near.Y - .8);
                }
            return y;
        }

        /// <summary>The floor/road surface, without a camera-eye offset.</summary>
        public static double GetWalkHeight(WorldDefinition world, double x, double z, double? referenceHeight = null)
        {
            var index = IndexFor(world);
            if (index.Buildings.TryGetValue(Key(x, z), out var buildings))
                foreach (var b in buildings)
                {
                    double halfWidth = b.Width / 2, halfDepth = b.Depth / 2;
                    if (b.FloorPlanProfile != null)
                    {
                        double c = Math.Abs(JsMath.Cos(b.Rotation)), s = Math.Abs(JsMath.Sin(b.Rotation));
                        halfWidth = (b.Width * c + b.Depth * s) / 2; halfDepth = (b.Width * s + b.Depth * c) / 2;
                    }
                    if (!(Math.Abs(x - b.Position.X) <= halfWidth && Math.Abs(z - b.Position.Z) <= halfDepth)) continue;
                    int floor = referenceHeight == null ? 0 : (int)Clamp(JsMath.Round((referenceHeight.Value - b.Position.Y - .6) / (b.Height / b.Floors)), -(b.Basements ?? 0), b.Floors - 1);
                    if (b.FloorPlanProfile != null)
                    {
                        var reference = new Vec3(x, referenceHeight ?? b.Position.Y + .6, z);
                        double? highest = ArchitectureFloorPlan.GetFloorPlanRoofSupport(b, reference, 0)?.Y;
                        for (int candidate = floor; candidate >= -(b.Basements ?? 0); candidate--)
                        {
                            var support = ArchitectureFloorPlan.FloorPlanSupport(b, candidate, reference, 0);
                            if (support != null && (referenceHeight == null || support.Y <= referenceHeight.Value + .6 + 1e-8)) highest = JsMath.Max(highest ?? double.NegativeInfinity, support.Y);
                        }
                        if (highest != null) return highest.Value;
                        continue;
                    }
                    var footprint = Access.GetFloorDimensions(b, floor);
                    if (Math.Abs(x - b.Position.X) <= footprint.Width / 2 && Math.Abs(z - b.Position.Z) <= footprint.Depth / 2) return b.Position.Y + .6 + floor * b.Height / b.Floors;
                }
            double nearest = double.PositiveInfinity, y = TerrainHeight(world, x, z);
            if (index.Roads.TryGetValue(Key(x, z), out var roads))
                foreach (var edge in roads)
                {
                    var point = NearestSegment(edge.Points, x, z);
                    double score = referenceHeight == null ? point.Distance : point.Distance + Math.Abs(point.Y - referenceHeight.Value) * 2;
                    if (point.Distance <= (edge.Id.Contains("airport-runway-strip") ? 22 : edge.Mode == "bridge" ? 4 : 5) && score < nearest) { nearest = score; y = point.Y; }
                }
            return y;
        }

        /// <summary>Progress is normalized by actual three-dimensional arc length.</summary>
        public static Vec3 SamplePolyline(IReadOnlyList<Vec3> points, double progress)
        {
            if (points.Count == 0) return new Vec3(0, 0, 0);
            if (points.Count == 1 || progress <= 0) return points[0].Copy();
            if (progress >= 1) return points[points.Count - 1].Copy();
            var lengths = new double[points.Count - 1]; double total = 0;
            for (int i = 0; i < lengths.Length; i++) { lengths[i] = Distance(points[i], points[i + 1]); }
            foreach (var l in lengths) total += l;
            double target = total * progress;
            for (int i = 0; i < lengths.Length; i++)
            {
                if (target <= lengths[i])
                {
                    Vec3 a = points[i], b = points[i + 1]; double t = lengths[i] != 0 ? target / lengths[i] : 0;
                    return new Vec3(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t);
                }
                target -= lengths[i];
            }
            return points[points.Count - 1].Copy();
        }

        static readonly Dictionary<string, (double, double, double)> Dimensions = new Dictionary<string, (double, double, double)>
        {
            ["home"] = (25, 22, 4), ["market"] = (32, 24, 2), ["workshop"] = (44, 32, 2), ["bank"] = (34, 30, 5), ["hall"] = (42, 34, 4), ["police"] = (34, 28, 3), ["school"] = (42, 32, 4), ["clinic"] = (36, 30, 5),
            ["station"] = (36, 24, 2), ["core"] = (84, 66, 16), ["pavilion"] = (24, 22, 2), ["airport"] = (76, 48, 4), ["starport"] = (90, 70, 7), ["farm"] = (36, 26, 1), ["dock"] = (36, 22, 2),
        };
        static readonly Dictionary<string, string> KindName = new Dictionary<string, string>
        {
            ["home"] = "里居", ["market"] = "商肆", ["workshop"] = "工坊", ["bank"] = "钱庄", ["hall"] = "议事堂", ["police"] = "巡警署", ["school"] = "书院", ["clinic"] = "医馆", ["station"] = "驿站",
            ["core"] = "瀑云能源天枢", ["pavilion"] = "观云亭", ["airport"] = "航站楼", ["starport"] = "星际候航殿", ["farm"] = "梯田农舍", ["dock"] = "渡口",
        };
        static readonly Dictionary<string, double> StoreyHeight = new Dictionary<string, double>
        {
            ["home"] = 3.4, ["market"] = 3.6, ["workshop"] = 4.8, ["bank"] = 4.4, ["hall"] = 4.2, ["police"] = 3.8, ["school"] = 3.8, ["clinic"] = 3.8, ["station"] = 4.2, ["core"] = 7.8,
            ["pavilion"] = 12.8, ["airport"] = 6, ["starport"] = 6.6, ["farm"] = 3.6, ["dock"] = 3.8,
        };

        sealed class Civic
        {
            public string Id, Name, Kind, Facility, RequiredPermission; public double X, Z, Y;
            public double? Width, Depth, Height; public int? Floors, PublicFloors;
        }
        static readonly Civic[] CivicPlan =
        {
            new Civic { Id = "core-main", Name = "天枢阁", Kind = "core", X = 430, Z = -250, Y = 254, Width = 144, Depth = 112, Height = 234, Floors = 30, Facility = "mayor", PublicFloors = 3, RequiredPermission = "mayor" },
            new Civic { Id = "core-admin-east", Name = "天枢东翼·行政政务院", Kind = "hall", X = 560, Z = -250, Y = 254, Width = 60, Depth = 42, Height = 48, Floors = 8, Facility = "administration", PublicFloors = 2, RequiredPermission = "official" },
            new Civic { Id = "core-data-west", Name = "天枢西翼·数据通讯院", Kind = "workshop", X = 300, Z = -250, Y = 254, Width = 60, Depth = 42, Height = 48, Floors = 8, Facility = "data", PublicFloors = 1, RequiredPermission = "scientist" },
            new Civic { Id = "core-energy-south", Name = "天枢南翼·能源调度院", Kind = "workshop", X = 430, Z = -30, Y = 254, Width = 60, Depth = 42, Height = 48, Floors = 8, Facility = "energy", PublicFloors = 1, RequiredPermission = "driver" },
            new Civic { Id = "core-security-north", Name = "天枢北翼·应急治安院", Kind = "police", X = 430, Z = -370, Y = 254, Width = 60, Depth = 42, Height = 48, Floors = 8, Facility = "emergency", PublicFloors = 1, RequiredPermission = "police" },
            new Civic { Id = "core-council", Name = "天枢议事堂", Kind = "hall", X = 270, Z = -80, Y = 254, Width = 72, Depth = 50, Height = 42, Floors = 7, Facility = "council", PublicFloors = 2, RequiredPermission = "council" },
            new Civic { Id = "core-embassy", Name = "云山使节馆", Kind = "hall", X = 600, Z = -80, Y = 254, Width = 60, Depth = 42, Height = 42, Floors = 7, Facility = "embassy", PublicFloors = 2, RequiredPermission = "official" },
            new Civic { Id = "core-archives", Name = "天枢下层·城史档案馆", Kind = "hall", X = 300, Z = -380, Y = 246, Width = 50, Depth = 38, Height = 30, Floors = 5, Facility = "archives", PublicFloors = 1, RequiredPermission = "teacher" },
            new Civic { Id = "core-treasury", Name = "天枢下层·公共金库", Kind = "bank", X = 560, Z = -380, Y = 246, Width = 50, Depth = 38, Height = 30, Floors = 5, Facility = "treasury", PublicFloors = 1, RequiredPermission = "mayor" },
            new Civic { Id = "core-interchange", Name = "天枢轨道换乘殿", Kind = "station", X = 675, Z = -130, Y = 254, Width = 60, Depth = 40, Height = 36, Floors = 6 },
            new Civic { Id = "core-clinic", Name = "天枢急救医馆", Kind = "clinic", X = 685, Z = -270, Y = 254, Width = 50, Depth = 42, Height = 36, Floors = 6 },
            new Civic { Id = "core-dock-building", Name = "瀑云潭·天枢水运码头", Kind = "dock", X = 125, Z = 155, Y = 93.4 },
        };

        sealed class OpenItem { public int X, Z; public double F, G; }

        /// <summary>Orthogonal obstacle routing keeps every connector outside all building walls.</summary>
        static List<Vec3> RouteGround(WorldDefinition world, Vec3 start, Vec3 end, Building startBuilding = null, double clearance = 5)
        {
            const double Grid = 8;
            var first = startBuilding != null ? new Vec3(start.X, start.Y, Q(start.Z + 10)) : start;
            int sx = (int)JsMath.Round(first.X / Grid), sz = (int)JsMath.Round(first.Z / Grid);
            int tx = (int)JsMath.Round(end.X / Grid), tz = (int)JsMath.Round(end.Z / Grid);
            var startKey = (sx, sz); var targetKey = (tx, tz);
            var blockedCache = new Dictionary<(int, int), bool>();
            var land = IndexFor(world).LandHeights;
            double vx = end.X - start.X, vz = end.Z - start.Z, projectedLength = vx * vx + vz * vz; if (projectedLength == 0) projectedLength = 1;
            bool Blocked(int x, int z)
            {
                if (blockedCache.TryGetValue((x, z), out var cached)) return cached;
                double px = x * Grid, pz = z * Grid;
                bool result = IndexFor(world).Buildings.TryGetValue(Key(px, pz), out var bs) && bs.Any(b => Math.Abs(px - b.Position.X) < b.Width / 2 + 5 && Math.Abs(pz - b.Position.Z) < b.Depth / 2 + 5);
                blockedCache[(x, z)] = result; return result;
            }
            var open = new List<OpenItem> { new OpenItem { X = sx, Z = sz, F = 0, G = 0 } };
            var cost = new Dictionary<(int, int), double> { [startKey] = 0 }; var previous = new Dictionary<(int, int), (int, int)>();
            bool found = false;
            OpenItem Pop()
            {
                var root = open[0]; var last = open[open.Count - 1]; open.RemoveAt(open.Count - 1);
                if (open.Count > 0)
                {
                    open[0] = last; int i = 0;
                    while (true)
                    {
                        int l = i * 2 + 1, r = l + 1, child = i;
                        if (l < open.Count && open[l].F < open[child].F) child = l;
                        if (r < open.Count && open[r].F < open[child].F) child = r;
                        if (child == i) break;
                        var tmp = open[i]; open[i] = open[child]; open[child] = tmp; i = child;
                    }
                }
                return root;
            }
            void Push(OpenItem item)
            {
                open.Add(item); int i = open.Count - 1;
                while (i > 0) { int p = (i - 1) >> 1; if (open[p].F <= item.F) break; open[i] = open[p]; i = p; }
                open[i] = item;
            }
            var dirs = new[] { (1, 0), (-1, 0), (0, 1), (0, -1) };
            while (open.Count > 0 && cost.Count < 90000)
            {
                var current = Pop(); var id = (current.X, current.Z);
                if (current.G != cost[id]) continue;
                if (id == targetKey) { found = true; break; }
                foreach (var (dx, dz) in dirs)
                {
                    int x = current.X + dx, z = current.Z + dz; var next = (x, z);
                    if (Math.Abs(x * Grid) > world.Size / 2 || Math.Abs(z * Grid) > world.Size / 2 || (next != targetKey && Blocked(x, z))) continue;
                    if (!land.TryGetValue(next, out var originalGround)) { originalGround = NaturalHeight(world, x * Grid, z * Grid); land[next] = originalGround; }
                    double projection = Clamp(((x * Grid - start.X) * vx + (z * Grid - start.Z) * vz) / projectedLength, 0, 1);
                    double plannedGrade = start.Y + (end.Y - start.Y) * projection;
                    double terrainCost = JsMath.Min(200, Math.Abs(originalGround + .6 - plannedGrade)) * .35;
                    double enclosureCost = 0;
                    if (clearance > 5)
                    {
                        double px = x * Grid, pz = z * Grid;
                        if (IndexFor(world).Buildings.TryGetValue(Key(px, pz), out var bs))
                            foreach (var b in bs)
                            {
                                double gap = JsMath.Max(Math.Abs(px - b.Position.X) - b.Width / 2, Math.Abs(pz - b.Position.Z) - b.Depth / 2);
                                enclosureCost = JsMath.Max(enclosureCost, JsMath.Max(0, clearance - gap) * 8);
                            }
                    }
                    double g = current.G + Grid + terrainCost + enclosureCost;
                    if (g >= (cost.TryGetValue(next, out var known) ? known : double.PositiveInfinity)) continue;
                    cost[next] = g; previous[next] = id; Push(new OpenItem { X = x, Z = z, G = g, F = g + (Math.Abs(x - tx) + Math.Abs(z - tz)) * Grid });
                }
            }
            if (!found) throw new InvalidOperationException($"No safe street route from ({JsMath.ToJsString(start.X)},{JsMath.ToJsString(start.Z)}) to ({JsMath.ToJsString(end.X)},{JsMath.ToJsString(end.Z)})");
            var reversed = new List<(int, int)> { targetKey }; while (reversed[reversed.Count - 1] != startKey) reversed.Add(previous[reversed[reversed.Count - 1]]);
            reversed.Reverse();
            var path = reversed.Select(k => new Vec3(k.Item1 * Grid, 0, k.Item2 * Grid)).ToList();
            var points = new List<Vec3> { start };
            if (startBuilding != null) points.Add(new Vec3(start.X, start.Y, sz * Grid));
            points.AddRange(path); points.Add(end);
            var simplified = new List<Vec3>();
            foreach (var point in points)
            {
                if (simplified.Count > 0 && JsMath.Hypot(point.X - simplified[simplified.Count - 1].X, point.Z - simplified[simplified.Count - 1].Z) < .01) continue;
                if (simplified.Count > 1)
                {
                    Vec3 a = simplified[simplified.Count - 2], b = simplified[simplified.Count - 1];
                    if ((b.X - a.X) * (point.Z - b.Z) == (b.Z - a.Z) * (point.X - b.X) && (b.X - a.X) * (point.X - b.X) + (b.Z - a.Z) * (point.Z - b.Z) > 0) simplified.RemoveAt(simplified.Count - 1);
                }
                simplified.Add(point);
            }
            var dense = new List<Vec3>();
            for (int i = 1; i < simplified.Count; i++)
            {
                Vec3 a = simplified[i - 1], b = simplified[i]; int steps = (int)JsMath.Max(1, Math.Ceiling(JsMath.Hypot(a.X - b.X, a.Z - b.Z) / 24));
                for (int j = i == 1 ? 0 : 1; j <= steps; j++) { double t = (double)j / steps; dense.Add(new Vec3(Q(a.X + (b.X - a.X) * t), 0, Q(a.Z + (b.Z - a.Z) * t))); }
            }
            for (int i = dense.Count - 2; i > 0; i--)
                if (JsMath.Hypot(dense[i].X - dense[i + 1].X, dense[i].Z - dense[i + 1].Z) < 3 || JsMath.Hypot(dense[i].X - dense[i - 1].X, dense[i].Z - dense[i - 1].Z) < 3) dense.RemoveAt(i);
            var cumulative = new List<double> { 0 };
            for (int i = 1; i < dense.Count; i++) cumulative.Add(cumulative[i - 1] + JsMath.Hypot(dense[i].X - dense[i - 1].X, dense[i].Z - dense[i - 1].Z));
            double length = cumulative[cumulative.Count - 1];
            for (int i = 0; i < dense.Count; i++) dense[i].Y = Q(start.Y + (end.Y - start.Y) * (length != 0 ? cumulative[i] / length : 0));
            dense[0] = start.Copy(); dense[dense.Count - 1] = end.Copy();
            return dense;
        }

        public static WorldDefinition CreateWorld(double seed = 20261001, string layoutVersion = CurrentCityLayout)
        {
            if (Array.IndexOf(CityLayoutVersions, layoutVersion) < 0) throw new ArgumentException("Unknown city layout version");
            if (layoutVersion == "current-v7") throw new NotSupportedException("current-v7 (market station apron) is not ported yet");
            if (layoutVersion == "current-v6")
            {
                var v5 = CreateWorld(seed, "current-v5");
                CommercialDistrict.Apply(v5);
                v5.LayoutVersion = "current-v6";
                InvalidateIndex(v5);
                return v5;
            }
            bool currentLayout = layoutVersion != "legacy-ee3e7a1", historicR5 = layoutVersion == "current-v2-r5";
            var rng = Random(seed);
            var world = new WorldDefinition
            {
                LayoutVersion = historicR5 ? "current-v2" : layoutVersion, Seed = seed, VoxelSize = Unit, Size = 4400,
                Districts = Plans.Select(p => new District { Id = p.Id, Name = p.Name, Kind = p.Kind, Center = new Vec3(p.X, p.Y, p.Z), Radius = p.Radius, Color = p.Color, Population = p.Count * 38 }).ToList(),
                Mountains = new List<Mountain>
                {
                    new Mountain(-60, -1300, 505, 650), new Mountain(-1170, -540, 300, 600), new Mountain(590, -760, 290, 590), new Mountain(1360, -1250, 345, 560),
                    new Mountain(-1400, 260, 180, 540), new Mountain(1140, -180, 175, 560), new Mountain(-1690, -1730, 510, 570), new Mountain(700, -2040, 590, 520),
                    new Mountain(1930, -560, 400, 420), new Mountain(-2010, 690, 270, 460),
                },
                Spawn = new Vec3(-330, 52.6, 487),
                Waterfall = new Waterfall { Top = new Vec3(110, 256, -105), Bottom = new Vec3(110, 103, 35), Width = 24 },
                River = new List<Vec3> { new Vec3(110, 103, 35), new Vec3(75, 94, 140), new Vec3(-65, 75, 260), new Vec3(-110, 56, 460), new Vec3(-410, 30, 720), new Vec3(-580, 15, 1010), new Vec3(-480, 10, 1300), new Vec3(-850, 8, 1900), new Vec3(-750, 6, 2200) },
            };
            var buildingAnchors = new Dictionary<string, NetworkNode>();
            var quarters = new OrderedMap<string, List<NetworkNode>>();
            var quarterOffsets = new Dictionary<string, double[][]>
            {
                ["river"] = new[] { new double[] { -190, -110, 6 }, new double[] { -190, 170, -2 }, new double[] { 70, -200, 12 }, new double[] { 170, 190, 0 } },
                ["market"] = new[] { new double[] { -210, -115, 18 }, new double[] { -180, 190, -10 }, new double[] { 160, -175, 26 }, new double[] { 120, 205, -16 } },
                ["workshop"] = new[] { new double[] { -215, -145, 28 }, new double[] { -220, 155, -20 }, new double[] { 180, -130, 18 }, new double[] { 150, 205, -30 } },
                ["west"] = new[] { new double[] { -210, -170, 42 }, new double[] { -240, 110, 18 }, new double[] { 195, -110, 4 }, new double[] { 120, 235, -32 } },
                ["academy"] = new[] { new double[] { -190, -145, 22 }, new double[] { -170, 150, -8 }, new double[] { 170, -135, 32 }, new double[] { 155, 190, -22 } },
                ["government"] = new[] { new double[] { -160, -145, 32 }, new double[] { -150, 170, -24 }, new double[] { 180, -160, 20 }, new double[] { 215, 130, -34 } },
                ["core"] = new[] { new double[] { -170, 195, -16 }, new double[] { 320, 120, -20 }, new double[] { -130, -480, 40 }, new double[] { 300, -450, 44 } },
                ["summit"] = new[] { new double[] { -160, -75, 12 }, new double[] { -140, 165, -32 }, new double[] { 150, -120, 8 }, new double[] { 155, 140, -26 } },
                ["east"] = new[] { new double[] { -190, -190, 34 }, new double[] { -190, 155, -22 }, new double[] { 230, -95, 42 }, new double[] { 185, 205, -28 } },
                ["airport"] = new[] { new double[] { -220, -150, 0 }, new double[] { -210, 165, 0 }, new double[] { 210, -155, 0 }, new double[] { 205, 180, 0 } },
                ["starport"] = new[] { new double[] { -170, -180, 20 }, new double[] { -205, 145, -26 }, new double[] { 205, -130, 34 }, new double[] { 180, 185, -18 } },
            };
            foreach (var p in Plans)
            {
                world.Nodes.Add(new NetworkNode { Id = p.Id + "-station", DistrictId = p.Id, Name = p.Name + "站", Position = new Vec3(p.X, p.Y + .6, p.Z), Station = true });
                var names = p.Kind == "residential" ? new[] { "松庭里", "云阶里", "望山坊", "水月坊" } : p.Id == "market" ? new[] { "钱庄街", "灯市街", "云锦街", "百味街" } : p.Id == "workshop" ? new[] { "铸造院", "木作院", "制造院", "工匠里" } : new[] { "北岭院", "西溪院", "东岚院", "南坡院" };
                var local = quarterOffsets[p.Id].Select((o, i) => new NetworkNode { Id = $"{p.Id}-quarter-{i}", DistrictId = p.Id, Name = $"{p.Name}·{names[i]}驿", Position = new Vec3(p.X + o[0], Q(JsMath.Max(8, p.Y + o[2]) + .6), p.Z + o[1]), Station = true }).ToList();
                world.Nodes.AddRange(local); quarters.Set(p.Id, local);
            }
            bool Intersects(double x, double z, double width, double depth, double otherX, double otherZ, double otherWidth, double otherDepth, double margin = 16) =>
                Math.Abs(otherX - x) < (otherWidth + width) / 2 + margin && Math.Abs(otherZ - z) < (otherDepth + depth) / 2 + margin;
            bool SafeSite(double x, double z, double width, double depth)
            {
                if (Math.Abs(x) + width / 2 > 2120 || Math.Abs(z) + depth / 2 > 2120) return false;
                if (z + depth / 2 > 1435 && z - depth / 2 < 1545 && x + width / 2 > 650 && x - width / 2 < 1730) return false;
                if (NearestSegment(world.River, x, z).Distance < JsMath.Hypot(width, depth) / 2 + 30) return false;
                if (currentLayout && Math.Abs(x - world.Waterfall.Top.X) < width / 2 + 135 && z + depth / 2 > world.Waterfall.Top.Z - 20 && z - depth / 2 < 155) return false;
                if (world.Nodes.Any(n => Intersects(x, z, width, depth, n.Position.X, n.Position.Z, 42, 42, 4))) return false;
                if (CivicPlan.Any(c => Intersects(x, z, width, depth, c.X, c.Z, c.Width ?? 36, c.Depth ?? 24))) return false;
                return !world.Buildings.Any(b => Intersects(x, z, width, depth, b.Position.X, b.Position.Z, b.Width, b.Depth)
                    || Intersects(x, z, width, depth, b.Door.X, b.Door.Z + 12, 14, 24, 2)
                    || Intersects(x, z + depth / 2 + 12, 14, 24, b.Position.X, b.Position.Z, b.Width, b.Depth, 2));
            }
            for (int districtIndex = 0; districtIndex < Plans.Length; districtIndex++)
            {
                var p = Plans[districtIndex]; var localStops = quarters.GetOrDefault(p.Id);
                for (int i = 0; i < p.Count; i++)
                {
                    var civic = p.Id == "core" && i < CivicPlan.Length ? CivicPlan[i] : null;
                    int localIndex = p.Id == "core" ? Math.Max(0, i - CivicPlan.Length) : i;
                    int quarter = localIndex % localStops.Count, within = localIndex / localStops.Count; var anchor = localStops[quarter];
                    int ring = within / 6; double angle = within % 6 / 6.0 * JsMath.PI * 2 + districtIndex * .31 + quarter * .63 + ring * .45;
                    string kind = p.Kinds[(within + quarter) % p.Kinds.Length];
                    if (i == 0 && p.Id == "summit") kind = "pavilion";
                    if (i == 0 && p.Id == "airport") kind = "airport";
                    if (i == 0 && p.Id == "starport") kind = "starport";
                    if (civic != null) kind = civic.Kind;
                    var dim = Dimensions[kind];
                    double designWidth = dim.Item1, designDepth = dim.Item2; int floors = (int)dim.Item3;
                    if (kind == "home") { designWidth = new double[] { 42, 30, 36, 32 }[quarter]; designDepth = new double[] { 34, 26, 30, 28 }[quarter]; floors = new[] { 4, 8, 12, 6 }[quarter] + within % 3 - 1; }
                    if (kind == "market") { designWidth = quarter == 0 ? 44 : 34; designDepth = quarter == 0 ? 34 : 28; floors = 2 + within % 3; }
                    if (kind == "bank") { designWidth = 44; designDepth = 36; floors = p.Id == "market" ? 12 + within % 4 : 7 + within % 3; }
                    if (kind == "workshop") { designWidth = 54; designDepth = 42; floors = 3 + within % 3; }
                    if (kind == "school") { designWidth = 62; designDepth = 46; floors = 5 + within % 2; }
                    if (kind == "clinic") { designWidth = 50; designDepth = 38; floors = 7 + within % 3; }
                    if (kind == "hall") { designWidth = 56; designDepth = 42; floors = 6 + within % 3; }
                    if (kind == "police") { designWidth = 42; designDepth = 34; floors = 5; }
                    if (kind == "station") { designWidth = 44; designDepth = 32; floors = 3; }
                    if (kind == "airport") { designWidth = 120; designDepth = 70; floors = 6; }
                    if (kind == "starport") { designWidth = 130; designDepth = 90; floors = 14; }
                    if (kind == "pavilion") floors = 1;
                    double width = civic?.Width ?? JsMath.Round(designWidth * (.94 + rng() * .12) / .4) * .4;
                    double depth = civic?.Depth ?? JsMath.Round(designDepth * (.94 + rng() * .12) / .4) * .4;
                    if (civic?.Floors != null) floors = civic.Floors.Value;
                    double baseRadius = 88 + ring * 64;
                    double x = Q(anchor.Position.X + JsMath.Cos(angle) * baseRadius), z = Q(anchor.Position.Z + JsMath.Sin(angle) * baseRadius);
                    bool placed = false;
                    if (civic != null) { x = civic.X; z = civic.Z; placed = true; }
                    else if (i == 0 && (p.Id == "summit" || p.Id == "airport" || p.Id == "starport"))
                    {
                        x = p.X; z = p.Z - (p.Id == "summit" ? 105 : 115);
                        placed = SafeSite(x, z, width, depth);
                    }
                    if (!placed) for (int attempt = 0; attempt < 300; attempt++)
                        {
                            double r = baseRadius + attempt / 12 * 11;
                            double theta = angle + ((attempt % 12) - 5) * .19;
                            x = Q(anchor.Position.X + JsMath.Cos(theta) * r); z = Q(anchor.Position.Z + JsMath.Sin(theta) * r);
                            if (SafeSite(x, z, width, depth)) { placed = true; break; }
                        }
                    if (!placed) throw new InvalidOperationException($"No buildable site for {p.Id}/{i}");
                    double terrace = ring * 4 + JsMath.Round(JsMath.Sin(angle)) * 2;
                    double ground = NaturalHeight(world, x, z);
                    double terraceTarget = anchor.Position.Y - .6 + (p.Id == "airport" ? 0 : terrace);
                    double y = Q(civic != null ? civic.Y : Clamp(terraceTarget, ground - 8, ground + 14));
                    double targetHeight = civic?.Height ?? (currentLayout ? floors * StoreyHeight[kind]
                        : floors * (kind == "bank" ? 4.8 : kind == "hall" ? 5.2 : kind == "airport" ? 6 : kind == "starport" ? 6.6 : 4) + (kind == "pavilion" ? 8 : 4.8 + within % 3 * 1.6));
                    double height = Q(JsMath.Round(targetHeight / floors / Unit) * Unit * floors);
                    string anchorPart = anchor.Name.Split('·')[1]; int stationMark = anchorPart.IndexOf('驿', StringComparison.Ordinal);
                    if (stationMark >= 0) anchorPart = anchorPart.Remove(stationMark, 1);
                    var building = new Building
                    {
                        Id = civic?.Id ?? $"{p.Id}-b{i}", DistrictId = p.Id, Name = civic?.Name ?? $"{p.Name}·{anchorPart}·{KindName[kind]}{within + 1}", Kind = kind,
                        Position = new Vec3(x, y, z), Width = width, Depth = depth, Height = height, Floors = floors, Rotation = 0, Door = new Vec3(x, Q(y + .6), Q(z + depth / 2)),
                        Capacity = floors * Math.Floor(width * depth / 32),
                    };
                    building.Seed = Math.Floor(rng() * 0x7FFFFFFF);
                    if (civic?.Facility != null)
                    {
                        building.Facility = civic.Facility; building.PublicFloors = civic.PublicFloors; building.RequiredPermission = civic.RequiredPermission;
                        var nameParts = civic.Name.Split('·');
                        building.FloorUses = Enumerable.Range(0, floors).Select(f => f < civic.PublicFloors ? "公共服务与展览" : nameParts.Length > 1 ? nameParts[1] : "市政办公").ToList();
                        building.FloorPermissions = Enumerable.Range(0, floors).Select(f => f < civic.PublicFloors ? "public" : civic.RequiredPermission).ToList();
                    }
                    if (kind == "core")
                    {
                        building.Basements = 2;
                        building.BasementUses = new List<string> { "城史档案、城市数据保管与机密设施", "公共金库与财政储备" };
                        building.FloorUses = new List<string> { "市民接待大厅", "政务公开与办事大厅", "城市博物馆与瀑布展廊", "城市行政协调", "土地与建设管理", "公共交通调度", "能源调度", "环境与水务", "教育与公共文化", "医疗与福利", "城市数据中心", "通讯与信息网络", "科学研究协调", "公共财政", "贸易与公司监管", "法务与行政监察", "应急指挥", "治安统筹", "灾害应对", "议会听证", "议会议事", "政策研究", "城市规划", "使节接待", "公务协调", "市长事务厅", "市长决策厅", "全城指挥厅", "市政成就展览", "云山全景观景台" };
                        building.FloorPermissions = new List<string> { "public", "public", "public", "official", "official", "driver", "driver", "scientist", "teacher", "official", "scientist", "scientist", "scientist", "official", "official", "official", "police", "police", "police", "public", "council", "council", "official", "official", "official", "mayor", "mayor", "mayor", "public", "public" };
                        var tiers = new[] { (144.0, 112.0), (126.0, 98.0), (108.0, 84.0), (90.0, 70.0), (72.0, 56.0) };
                        building.FloorFootprints = Enumerable.Range(0, floors).Select(floor => new Footprint(tiers[floor / 6].Item1, tiers[floor / 6].Item2)).ToList();
                    }
                    if (layoutVersion == "current-v5") building.StairGeometryRevision = 2;
                    if ((layoutVersion == "current-v4" || layoutVersion == "current-v5") && kind != "core" && kind != "pavilion")
                    {
                        building.FloorPlanProfile = ArchitectureFloorPlan.Profile;
                        var entrance = ArchitectureFloorPlan.GetBuildingEntrance(building);
                        building.Door = new Vec3(Q(entrance.X), Q(entrance.Y), Q(entrance.Z));
                        building.FunctionPoints = Enumerable.Range(0, floors).SelectMany(floor => ArchitectureFloorPlan.GetBuildingUsePoints(building, floor)).ToList();
                    }
                    world.Buildings.Add(building);
                    if (civic == null)
                    {
                        var reachable = world.Nodes.Where(n => n.Station && Math.Abs(n.Position.Y - building.Door.Y) <= JsMath.Hypot(n.Position.X - building.Door.X, n.Position.Z - building.Door.Z) * .18).ToList();
                        var attachment = reachable.Count > 0 ? reachable[0] : anchor;
                        foreach (var n in reachable) if (Distance(n.Position, building.Door) < Distance(attachment.Position, building.Door)) attachment = n;
                        buildingAnchors[building.Id] = attachment;
                    }
                }
            }
            void AddEdge(string from, string to, string mode, List<Vec3> points, double capacity = 100)
            {
                double length = 0; for (int i = 1; i < points.Count; i++) length += Distance(points[i - 1], points[i]);
                world.Edges.Add(new NetworkEdge { Id = $"{mode}-{from}-{to}", From = from, To = to, Mode = mode, Points = points, Length = length, Capacity = capacity });
            }
            NetworkNode Station(string id) => world.Nodes.First(n => n.Id == id + "-station");
            var liftBottom = new NetworkNode { Id = "core-lift-bottom", DistrictId = "core", Name = "天枢崖底升降站", Position = new Vec3(140, 103.6, 35), Station = true };
            var liftTop = new NetworkNode { Id = "core-lift-top", DistrictId = "core", Name = "天枢上层升降站", Position = new Vec3(140, 254.6, 35), Station = true };
            world.Nodes.Add(liftBottom); world.Nodes.Add(liftTop);
            var trunks = new[] { ("river", "market"), ("market", "workshop"), ("workshop", "west"), ("west", "academy"), ("market", "academy"), ("academy", "core"), ("core", "government"), ("government", "summit"), ("core", "east"), ("east", "airport"), ("east", "starport"), ("government", "starport") };
            foreach (var (a, b) in trunks) AddEdge(Station(a).Id, Station(b).Id, "road", RouteGround(world, Station(a).Position, Station(b).Position), 220);
            foreach (var stops in quarters.Values) foreach (var stop in stops) AddEdge(stop.Id, Station(stop.DistrictId).Id, "road", RouteGround(world, stop.Position, Station(stop.DistrictId).Position), 90);
            foreach (var b in world.Buildings.ToList())
            {
                var node = new NetworkNode { Id = b.Id + "-door", DistrictId = b.DistrictId, Name = b.Name, Position = b.Door.Copy(), Station = false }; world.Nodes.Add(node);
                var destination = b.Id == "core-dock-building" ? liftBottom : buildingAnchors.TryGetValue(b.Id, out var anchorNode) ? anchorNode : Station(b.DistrictId);
                AddEdge(node.Id, destination.Id, "road", RouteGround(world, node.Position, destination.Position, b), 30);
            }
            void StationApronGrade(List<Vec3> points, bool atStart, double desiredFlat)
            {
                var cumulative = new List<double> { 0 }; for (int i = 1; i < points.Count; i++) cumulative.Add(cumulative[i - 1] + JsMath.Hypot(points[i].X - points[i - 1].X, points[i].Z - points[i - 1].Z));
                double total = cumulative[cumulative.Count - 1], apron = atStart ? points[0].Y : points[points.Count - 1].Y, outer = atStart ? points[points.Count - 1].Y : points[0].Y;
                double flat = JsMath.Min(desiredFlat, JsMath.Max(0, total - Math.Abs(outer - apron) / .2 - 6));
                double transition = atStart ? flat : total - flat;
                for (int i = 1; !historicR5 && i < points.Count; i++) if (transition > cumulative[i - 1] + .5 && transition < cumulative[i] - .5)
                    {
                        Vec3 a = points[i - 1], b = points[i]; double t = (transition - cumulative[i - 1]) / (cumulative[i] - cumulative[i - 1]);
                        points.Insert(i, new Vec3(Q(a.X + (b.X - a.X) * t), apron, Q(a.Z + (b.Z - a.Z) * t)));
                        cumulative.Insert(i, transition); break;
                    }
                for (int i = 0; i < points.Count; i++)
                {
                    double fromApron = atStart ? cumulative[i] : total - cumulative[i];
                    points[i].Y = Q(apron + (outer - apron) * Clamp((fromApron - flat) / JsMath.Max(.01, total - flat), 0, 1));
                }
            }
            if (currentLayout) foreach (var edge in world.Edges) if (edge.Mode == "road" && (edge.From == "river-station" || edge.To == "river-station"))
                    {
                        StationApronGrade(edge.Points, edge.From == "river-station", 64);
                        double sum = 0; for (int i = 1; i < edge.Points.Count; i++) sum += Distance(edge.Points[i - 1], edge.Points[i]); edge.Length = sum;
                    }
            if (currentLayout && !historicR5) InvalidateIndex(world);
            void Elevated(string aId, string bId, string mode, double lift)
            {
                NetworkNode from = Station(aId), to = Station(bId); Vec3 start = from.Position, end = to.Position;
                var routed = mode == "cable" ? new List<Vec3> { start.Copy(), end.Copy() } : RouteGround(world, start, end);
                var ground = new List<Vec3>();
                for (int i = 1; i < routed.Count; i++)
                {
                    Vec3 a = routed[i - 1], b = routed[i]; int samples = (int)JsMath.Max(1, Math.Ceiling(JsMath.Hypot(a.X - b.X, a.Z - b.Z) / 4));
                    for (int j = i == 1 ? 0 : 1; j <= samples; j++) ground.Add(new Vec3(Q(a.X + (b.X - a.X) * j / samples), 0, Q(a.Z + (b.Z - a.Z) * j / samples)));
                }
                var cumulative = new List<double> { 0 };
                for (int i = 1; i < ground.Count; i++) cumulative.Add(cumulative[i - 1] + JsMath.Hypot(ground[i].X - ground[i - 1].X, ground[i].Z - ground[i - 1].Z));
                double total = cumulative[cumulative.Count - 1];
                var points = ground.Select((p, i) =>
                {
                    double t = cumulative[i] / total, stationBlend = JsMath.Min(JsMath.Min(1, cumulative[i] / 32), (total - cumulative[i]) / 32);
                    double minimum = PlanningGroundHeight(world, p.X, p.Z, true) + 14 * stationBlend;
                    if (mode == "cable" && IndexFor(world).Buildings.TryGetValue(Key(p.X, p.Z), out var bs))
                        foreach (var building in bs) if (Math.Abs(p.X - building.Position.X) < building.Width / 2 + 6 && Math.Abs(p.Z - building.Position.Z) < building.Depth / 2 + 6) minimum = JsMath.Max(minimum, building.Position.Y + building.Height + 12);
                    return new Vec3(p.X, Q(JsMath.Max(start.Y + (end.Y - start.Y) * t + JsMath.Sin(JsMath.PI * t) * lift, minimum)), p.Z);
                }).ToList();
                for (int i = 1; i < points.Count; i++)
                {
                    Vec3 a = points[i - 1], b = points[i]; int samples = (int)JsMath.Max(1, Math.Ceiling(JsMath.Hypot(a.X - b.X, a.Z - b.Z)));
                    double ceiling = double.NegativeInfinity;
                    for (int j = 0; j <= samples; j++)
                    {
                        double x = a.X + (b.X - a.X) * j / samples, z = a.Z + (b.Z - a.Z) * j / samples;
                        ceiling = JsMath.Max(ceiling, PlanningGroundHeight(world, x, z, true) + 8);
                    }
                    if (i > 1) a.Y = Q(JsMath.Max(a.Y, ceiling));
                    if (i < points.Count - 1) b.Y = Q(JsMath.Max(b.Y, ceiling));
                }
                points[0] = start.Copy(); points[points.Count - 1] = end.Copy();
                AddEdge(from.Id, to.Id, mode, points, mode == "flight" ? 70 : 180);
            }
            foreach (var (a, b) in new[] { ("river", "market"), ("market", "core"), ("core", "government"), ("government", "starport") }) Elevated(a, b, "maglev", 35);
            foreach (var (a, b) in new[] { ("workshop", "market"), ("market", "academy"), ("academy", "west"), ("east", "airport"), ("east", "core") }) Elevated(a, b, "lightRail", 14);
            Elevated("government", "summit", "cable", 72);
            Elevated("core", "summit", "cable", 95);
            AddEdge(liftBottom.Id, liftTop.Id, "lift", new List<Vec3> { liftBottom.Position, liftTop.Position }, 30);
            AddEdge(liftTop.Id, Station("core").Id, "bridge", RouteGround(world, liftTop.Position, Station("core").Position), 80);
            AddEdge(liftBottom.Id, Station("east").Id, "road", RouteGround(world, liftBottom.Position, Station("east").Position), 100);
            var dockA = new NetworkNode { Id = "river-dock", DistrictId = "river", Name = "清溪渡船码头", Position = new Vec3(-580, 15.6, 1010), Station = true };
            var dockB = new NetworkNode { Id = "market-dock", DistrictId = "market", Name = "千灯水运码头", Position = new Vec3(-110, 56.6, 460), Station = true };
            world.Nodes.Add(dockA); world.Nodes.Add(dockB);
            var riverBridge = RouteGround(world, dockA.Position, Station("river").Position, null, currentLayout ? 25 : 5);
            if (currentLayout)
            {
                double span = 0; for (int i = 1; i < riverBridge.Count; i++) span += JsMath.Hypot(riverBridge[i].X - riverBridge[i - 1].X, riverBridge[i].Z - riverBridge[i - 1].Z);
                StationApronGrade(riverBridge, false, JsMath.Max(0, span - 64));
            }
            AddEdge(dockA.Id, Station("river").Id, "bridge", riverBridge, 60);
            AddEdge(dockB.Id, Station("market").Id, "bridge", RouteGround(world, dockB.Position, Station("market").Position), 60);
            AddEdge(dockA.Id, dockB.Id, "ferry", new List<Vec3> { dockA.Position, new Vec3(-410, 30.6, 720), dockB.Position }, 45);
            var coreDock = new NetworkNode { Id = "core-dock", DistrictId = "core", Name = "瀑云潭水运站", Position = new Vec3(75, 94.6, 140), Station = true };
            world.Nodes.Add(coreDock);
            AddEdge(coreDock.Id, liftBottom.Id, "bridge", RouteGround(world, coreDock.Position, liftBottom.Position), 65);
            AddEdge(coreDock.Id, dockB.Id, "ferry", new List<Vec3> { coreDock.Position, new Vec3(-65, 75.6, 260), dockB.Position }, 45);
            var runwayWest = new NetworkNode { Id = "airport-runway-west", DistrictId = "airport", Name = "南岫跑道西端", Position = new Vec3(710, 14.6, 1490), Station = true };
            var runwayEast = new NetworkNode { Id = "airport-runway-east", DistrictId = "airport", Name = "南岫跑道东端", Position = new Vec3(1670, 14.6, 1490), Station = false };
            world.Nodes.Add(runwayWest); world.Nodes.Add(runwayEast);
            AddEdge(runwayWest.Id, runwayEast.Id, "road", new List<Vec3> { runwayWest.Position, runwayEast.Position }, 4);
            world.Edges[world.Edges.Count - 1].Id = "road-airport-runway-strip";
            AddEdge(runwayWest.Id, Station("airport").Id, "road", RouteGround(world, runwayWest.Position, Station("airport").Position), 90);
            AddEdge(runwayWest.Id, Station("starport").Id, "flight", new List<Vec3> { runwayWest.Position, runwayEast.Position, new Vec3(1850, 180, 1480), new Vec3(1920, 420, 900), new Vec3(1840, 590, -150), new Vec3(1580, 550, -1120), new Vec3(1440, 410, -1280), Station("starport").Position }, 70);
            AddEdge(runwayWest.Id, Station("workshop").Id, "flight", new List<Vec3> { runwayWest.Position, runwayEast.Position, new Vec3(1850, 180, 1480), new Vec3(1600, 430, 1750), new Vec3(-500, 500, 1450), new Vec3(-1420, 330, 560), Station("workshop").Position }, 50);
            world.Spawn = new Vec3(-330, GetWalkHeight(world, -330, 487), 487);
            return world;
        }
    }
}
