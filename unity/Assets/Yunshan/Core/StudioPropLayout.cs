// Port of src/rendering/studio-prop-layout.ts: where voxel-studio models stand.
// Display only: fixture solids, use points and simulation stay authoritative.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public sealed class StudioAssetBounds
    {
        public string Id;
        public double[] Min, Max;
        public StudioAssetBounds(string id, double[] min, double[] max) { Id = id; Min = min; Max = max; }
    }

    public sealed class StudioPropPlacement
    {
        public string Asset, FixtureId;
        public int Floor;
        public double Scale;
        /// <summary>Building-local position of the asset origin; building yaw applies after.</summary>
        public Vec3 Local;
    }

    public sealed class StudioStaticPlacement
    {
        public string Asset, Id;
        /// <summary>World position of the asset origin (its min corner); yaw about Y.</summary>
        public Vec3 Position;
        public double Yaw;
        /// <summary>Rotation about the model's own X after yaw (deck slope).</summary>
        public double Pitch;
    }

    public static class StudioPropLayout
    {
        public const double MinFitScale = .9;
        public static readonly Dictionary<string, (string Asset, int Copies)> FixtureDressing = new Dictionary<string, (string, int)>
        {
            ["counter"] = ("LIFE-064", 2),
            ["table"] = ("LIFE-032", 1),
        };
        public static readonly Dictionary<string, Dictionary<string, (string Asset, int Copies)>> ProgramDressing = new Dictionary<string, Dictionary<string, (string, int)>>
        {
            ["police"] = new Dictionary<string, (string, int)> { ["table"] = ("LIFE-151", 1) },
            ["school"] = new Dictionary<string, (string, int)> { ["table"] = ("LIFE-111", 2) },
            ["workshop"] = new Dictionary<string, (string, int)> { ["table"] = ("LIFE-072", 2) },
            ["farm"] = new Dictionary<string, (string, int)> { ["table"] = ("LIFE-072", 2) },
        };
        /// <summary>Port of STUDIO_TABLETOP: one object on a general table model's top.</summary>
        public static readonly Dictionary<string, string> Tabletop = new Dictionary<string, string> { ["clinic"] = "LIFE-119", ["bank"] = "LIFE-106", ["hall"] = "LIFE-171", ["home"] = "LIFE-020" };
        public const string TabletopBase = "LIFE-032";
        public const string CeilingLampAsset = "LIFE-028";
        public const double CeilingLampSlabThickness = .2, CeilingLampEyeClearance = 1.72;
        public const string StationPlatformAsset = "BUILT-154", StationShelterAsset = "BUILT-155";
        static readonly Vec3 PlatformMin = new Vec3(-11, -1.1, -9);
        static readonly Vec3 ShelterOnPlatform = new Vec3(1.4 - 1.9, 1, 8.5 - 5);

        public static (string Asset, int Copies)? Dressing(string kind, string buildingKind, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            if (buildingKind != null && ProgramDressing.TryGetValue(buildingKind, out var program) && program.TryGetValue(kind, out var specific) && assets.ContainsKey(specific.Asset)) return specific;
            return FixtureDressing.TryGetValue(kind, out var general) ? general : ((string, int)?)null;
        }

        public static List<StudioPropPlacement> LayoutFixture(FloorFixture fixture, int floor, double floorY, IReadOnlyDictionary<string, StudioAssetBounds> assets, string buildingKind = null)
        {
            var dressing = Dressing(fixture.Kind, buildingKind, assets);
            if (dressing == null || !assets.TryGetValue(dressing.Value.Asset, out var asset)) return null;
            double[] min = asset.Min, max = asset.Max; var r = fixture.Rect;
            double width = max[0] - min[0], height = max[1] - min[1], depth = max[2] - min[2];
            double slot = (r.X1 - r.X0) / dressing.Value.Copies;
            double scale = JsMath.Min(JsMath.Min(JsMath.Min(1, slot / width), (r.Z1 - r.Z0) / depth), (fixture.Top - fixture.Bottom) / height);
            if (!(scale >= MinFitScale)) return null;
            double centerZ = (r.Z0 + r.Z1) / 2;
            var placements = Enumerable.Range(0, dressing.Value.Copies).Select(copy => new StudioPropPlacement
            {
                Asset = asset.Id, FixtureId = fixture.Id, Floor = floor, Scale = scale,
                Local = new Vec3(r.X0 + slot * (copy + .5) - scale * (min[0] + max[0]) / 2, floorY + fixture.Bottom - scale * min[1], centerZ - scale * (min[2] + max[2]) / 2),
            }).ToList();
            if (fixture.Kind == "table" && asset.Id == TabletopBase && buildingKind != null && Tabletop.TryGetValue(buildingKind, out var topId) && assets.TryGetValue(topId, out var top))
            {
                double[] bmin = top.Min, bmax = top.Max;
                if (bmax[0] - bmin[0] <= scale * (max[0] - min[0]) && bmax[2] - bmin[2] <= scale * (max[2] - min[2]))
                    placements.Add(new StudioPropPlacement { Asset = top.Id, FixtureId = fixture.Id + ":top", Floor = floor, Scale = 1,
                        Local = new Vec3((r.X0 + r.X1) / 2 - (bmin[0] + bmax[0]) / 2, floorY + fixture.Bottom + scale * (max[1] - min[1]) - bmin[1], centerZ - (bmin[2] + bmax[2]) / 2) });
            }
            return placements;
        }

        public static bool DressesFixture(FloorFixture fixture, string buildingKind, IReadOnlyDictionary<string, StudioAssetBounds> assets) => LayoutFixture(fixture, 0, 0, assets, buildingKind) != null;

        public static List<StudioPropPlacement> CeilingLampPlacements(Building building, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var result = new List<StudioPropPlacement>();
            var body = ArchitectureFloorPlan.GetBuildingBody(building);
            if (body == null || !assets.TryGetValue(CeilingLampAsset, out var asset)) return result;
            double[] min = asset.Min, max = asset.Max;
            foreach (var plan in body.FloorPlans)
            {
                var above = body.FloorPlans.FirstOrDefault(next => next.Floor == plan.Floor + 1); if (above == null) continue;
                var slabs = ArchitectureFloorPlan.GetFloorPlanSlabRegions(above);
                double top = plan.CeilingY - CeilingLampSlabThickness, y = top - max[1];
                if (y + min[1] < plan.Y + CeilingLampEyeClearance) continue;
                foreach (var point in plan.UsePoints)
                {
                    if (!plan.Interior.Any(region => ArchitectureFloorPlan.Contains(region, point.X, point.Z))) continue;
                    bool covered = new[] { (min[0], min[2]), (max[0], min[2]), (min[0], max[2]), (max[0], max[2]) }
                        .All(c => slabs.Any(region => ArchitectureFloorPlan.Contains(region, point.X + c.Item1 - (min[0] + max[0]) / 2, point.Z + c.Item2 - (min[2] + max[2]) / 2)));
                    if (!covered) continue;
                    result.Add(new StudioPropPlacement { Asset = asset.Id, FixtureId = point.Id + ":ceiling-lamp", Floor = plan.Floor, Scale = 1, Local = new Vec3(point.X - (min[0] + max[0]) / 2, y, point.Z - (min[2] + max[2]) / 2) });
                }
            }
            return result;
        }

        public static List<StudioPropPlacement> BuildingPlacements(Building building, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var body = ArchitectureFloorPlan.GetBuildingBody(building); var result = new List<StudioPropPlacement>();
            if (body == null) return result;
            foreach (var plan in body.FloorPlans) foreach (var fixture in plan.Fixtures) { var placed = LayoutFixture(fixture, plan.Floor, plan.Y, assets, building.Kind); if (placed != null) result.AddRange(placed); }
            result.AddRange(CeilingLampPlacements(building, assets));
            return result;
        }

        public static List<StudioStaticPlacement> StationPlacements(WorldDefinition world, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var result = new List<StudioStaticPlacement>();
            if (!assets.ContainsKey(StationPlatformAsset) || !assets.ContainsKey(StationShelterAsset)) return result;
            foreach (var node in world.Nodes.Where(n => n.Station))
            {
                var p = node.Position; var platform = new Vec3(p.X + PlatformMin.X, p.Y + PlatformMin.Y, p.Z + PlatformMin.Z);
                result.Add(new StudioStaticPlacement { Asset = StationPlatformAsset, Id = node.Id + ":platform", Position = platform, Yaw = 0 });
                result.Add(new StudioStaticPlacement { Asset = StationShelterAsset, Id = node.Id + ":shelter", Position = new Vec3(platform.X + ShelterOnPlatform.X, platform.Y + ShelterOnPlatform.Y, platform.Z + ShelterOnPlatform.Z), Yaw = 0 });
            }
            return result;
        }

        /// <summary>Port of studioLandmarkPlacements: BUILT-158 runway slab (top at
        /// the runway deck top) and BUILT-092 forecourt centred at door + 67m.</summary>
        public const string RunwayAsset = "BUILT-158", RunwayEdgeId = "road-airport-runway-strip", ForecourtAsset = "BUILT-092";
        public const double ForecourtDoorOffsetZ = 67;
        public static List<StudioStaticPlacement> LandmarkPlacements(WorldDefinition world, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var result = new List<StudioStaticPlacement>();
            var runway = world.Edges.FirstOrDefault(e => e.Id == RunwayEdgeId);
            if (runway != null && assets.TryGetValue(RunwayAsset, out var slab) && runway.Points.Count == 2)
            {
                Vec3 a = runway.Points[0], b = runway.Points[1];
                double length = JsMath.Hypot(b.X - a.X, b.Z - a.Z), width = slab.Max[2] - slab.Min[2];
                if (System.Math.Abs(length - (slab.Max[0] - slab.Min[0])) < 1e-6 && System.Math.Abs(a.Y - b.Y) < 1e-6 && System.Math.Abs(a.Z - b.Z) < 1e-6 && b.X > a.X)
                    result.Add(new StudioStaticPlacement { Asset = RunwayAsset, Id = runway.Id + ":runway", Position = new Vec3(a.X - slab.Min[0], a.Y - slab.Max[1], a.Z - width / 2 - slab.Min[2]), Yaw = 0 });
            }
            var core = world.Buildings.FirstOrDefault(b => b.Kind == "core");
            if (core != null && assets.ContainsKey(ForecourtAsset))
                result.Add(new StudioStaticPlacement { Asset = ForecourtAsset, Id = core.Id + ":forecourt", Position = new Vec3(core.Position.X, core.Position.Y, core.Door.Z + ForecourtDoorOffsetZ), Yaw = 0 });
            return result;
        }

        /// <summary>Port of studioDeckTilePlacements: BUILT-140 rail bed and BUILT-146
        /// bridge deck repeated every 8m along each rail or bridge edge path.</summary>
        public static readonly (string Kind, string Asset, string[] Modes, double Height, double Lift)[] DeckTiles =
        {
            ("rail", "BUILT-140", new[] { "maglev", "lightRail" }, 1.4, -.9),
            ("bridge", "BUILT-146", new[] { "bridge" }, .5, -.25),
        };
        public static List<StudioStaticPlacement> DeckTilePlacements(WorldDefinition world, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var result = new List<StudioStaticPlacement>();
            foreach (var tile in DeckTiles)
            {
                if (!assets.TryGetValue(tile.Asset, out var asset)) continue;
                double[] min = asset.Min, max = asset.Max; double width = max[0] - min[0], height = max[1] - min[1], length = max[2] - min[2];
                double cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
                foreach (var edge in world.Edges)
                {
                    if (!tile.Modes.Contains(edge.Mode)) continue;
                    if (Math.Abs(TransportGeometry.DeckWidth(edge) - width) > 1e-6 || Math.Abs(tile.Height - height) > 1e-6) continue;
                    var spans = new List<double>();
                    for (int i = 1; i < edge.Points.Count; i++) { Vec3 p = edge.Points[i - 1], q = edge.Points[i]; spans.Add(JsMath.Hypot(q.X - p.X, q.Y - p.Y, q.Z - p.Z)); }
                    double total = 0; foreach (var v in spans) total += v; if (total < .01) continue;
                    int count = (int)Math.Max(1, Math.Ceiling(total / length));
                    for (int k = 0; k < count; k++)
                    {
                        double s = total < length ? total / 2 : Math.Min(k * length + length / 2, total - length / 2);
                        int i = 0; double before = 0; while (i < spans.Count - 1 && before + spans[i] < s) { before += spans[i]; i++; }
                        Vec3 a = edge.Points[i], b = edge.Points[i + 1]; double dx = b.X - a.X, dy = b.Y - a.Y, dz = b.Z - a.Z, t = spans[i] > 0 ? (s - before) / spans[i] : 0;
                        double yaw = JsMath.Atan2(dx, dz), pitch = -JsMath.Atan2(dy, JsMath.Hypot(dx, dz));
                        double cosY = JsMath.Cos(yaw), sinY = JsMath.Sin(yaw), cosP = JsMath.Cos(pitch), sinP = JsMath.Sin(pitch);
                        double r1y = cy * cosP - cz * sinP, r1z = cy * sinP + cz * cosP, rcx = cx * cosY + r1z * sinY, rcy = r1y, rcz = -cx * sinY + r1z * cosY;
                        double x = a.X + dx * t, y = a.Y + dy * t + tile.Lift, z = a.Z + dz * t;
                        result.Add(new StudioStaticPlacement { Asset = tile.Asset, Id = $"{edge.Id}:{tile.Kind}-deck:{k}", Position = new Vec3(x - rcx, y - rcy, z - rcz), Yaw = yaw, Pitch = pitch });
                    }
                }
            }
            return result;
        }

        /// <summary>Lamp glow fraction for city power and daylight (both clamped 0..1).</summary>
        public static double EmissiveFactor(double daylight, double power)
        {
            double p = JsMath.Min(1, JsMath.Max(0, power)), d = JsMath.Min(1, JsMath.Max(0, daylight));
            return p * (.35 + .65 * (1 - d));
        }
    }
}
