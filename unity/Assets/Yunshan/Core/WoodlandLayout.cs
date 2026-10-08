// Port of src/rendering/woodland-layout.ts (woodlandLayout and
// createGroundClearance). Trees and shrubs are display only and use the
// voxel-studio models at their original size. Parity-tested against TS.
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public static class WoodlandLayout
    {
        public const double Tile = 96;
        public const int MaxTrees = 5200;
        public static readonly string[] SpeciesAssets = { "ENV-057", "ENV-056", "ENV-050", "ENV-054", "ENV-054", "ENV-055", "ENV-055", "ENV-050", "ENV-050" };
        public const string ShrubAsset = "ENV-060";
        public static readonly Dictionary<string, double> AssetHeights = new Dictionary<string, double> { ["ENV-050"] = 16, ["ENV-054"] = 14, ["ENV-055"] = 14, ["ENV-056"] = 8.4, ["ENV-057"] = 10, ["ENV-060"] = 1.8 };

        public sealed class Tree { public int Id, Species; public string Asset; public double X, Y, Z, Height, Yaw; }
        public sealed class Shrub { public int Id; public string Asset; public double X, Y, Z, Yaw; }
        public sealed class Result { public List<Tree> Trees = new List<Tree>(); public List<Shrub> Shrubs = new List<Shrub>(); public int Stands; }

        sealed class Segment { public Vec3 A, B; public double Width; }
        static double Quantize(double v) => JsMath.Round(v / .2) * .2;
        public static double Hash(double x, double z, double seed) { double value = JsMath.Sin(x * 12.9898 + z * 78.233 + seed * .113) * 43758.5453; return value - System.Math.Floor(value); }
        static double Progress(double x, double z, Vec3 a, Vec3 b) { double dx = b.X - a.X, dz = b.Z - a.Z, den = dx * dx + dz * dz; if (den == 0) den = 1; return System.Math.Min(1, System.Math.Max(0, ((x - a.X) * dx + (z - a.Z) * dz) / den)); }
        static double DistanceToSegment(double x, double z, Vec3 a, Vec3 b) { double t = Progress(x, z, a, b); return JsMath.Hypot(x - a.X - (b.X - a.X) * t, z - a.Z - (b.Z - a.Z) * t); }
        static string Bucket(double x, double z) => $"{JsMath.ToJsString(System.Math.Floor(x / Tile))}:{JsMath.ToJsString(System.Math.Floor(z / Tile))}";

        /// <summary>Off building footprints, roads, the waterfall path, the river and the plunge pool.</summary>
        public static System.Func<double, double, double, bool> GroundClearance(WorldDefinition world)
        {
            var buildings = new Dictionary<string, List<Building>>(); var roads = new Dictionary<string, List<Segment>>();
            void Index<T>(Dictionary<string, List<T>> map, T item, double ax, double az, double bx, double bz, double margin)
            {
                for (double x = System.Math.Floor((System.Math.Min(ax, bx) - margin) / Tile); x <= System.Math.Floor((System.Math.Max(ax, bx) + margin) / Tile); x++)
                    for (double z = System.Math.Floor((System.Math.Min(az, bz) - margin) / Tile); z <= System.Math.Floor((System.Math.Max(az, bz) + margin) / Tile); z++)
                    { var key = $"{JsMath.ToJsString(x)}:{JsMath.ToJsString(z)}"; if (!map.TryGetValue(key, out var list)) map[key] = list = new List<T>(); list.Add(item); }
            }
            foreach (var b in world.Buildings) Index(buildings, b, b.Position.X - b.Width / 2, b.Position.Z - b.Depth / 2, b.Position.X + b.Width / 2, b.Position.Z + b.Depth / 2, 12);
            foreach (var edge in world.Edges) if (edge.Mode == "road" || edge.Mode == "bridge" || edge.Mode == "lightRail")
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    var segment = new Segment { A = edge.Points[i - 1], B = edge.Points[i], Width = edge.Id.Contains("airport-runway-strip") ? 22 : 5 };
                    Index(roads, segment, segment.A.X, segment.A.Z, segment.B.X, segment.B.Z, segment.Width + 14);
                }
            var river = new List<Segment>();
            for (int i = 0; i + 1 < world.River.Count; i++) river.Add(new Segment { A = world.River[i], B = world.River[i + 1], Width = 12 + System.Math.Min(i + 1, 5) * .6 });
            var fall = World.GetWaterfallPath(world);
            return (x, z, margin) =>
            {
                if (buildings.TryGetValue(Bucket(x, z), out var bs) && bs.Any(b => System.Math.Abs(x - b.Position.X) < b.Width / 2 + margin && System.Math.Abs(z - b.Position.Z) < b.Depth / 2 + margin)) return false;
                if (roads.TryGetValue(Bucket(x, z), out var rs) && rs.Any(s => DistanceToSegment(x, z, s.A, s.B) < s.Width + margin)) return false;
                for (int i = 1; i < fall.Count; i++) if (DistanceToSegment(x, z, fall[i - 1], fall[i]) < 46 + margin) return false;
                double best = double.PositiveInfinity, width = 14;
                foreach (var s in river) { double d = DistanceToSegment(x, z, s.A, s.B); if (d < best) { best = d; width = s.Width; } }
                return best > width + margin && JsMath.Hypot(x - world.Waterfall.Bottom.X, z - world.Waterfall.Bottom.Z) > 56;
            };
        }

        public static Result Layout(WorldDefinition world)
        {
            var clear = GroundClearance(world);
            double Surface(double x, double z) => Quantize(World.TerrainHeight(world, x, z, true));
            var stands = new List<(double X, double Z, double Radius)>();
            int index = 0;
            foreach (var district in world.Districts)
            {
                if (district.Kind == "airport" || district.Kind == "starport") continue;
                for (int side = 0; side < 8; side++)
                {
                    double angle = side / 8.0 * System.Math.PI * 2 + index * .21, distance = district.Radius * .86;
                    stands.Add((district.Center.X + JsMath.Cos(angle) * distance, district.Center.Z + JsMath.Sin(angle) * distance, 100));
                }
                index++;
            }
            foreach (var m in world.Mountains) for (int side = 0; side < 5; side++) { double angle = side / 5.0 * System.Math.PI * 2; stands.Add((m.X + JsMath.Cos(angle) * m.Radius * .54, m.Z + JsMath.Sin(angle) * m.Radius * .54, 65)); }
            if (stands.Count == 0) stands.Add((0, 0, world.Size * .35));
            var result = new Result { Stands = stands.Count };
            for (int i = 0; i < 70000 && result.Trees.Count < MaxTrees; i++)
            {
                var stand = stands[i % stands.Count];
                double angle = Hash(i, 38, world.Seed) * System.Math.PI * 2, radius = System.Math.Sqrt(Hash(i, 73, world.Seed)) * stand.Radius;
                double x = Quantize(stand.X + JsMath.Cos(angle) * radius), z = Quantize(stand.Z + JsMath.Sin(angle) * radius), y = Surface(x, z);
                if (y < 8 || y > 630 || !clear(x, z, 3)) continue;
                if (System.Math.Abs(Surface(x + 2, z) - y) > 8 || System.Math.Abs(Surface(x, z + 2) - y) > 8) continue;
                int species = (int)System.Math.Floor((double)i / stands.Count) % 9; var asset = SpeciesAssets[species];
                double yaw = System.Math.Floor(Hash(i, 94, world.Seed) * 4) * System.Math.PI / 2;
                result.Trees.Add(new Tree { Id = i, Asset = asset, Species = species, X = x, Y = y, Z = z, Height = AssetHeights[asset], Yaw = yaw });
                if (i % 2 == 0)
                {
                    double sx = Quantize(x + 3.2), sz = Quantize(z + 2);
                    result.Shrubs.Add(new Shrub { Id = i, Asset = ShrubAsset, X = sx, Y = Surface(sx, sz), Z = sz, Yaw = System.Math.Floor(Hash(i, 95, world.Seed) * 4) * System.Math.PI / 2 });
                }
            }
            return result;
        }

        public sealed class Block { public double X, Y, Z, W, H, D; }
        public sealed class Dressing { public List<Block> Stones = new List<Block>(), Reeds = new List<Block>(), Foam = new List<Block>(); }
        /// <summary>Port of riverDressing: creek bank stones and reeds, plunge-pool foam.</summary>
        public static Dressing RiverDressing(WorldDefinition world)
        {
            var clear = GroundClearance(world); var result = new Dressing();
            double Surface(double x, double z) => Quantize(World.TerrainHeight(world, x, z, true));
            for (int i = 1; i < world.River.Count; i++)
            {
                Vec3 p = world.River[i], before = world.River[i - 1]; double width = 12 + System.Math.Min(i, 5) * .6;
                double segmentLength = JsMath.Hypot(p.X - before.X, p.Z - before.Z), tangentX = -(p.Z - before.Z) / segmentLength, tangentZ = (p.X - before.X) / segmentLength;
                for (double along = 0; along < segmentLength; along += 5.6) foreach (var side in new[] { -1, 1 })
                {
                    double t = along / segmentLength;
                    double x = Quantize(before.X + (p.X - before.X) * t + tangentX * (width + 2 + Hash(along, i, world.Seed) * 3) * side), z = Quantize(before.Z + (p.Z - before.Z) * t + tangentZ * (width + 2 + Hash(along, i, world.Seed) * 3) * side), y = Surface(x, z);
                    if (!clear(x, z, 1.2) || y > before.Y + (p.Y - before.Y) * t + 9) continue;
                    result.Stones.Add(new Block { X = x, Y = y + .35, Z = z, W = Quantize(1.2 + Hash(along, i + 2, world.Seed) * 2.8), H = .6, D = Quantize(1 + Hash(along, i + 3, world.Seed) * 2) });
                    if (along % 11.2 < 1) for (int stem = 0; stem < 4; stem++) result.Reeds.Add(new Block { X = x + stem * .4, Y = y + .8, Z = z + stem % 2 * .4, W = .2, H = 1.6, D = .2 });
                }
            }
            var bottom = world.Waterfall.Bottom;
            for (int i = 0; i < 80; i++)
            {
                double angle = i * 2.39996, r = 3 + Hash(i, 805, world.Seed) * 21;
                result.Foam.Add(new Block { X = Quantize(bottom.X + JsMath.Cos(angle) * r), Y = bottom.Y + .72, Z = Quantize(bottom.Z + JsMath.Sin(angle) * r), W = Quantize(.8 + Hash(i, 806, world.Seed) * 2), H = .2, D = .4 });
            }
            return result;
        }

        public static readonly string[] UnderstoreyAssets = { "ENV-061", "ENV-064", "ENV-062", "ENV-069" };
        public static readonly string[] BankAssets = { "ENV-065", "ENV-066" };
        public static readonly string[] RockAssets = { "ENV-015", "ENV-011", "ENV-016" };
        public static readonly Dictionary<string, double> RockHeights = new Dictionary<string, double> { ["ENV-015"] = 8, ["ENV-011"] = 5, ["ENV-016"] = .8 };
        public static readonly Dictionary<string, (double Cx, double Cz, double Radius)> GroundDressingFootprint = new Dictionary<string, (double, double, double)>
        {
            ["ENV-061"] = (0, 0, 2.6), ["ENV-064"] = (.1, 0, 1.8), ["ENV-062"] = (.2, .2, .8), ["ENV-069"] = (3, .1, 3.2),
            ["ENV-065"] = (.2, 0, 1.8), ["ENV-066"] = (0, .1, 2),
            ["ENV-015"] = (0, 0, 2.4), ["ENV-011"] = (8, 6, 9), ["ENV-016"] = (3, 3, 3.6),
        };
        public sealed class GroundItem { public int Id; public string Asset, Tier; public double X, Y, Z, Yaw; }

        /// <summary>Port of groundDressing: studio understorey, wet-bank plants and
        /// mountain-foot rocks at original size, origin on the lowest ground under the footprint.</summary>
        public static List<GroundItem> GroundDressing(WorldDefinition world, IReadOnlyList<Tree> trees)
        {
            var clear = GroundClearance(world); var items = new List<GroundItem>();
            double Surface(double x, double z) => Quantize(World.TerrainHeight(world, x, z, true));
            bool Place(string asset, string tier, double cx, double cz, double yaw, double relief)
            {
                var f = GroundDressingFootprint[asset]; double r = f.Radius;
                if (!clear(cx, cz, r)) return false;
                var heights = new[] { Surface(cx, cz), Surface(cx + r, cz), Surface(cx - r, cz), Surface(cx, cz + r), Surface(cx, cz - r) };
                double low = heights.Min(), high = heights.Max();
                if (low < 8 || high - low > relief) return false;
                double c = JsMath.Cos(yaw), s = JsMath.Sin(yaw);
                items.Add(new GroundItem { Id = items.Count, Asset = asset, Tier = tier, X = cx - (c * f.Cx + s * f.Cz), Y = low, Z = cz - (-s * f.Cx + c * f.Cz), Yaw = yaw });
                return true;
            }
            foreach (var tree in trees)
            {
                if (tree.Id % 3 != 1) continue;
                var asset = UnderstoreyAssets[(int)System.Math.Floor(Hash(tree.Id, 96, world.Seed) * 4)];
                double angle = Hash(tree.Id, 97, world.Seed) * System.Math.PI * 2, distance = 4 + Hash(tree.Id, 98, world.Seed) * 3;
                Place(asset, "ground", Quantize(tree.X + JsMath.Cos(angle) * distance), Quantize(tree.Z + JsMath.Sin(angle) * distance), System.Math.Floor(Hash(tree.Id, 99, world.Seed) * 4) * System.Math.PI / 2, 1.2);
            }
            int site = 0;
            for (int i = 1; i < world.River.Count; i++)
            {
                Vec3 p = world.River[i], before = world.River[i - 1]; double width = 12 + System.Math.Min(i, 5) * .6;
                double segmentLength = JsMath.Hypot(p.X - before.X, p.Z - before.Z), tangentX = -(p.Z - before.Z) / segmentLength, tangentZ = (p.X - before.X) / segmentLength;
                for (double along = 0; along < segmentLength; along += 11.2) foreach (var side in new[] { -1, 1 })
                {
                    double t = along / segmentLength, offset = width + 6.4 + Hash(along, i, world.Seed) * 3;
                    double x = Quantize(before.X + (p.X - before.X) * t + tangentX * offset * side), z = Quantize(before.Z + (p.Z - before.Z) * t + tangentZ * offset * side);
                    if (Surface(x, z) > before.Y + (p.Y - before.Y) * t + 9) continue;
                    if (Place(BankAssets[site % 2], "ground", x, z, System.Math.Floor(Hash(along, i + 7, world.Seed) * 4) * System.Math.PI / 2, 1.2)) site++;
                }
            }
            for (int m = 0; m < world.Mountains.Count; m++)
            {
                var mountain = world.Mountains[m];
                for (int n = 0; n < 16; n++)
                {
                    var asset = RockAssets[n % 3];
                    double angle = n / 16.0 * System.Math.PI * 2 + Hash(n, 900 + m, world.Seed) * .3, distance = mountain.Radius * (1.02 + Hash(n, 901 + m, world.Seed) * .3);
                    Place(asset, "rock", Quantize(mountain.X + JsMath.Cos(angle) * distance), Quantize(mountain.Z + JsMath.Sin(angle) * distance), System.Math.Floor(Hash(n, 902 + m, world.Seed) * 4) * System.Math.PI / 2, RockHeights[asset] * .7);
                }
            }
            return items;
        }
    }
}
