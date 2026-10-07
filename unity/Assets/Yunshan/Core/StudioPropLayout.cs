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
        };
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
            return Enumerable.Range(0, dressing.Value.Copies).Select(copy => new StudioPropPlacement
            {
                Asset = asset.Id, FixtureId = fixture.Id, Floor = floor, Scale = scale,
                Local = new Vec3(r.X0 + slot * (copy + .5) - scale * (min[0] + max[0]) / 2, floorY + fixture.Bottom - scale * min[1], centerZ - scale * (min[2] + max[2]) / 2),
            }).ToList();
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

        /// <summary>Lamp glow fraction for city power and daylight (both clamped 0..1).</summary>
        public static double EmissiveFactor(double daylight, double power)
        {
            double p = JsMath.Min(1, JsMath.Max(0, power)), d = JsMath.Min(1, JsMath.Max(0, daylight));
            return p * (.35 + .65 * (1 - d));
        }
    }
}
