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
        /// <summary>Building-local turn about Y at the origin (décor only); 0 otherwise.</summary>
        public double Yaw;
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
            if (body == null) return FacadePlacements(building, assets);
            foreach (var plan in body.FloorPlans) foreach (var fixture in plan.Fixtures) { var placed = LayoutFixture(fixture, plan.Floor, plan.Y, assets, building.Kind); if (placed != null) result.AddRange(placed); }
            result.AddRange(CeilingLampPlacements(building, assets));
            result.AddRange(DecorPlacements(building, assets));
            result.AddRange(FacadePlacements(building, assets));
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
                foreach (var edge in world.Edges) if (tile.Modes.Contains(edge.Mode)) TileEdgePath(edge, tile.Kind, tile.Asset, asset, tile.Height, tile.Lift, TransportGeometry.DeckWidth(edge), result);
            }
            return result;
        }

        /// <summary>Port of studioRoadTilePlacements: BUILT-131 surface, BUILT-132 centre
        /// line and BUILT-134 kerbs every 2m along every road but the runway strip
        /// (renderers draw only the near ones).</summary>
        public const string RoadDeckAsset = "BUILT-131";
        public static readonly (string Kind, string Asset, string[] Modes, double Deck, double Width, double Height, double Lift)[] RoadTiles =
        {
            ("road", "BUILT-131", new[] { "road" }, 10, 10, .5, -.25),
            ("road-line", "BUILT-132", new[] { "road" }, 10, .16, .08, .07),
            ("road-kerb", "BUILT-134", new[] { "road" }, 10, 9.9, .2, .12),
            ("rail-kerb", "BUILT-142", new[] { "maglev", "lightRail" }, 6, 5.85, .5, -.1),
        };
        public static List<StudioStaticPlacement> RoadTilePlacements(WorldDefinition world, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var result = new List<StudioStaticPlacement>();
            foreach (var tile in RoadTiles)
            {
                if (!assets.TryGetValue(tile.Asset, out var asset)) continue;
                foreach (var edge in world.Edges) if (tile.Modes.Contains(edge.Mode) && !edge.Id.Contains("runway") && TransportGeometry.DeckWidth(edge) == tile.Deck) TileEdgePath(edge, tile.Kind, tile.Asset, asset, tile.Height, tile.Lift, tile.Width, result);
            }
            return result;
        }

        static void TileEdgePath(NetworkEdge edge, string kind, string assetId, StudioAssetBounds asset, double tileHeight, double lift, double crossWidth, List<StudioStaticPlacement> result)
        {
            double[] min = asset.Min, max = asset.Max; double width = max[0] - min[0], height = max[1] - min[1], length = max[2] - min[2];
            double cx = (min[0] + max[0]) / 2, cy = (min[1] + max[1]) / 2, cz = (min[2] + max[2]) / 2;
            if (Math.Abs(crossWidth - width) > 1e-6 || Math.Abs(tileHeight - height) > 1e-6) return;
            var spans = new List<double>();
            for (int n = 1; n < edge.Points.Count; n++) { Vec3 p = edge.Points[n - 1], q = edge.Points[n]; spans.Add(JsMath.Hypot(q.X - p.X, q.Y - p.Y, q.Z - p.Z)); }
            double total = 0; foreach (var v in spans) total += v; if (total < .01) return;
            int count = (int)Math.Max(1, Math.Ceiling(total / length));
            int i = 0; double before = 0;
            for (int k = 0; k < count; k++)
            {
                double s = total < length ? total / 2 : Math.Min(k * length + length / 2, total - length / 2);
                if (s < before) { i = 0; before = 0; }
                while (i < spans.Count - 1 && before + spans[i] < s) { before += spans[i]; i++; }
                Vec3 a = edge.Points[i], b = edge.Points[i + 1]; double dx = b.X - a.X, dy = b.Y - a.Y, dz = b.Z - a.Z, t = spans[i] > 0 ? (s - before) / spans[i] : 0;
                double yaw = JsMath.Atan2(dx, dz), pitch = -JsMath.Atan2(dy, JsMath.Hypot(dx, dz));
                double cosY = JsMath.Cos(yaw), sinY = JsMath.Sin(yaw), cosP = JsMath.Cos(pitch), sinP = JsMath.Sin(pitch);
                double r1y = cy * cosP - cz * sinP, r1z = cy * sinP + cz * cosP, rcx = cx * cosY + r1z * sinY, rcy = r1y, rcz = -cx * sinY + r1z * cosY;
                double x = a.X + dx * t, y = a.Y + dy * t + lift, z = a.Z + dz * t;
                result.Add(new StudioStaticPlacement { Asset = assetId, Id = $"{edge.Id}:{kind}-deck:{k}", Position = new Vec3(x - rcx, y - rcy, z - rcz), Yaw = yaw, Pitch = pitch });
            }
        }


        /// <summary>Port of studioNetworkDetailPlacements: BUILT-160 runway side lights and
        /// BUILT-138 rail pier caps at the exact boxes they replace (axis-aligned).</summary>
        public const string RunwayLightAsset = "BUILT-160", RailPierCapAsset = "BUILT-138";
        public static List<StudioStaticPlacement> NetworkDetailPlacements(WorldDefinition world, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var result = new List<StudioStaticPlacement>();
            void At(string assetId, StudioAssetBounds asset, string id, double x, double y, double z) =>
                result.Add(new StudioStaticPlacement { Asset = assetId, Id = id, Position = new Vec3(x - (asset.Min[0] + asset.Max[0]) / 2, y - (asset.Min[1] + asset.Max[1]) / 2, z - (asset.Min[2] + asset.Max[2]) / 2), Yaw = 0 });
            var runway = world.Edges.FirstOrDefault(e => e.Id == "road-airport-runway-strip");
            if (assets.TryGetValue(RunwayLightAsset, out var light) && runway != null)
                foreach (var b in world.Buildings) if (b.Kind == "airport") for (int i = 1; i < runway.Points.Count; i++)
                {
                    Vec3 a = runway.Points[i - 1], next = runway.Points[i]; double cx = (a.X + next.X) / 2, cy = (a.Y + next.Y) / 2 + .18, cz = (a.Z + next.Z) / 2;
                    foreach (var side in new[] { -1, 1 }) At(RunwayLightAsset, light, $"{b.Id}:runway-light:{i}:{side}", cx, cy + .12, cz + side * 16.5);
                }
            if (assets.TryGetValue(RailPierCapAsset, out var cap))
                foreach (var edge in world.Edges)
                {
                    if (edge.Mode != "maglev" && edge.Mode != "lightRail") continue;
                    if (Math.Abs(cap.Max[0] - cap.Min[0] - (TransportGeometry.DeckWidth(edge) + 1)) > 1e-6 || Math.Abs(cap.Max[1] - cap.Min[1] - 1.8) > 1e-6 || Math.Abs(cap.Max[2] - cap.Min[2] - 4) > 1e-6) continue;
                    double supportRemainder = 0;
                    for (int i = 1; i < edge.Points.Count; i++)
                    {
                        Vec3 a = edge.Points[i - 1], b = edge.Points[i]; double length = JsMath.Hypot(b.X - a.X, b.Z - a.Z), interval = 80;
                        for (double along = interval - supportRemainder; along <= length; along += interval)
                        {
                            double t = along / Math.Max(.01, length), x = a.X + (b.X - a.X) * t, z = a.Z + (b.Z - a.Z) * t, y = a.Y + (b.Y - a.Y) * t;
                            if (y - World.TerrainHeight(world, x, z) > 5) At(RailPierCapAsset, cap, $"{edge.Id}:pier-cap:{i}:{JsMath.ToJsString(JsMath.Round(along * 1000))}", x, y - 1.3, z);
                        }
                        supportRemainder = (supportRemainder + length) % interval;
                    }
                }
            return result;
        }


        // Port of studioDecorPlacements (display-only décor in free room and courtyard corners).
        public sealed class DecorSet { public string Base; public string[] Tops; public string Above; public string[] Wear; }
        static DecorSet Set(string b, string[] tops = null, string above = null, string[] wear = null) => new DecorSet { Base = b, Tops = tops ?? new string[0], Above = above, Wear = wear ?? new string[0] };
        /// <summary>CHAR-329 hangs from the collar CHAR-328 (collar tag-mount − tag hanger-top).</summary>
        public const string PetTagAsset = "CHAR-329"; public static readonly double[] PetTagOffset = { .032, .292728, -.318034 };
        static readonly DecorSet[] HomeDecor = { Set("LIFE-037", new[] { "LIFE-038", "LIFE-048" }, "LIFE-041"), Set("LIFE-039"), Set("LIFE-043"), Set("LIFE-050", new[] { "LIFE-051" }, "LIFE-055"), Set("LIFE-024", new[] { "LIFE-009" }, "LIFE-029"),
            Set("LIFE-052", null, "LIFE-057"), Set("LIFE-008", null, "LIFE-030"), Set("LIFE-037", new[] { "LIFE-038", "LIFE-040" }), Set("LIFE-042"), Set("LIFE-053"), Set("LIFE-054"), Set("LIFE-198"), Set("LIFE-197"), Set("LIFE-196"),
            Set("LIFE-037", new[] { "LIFE-038", "LIFE-044", "LIFE-045" }), Set("LIFE-194"), Set("LIFE-195"), Set("LIFE-227"), Set("LIFE-023"), Set("LIFE-031"), Set("LIFE-191"), Set("LIFE-192", new[] { "LIFE-049" }), Set("LIFE-174"),
            Set("LIFE-184", new[] { "LIFE-181" }), Set("LIFE-037", new[] { "LIFE-038", "LIFE-046" }), Set("LIFE-037", new[] { "LIFE-038", "LIFE-047" }),
            Set("CHAR-307", null, null, new[] { "CHAR-330", "CHAR-328", "CHAR-329" }), Set("CHAR-306"), Set("CHAR-308") };
        static readonly DecorSet[] MarketDecor = { Set("LIFE-066", new[] { "LIFE-068" }, "LIFE-070"), Set("LIFE-065", new[] { "LIFE-092" }), Set("LIFE-067", new[] { "LIFE-069" }), Set("LIFE-065", new[] { "LIFE-093" }), Set("LIFE-071"), Set("LIFE-080"), Set("LIFE-065", new[] { "LIFE-094" }),
            Set("LIFE-074"), Set("LIFE-091"), Set("LIFE-199"), Set("LIFE-140") };
        static readonly DecorSet[] WorkshopDecor = { Set("LIFE-081", new[] { "LIFE-085" }), Set("LIFE-082"), Set("LIFE-083"), Set("LIFE-075", new[] { "LIFE-076" }), Set("LIFE-084"), Set("LIFE-078"), Set("LIFE-079"), Set("LIFE-075", new[] { "LIFE-095" }),
            Set("LIFE-172"), Set("LIFE-159"), Set("LIFE-071", new[] { "LIFE-073" }) };
        static readonly DecorSet[] FarmDecor = { Set("LIFE-086"), Set("LIFE-088"), Set("LIFE-087"), Set("LIFE-075", new[] { "LIFE-086" }), Set("LIFE-196") };
        static readonly DecorSet[] CivicDecor = { Set("LIFE-141"), Set("LIFE-142"), Set("LIFE-146"), Set("LIFE-143"), Set("LIFE-144"), Set("LIFE-147"), Set("LIFE-148"), Set("LIFE-150"), Set("LIFE-178", new[] { "LIFE-179" }), Set("LIFE-145"),
            Set("LIFE-153"), Set("LIFE-154"), Set("LIFE-187"), Set("LIFE-188"), Set("LIFE-189"), Set("LIFE-200"), Set("LIFE-185"), Set("LIFE-176"), Set("LIFE-177"), Set("LIFE-175"), Set("LIFE-117"), Set("LIFE-118"), Set("LIFE-193"), Set("LIFE-149"), Set("ENV-134") };
        public static readonly Dictionary<string, DecorSet[]> Decor = new Dictionary<string, DecorSet[]>
        {
            ["home"] = HomeDecor, ["farm"] = FarmDecor, ["market"] = MarketDecor, ["workshop"] = WorkshopDecor,
            ["school"] = new[] { Set("LIFE-109", new[] { "LIFE-107" }), Set("LIFE-110"), Set("LIFE-112", new[] { "LIFE-114" }), Set("LIFE-116"), Set("LIFE-113"), Set("LIFE-112", new[] { "LIFE-115" }), Set("LIFE-169"), Set("LIFE-170"), Set("LIFE-182"), Set("LIFE-183"), Set("LIFE-180") },
            ["hall"] = CivicDecor, ["core"] = CivicDecor,
            ["police"] = new[] { Set("LIFE-152"), Set("LIFE-155"), Set("LIFE-157", new[] { "LIFE-158" }), Set("LIFE-156"), Set("LIFE-159") },
            ["clinic"] = new[] { Set("LIFE-123", new[] { "LIFE-096" }), Set("LIFE-124"), Set("LIFE-125"), Set("LIFE-127", null, "LIFE-121"), Set("LIFE-122") },
            ["bank"] = new[] { Set("LIFE-089"), Set("LIFE-149", new[] { "LIFE-090" }), Set("LIFE-146"), Set("LIFE-149", new[] { "LIFE-019" }), Set("LIFE-144"), Set("ENV-134") },
            ["station"] = new[] { Set("LIFE-147"), Set("LIFE-193"), Set("LIFE-140"), Set("LIFE-091") },
            ["dock"] = new[] { Set("LIFE-087"), Set("LIFE-088"), Set("LIFE-075", new[] { "LIFE-095" }), Set("LIFE-071") },
            ["airport"] = new[] { Set("LIFE-147"), Set("LIFE-193"), Set("LIFE-140") }, ["starport"] = new[] { Set("LIFE-147"), Set("LIFE-193"), Set("LIFE-140") },
        };
        public static readonly DecorSet[] CourtyardDecor = { Set("ENV-098"), Set("ENV-104"), Set("ENV-096"), Set("ENV-097"), Set("BUILT-240"), Set("LIFE-186") };
        public const int DecorPerFloor = 4, CourtyardDecorPerBuilding = 3;
        const double DecorInset = .22;

        static bool Overlaps(Rect a, Rect b, double grow = 0) => a.X0 < b.X1 + grow - 1e-9 && a.X1 > b.X0 - grow + 1e-9 && a.Z0 < b.Z1 + grow - 1e-9 && a.Z1 > b.Z0 - grow + 1e-9;
        static double RectPointDistance(Rect r, double x, double z) => JsMath.Hypot(Math.Max(Math.Max(r.X0 - x, 0), x - r.X1), Math.Max(Math.Max(r.Z0 - z, 0), z - r.Z1));
        static double RectSegmentDistance(Rect r, double ax, double az, double bx, double bz) { double best = double.PositiveInfinity; for (int i = 0; i <= 16; i++) { double t = i / 16.0; best = Math.Min(best, RectPointDistance(r, ax + (bx - ax) * t, az + (bz - az) * t)); } return best; }
        public static int DecorSeed(string id) { int h = 0; foreach (char ch in id) h = (h * 31 + ch) % 1000003; return h; }

        public static List<StudioPropPlacement> DecorPlacements(Building building, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var result = new List<StudioPropPlacement>();
            var body = ArchitectureFloorPlan.GetBuildingBody(building); if (body == null) return result;
            List<DecorSet> UsableOf(IEnumerable<DecorSet> sets) => (sets ?? new DecorSet[0]).Where(st => new[] { st.Base }.Concat(st.Tops).Concat(st.Above != null ? new[] { st.Above } : new string[0]).Concat(st.Wear).All(assets.ContainsKey)).ToList();
            var usable = UsableOf(Decor.TryGetValue(building.Kind, out var kindSets) ? kindSets : null); var outdoor = UsableOf(CourtyardDecor);
            int seed = DecorSeed(building.Id);
            int cursor = usable.Count > 0 ? seed % usable.Count : 0, outdoorCursor = outdoor.Count > 0 ? seed % outdoor.Count : 0, outdoorPlaced = 0;
            foreach (var plan in body.FloorPlans)
            {
                var taken = new List<Rect>();
                var above = body.FloorPlans.FirstOrDefault(next => next.Floor == plan.Floor + 1); var aboveSlabs = above != null ? ArchitectureFloorPlan.GetFloorPlanSlabRegions(above) : new List<Rect>();
                var walls = ArchitectureFloorPlan.WallPanels(plan).Select(p => p.Rect).ToList(); var fixtures = plan.Fixtures.Select(f => f.Rect).ToList();
                var stairs = new List<Rect>(); if (plan.StairHole != null) stairs.Add(plan.StairHole); stairs.Add(plan.StairLanding); stairs.AddRange(plan.StairTreads.Select(t => t.Rect)); stairs.AddRange(plan.StairLandings.Select(t => t.Rect));
                var doors = new List<double[]>();
                foreach (var w in plan.Walls) { if (w.Opening == null) continue; double length = JsMath.Hypot(w.B.X - w.A.X, w.B.Z - w.A.Z), dx = (w.B.X - w.A.X) / length, dz = (w.B.Z - w.A.Z) / length; doors.Add(new[] { w.A.X + dx * w.Opening.From, w.A.Z + dz * w.Opening.From, w.A.X + dx * w.Opening.To, w.A.Z + dz * w.Opening.To }); }
                var points = plan.UsePoints.Select(p => (p.X, p.Z)).Concat(new[] { (plan.Stair.X, plan.Stair.Z) }).ToList();
                var passes = new List<(List<Rect> Rooms, List<Rect> Blockers, List<DecorSet> Sets, int Limit, bool Outdoor)>
                {
                    (plan.Interior, plan.Circulation.Concat(plan.Courtyard).Concat(stairs).ToList(), usable, DecorPerFloor, false),
                };
                if (plan.Floor == 0) passes.Add((plan.Courtyard, plan.Circulation.Concat(plan.Interior).Concat(stairs).ToList(), outdoor, CourtyardDecorPerBuilding, true));
                foreach (var pass in passes)
                {
                    if (pass.Sets.Count == 0) continue;
                    IEnumerable<(double, double)> Probe(Rect r) => new[] { (r.X0, r.Z0), (r.X1, r.Z0), (r.X0, r.Z1), (r.X1, r.Z1), ((r.X0 + r.X1) / 2, (r.Z0 + r.Z1) / 2) };
                    bool Inside(Rect r) => Probe(r).All(q => pass.Rooms.Any(region => ArchitectureFloorPlan.Contains(region, q.Item1, q.Item2)));
                    bool Covered(Rect r) => Probe(r).Any(q => aboveSlabs.Any(region => ArchitectureFloorPlan.Contains(region, q.Item1, q.Item2)));
                    int placed = 0;
                    foreach (var room in pass.Rooms)
                    {
                        foreach (var (cx, cz, sx, sz) in new[] { (room.X0, room.Z0, 1, 1), (room.X1, room.Z0, -1, 1), (room.X1, room.Z1, -1, -1), (room.X0, room.Z1, 1, -1) })
                        {
                            if (placed >= pass.Limit || (pass.Outdoor && outdoorPlaced >= pass.Limit)) break;
                            int start = pass.Outdoor ? outdoorCursor : cursor;
                            for (int attempt = 0; attempt < pass.Sets.Count; attempt++)
                            {
                                var decor = pass.Sets[(start + attempt) % pass.Sets.Count]; var bse = assets[decor.Base]; double[] bmin = bse.Min, bmax = bse.Max;
                                double w = bmax[0] - bmin[0], d = bmax[2] - bmin[2], yaw = sz > 0 ? 0 : Math.PI;
                                double x0 = sx > 0 ? cx + DecorInset : cx - DecorInset - w, z0 = sz > 0 ? cz + DecorInset : cz - DecorInset - d;
                                double topY = bmax[1] - bmin[1]; var below = bse; bool fits = true; var stack = new List<(StudioAssetBounds Asset, double Y)>();
                                foreach (var id in decor.Tops)
                                {
                                    var a = assets[id];
                                    if (a.Max[0] - a.Min[0] > below.Max[0] - below.Min[0] + .02 || a.Max[2] - a.Min[2] > below.Max[2] - below.Min[2] + .02) { fits = false; break; }
                                    stack.Add((a, topY)); topY += a.Max[1] - a.Min[1]; below = a;
                                }
                                var hung = decor.Above != null ? assets[decor.Above] : null; double hungY = bmax[1] - bmin[1] + .3;
                                double top = Math.Max(topY, hung != null ? hungY + hung.Max[1] - hung.Min[1] : 0);
                                double hw = hung != null ? Math.Max(0, (hung.Max[0] - hung.Min[0] - w) / 2) : 0; var extent = new Rect(x0 - hw, x0 + w + hw, z0, z0 + d);
                                if (!fits || (!pass.Outdoor || Covered(extent)) && top > plan.CeilingY - plan.Y - .1) continue;
                                if (!Inside(extent) || pass.Blockers.Any(r => Overlaps(extent, r)) || walls.Any(r => Overlaps(extent, r)) || fixtures.Any(r => Overlaps(extent, r, .6)) || taken.Any(r => Overlaps(extent, r, .1))) continue;
                                if (points.Any(p => RectPointDistance(extent, p.Item1, p.Item2) < 1) || doors.Any(o => RectSegmentDistance(extent, o[0], o[1], o[2], o[3]) < 1.2)) continue;
                                double centreX = x0 + w / 2, centreZ = z0 + d / 2, c = JsMath.Cos(yaw), sn = JsMath.Sin(yaw);
                                void Add(StudioAssetBounds a, double y, string id, bool flushBack)
                                {
                                    double mx = (a.Min[0] + a.Max[0]) / 2, mz = (a.Min[2] + a.Max[2]) / 2, ox = mx * c + mz * sn, oz = -mx * sn + mz * c;
                                    double shift = flushBack ? (d - (a.Max[2] - a.Min[2])) / 2 * (sz > 0 ? 1 : -1) : 0;
                                    result.Add(new StudioPropPlacement { Asset = a.Id, FixtureId = $"decor:{plan.Floor}:{id}", Floor = plan.Floor, Scale = 1, Yaw = yaw, Local = new Vec3(centreX - ox, plan.Y + y - a.Min[1], centreZ - oz - shift) });
                                }
                                string key = result.Count.ToString(System.Globalization.CultureInfo.InvariantCulture);
                                Add(bse, 0, key + ":base", false);
                                for (int i = 0; i < stack.Count; i++) Add(stack[i].Asset, stack[i].Y, $"{key}:top{i}", false);
                                if (hung != null) Add(hung, hungY, key + ":above", true);
                                var origin = result[result.Count - 1 - stack.Count - (hung != null ? 1 : 0)].Local;
                                for (int i = 0; i < decor.Wear.Length; i++)
                                {
                                    var id = decor.Wear[i]; var o = id == PetTagAsset ? PetTagOffset : new double[] { 0, 0, 0 };
                                    result.Add(new StudioPropPlacement { Asset = id, FixtureId = $"decor:{plan.Floor}:{key}:wear{i}", Floor = plan.Floor, Scale = 1, Yaw = yaw, Local = new Vec3(origin.X + o[0] * c + o[2] * sn, origin.Y + o[1], origin.Z - o[0] * sn + o[2] * c) });
                                }
                                taken.Add(extent); placed++;
                                if (pass.Outdoor) { outdoorPlaced++; outdoorCursor = (start + attempt + 1) % pass.Sets.Count; } else cursor = (start + attempt + 1) % pass.Sets.Count;
                                break;
                            }
                        }
                    }
                }
            }
            return result;
        }


        // Port of studioFacadePlacements: legacy studio facade parts on free spans of exterior program walls (display only).
        public static readonly Dictionary<string, string> FacadeDoorSide = new Dictionary<string, string> { ["home"] = "BUILT-063", ["farm"] = "BUILT-063", ["market"] = "BUILT-101", ["clinic"] = "BUILT-116", ["workshop"] = "BUILT-244", ["hall"] = "BUILT-045", ["school"] = "BUILT-045", ["police"] = "BUILT-045", ["bank"] = "BUILT-045", ["dock"] = "BUILT-045", ["station"] = "BUILT-045" };
        public static readonly Dictionary<string, string[]> FacadeWall = new Dictionary<string, string[]>
        {
            ["home"] = new[] { "BUILT-070" }, ["farm"] = new[] { "BUILT-070" }, ["market"] = new[] { "BUILT-069", "BUILT-070" }, ["workshop"] = new[] { "BUILT-069", "BUILT-070" }, ["hall"] = new[] { "BUILT-045" }, ["school"] = new[] { "BUILT-045" }, ["police"] = new[] { "BUILT-045" },
            ["clinic"] = new[] { "BUILT-070" }, ["bank"] = new[] { "BUILT-045" }, ["dock"] = new[] { "BUILT-070" }, ["station"] = new[] { "BUILT-070" }, ["airport"] = new[] { "BUILT-070" }, ["starport"] = new[] { "BUILT-070" },
        };
        public static readonly string[] FacadeEave = { "BUILT-053", "BUILT-248", "BUILT-061", "BUILT-073", "BUILT-246", "BUILT-074" };
        const int FacadeWallPerFloor = 2, FacadeWallMax = 6, FacadeEaveMax = 8, FacadeFinsMax = 4;
        sealed class Exterior { public FloorPlan Plan; public Wall Wall; public int Index; public double Length, Dx, Dz, Nx, Nz; }
        static string Num(double v) => JsMath.ToJsString(v);

        public static List<StudioPropPlacement> FacadePlacements(Building building, IReadOnlyDictionary<string, StudioAssetBounds> assets)
        {
            var output = new List<StudioPropPlacement>(); int seed = DecorSeed(building.Id);
            void Put(string id, string key, int floor, double x, double y, double z, double yaw) { if (!assets.ContainsKey(id)) return; output.Add(new StudioPropPlacement { Asset = id, FixtureId = $"facade:{floor}:{key}", Floor = floor, Scale = 1, Yaw = yaw, Local = new Vec3(x, y, z) }); }
            if (building.Kind == "pavilion")
            {
                double w = building.Width, d = building.Depth;
                if (assets.TryGetValue("BUILT-072", out var a)) foreach (var (sx, sz) in new[] { (-1, -1), (1, -1), (1, 1), (-1, 1) })
                {
                    double yaw = sz > 0 ? 0 : Math.PI, c = JsMath.Cos(yaw), s = JsMath.Sin(yaw), mx = (a.Min[0] + a.Max[0]) / 2, mz = (a.Min[2] + a.Max[2]) / 2;
                    Put(a.Id, $"post:{sx}:{sz}", 0, sx * w * .4 - (mx * c + mz * s), -.6, sz * d * .4 - (-mx * s + mz * c), yaw);
                }
                return output;
            }
            if (building.Kind == "core")
            {
                double w = building.Width, d = building.Depth, h = building.Height;
                void Centred(string id, string key, double x, double y, double z) { if (!assets.TryGetValue(id, out var a)) return; Put(id, key, 0, x - (a.Min[0] + a.Max[0]) / 2, y - .6, z - a.Min[2], 0); }
                Centred("BUILT-088", "south-portico", 0, 0, d / 2);
                foreach (var x in new[] { -w / 2 + 1.2, w / 2 - 1.2 }) Centred("BUILT-089", "pillar:" + Num(x), x, 0, d / 2);
                foreach (var x in new[] { -w * .25, w * .25 }) Centred("BUILT-090", "gallery:" + Num(x), x, 5.5, d / 2);
                if (assets.TryGetValue("BUILT-091", out var top0)) Put(top0.Id, "observation", 0, -(top0.Min[0] + top0.Max[0]) / 2, h - .6, -(top0.Min[2] + top0.Max[2]) / 2, 0);
                return output;
            }
            var body = ArchitectureFloorPlan.GetBuildingBody(building); if (body == null) return output;
            var plans = body.FloorPlans.Where(p => p.Floor >= 0).ToList(); int top = plans.Aggregate(0, (m, p) => Math.Max(m, p.Floor));
            bool SameWall(Wall a, Wall b) => a.A.X == b.A.X && a.A.Z == b.A.Z && a.B.X == b.B.X && a.B.Z == b.B.Z;
            var exterior = new List<Exterior>();
            foreach (var plan in plans)
            {
                var regions = plan.Interior.Concat(plan.Circulation).ToList();
                for (int index = 0; index < plan.Walls.Count; index++)
                {
                    var wall = plan.Walls[index]; double length = JsMath.Hypot(wall.B.X - wall.A.X, wall.B.Z - wall.A.Z); if (length < 1) continue;
                    double dx = (wall.B.X - wall.A.X) / length, dz = (wall.B.Z - wall.A.Z) / length, mx = (wall.A.X + wall.B.X) / 2, mz = (wall.A.Z + wall.B.Z) / 2;
                    foreach (var side in new[] { 1, -1 })
                    {
                        double nx = -dz * side, nz = dx * side;
                        if (!regions.Any(r => ArchitectureFloorPlan.Contains(r, mx + nx * .8, mz + nz * .8)) && regions.Any(r => ArchitectureFloorPlan.Contains(r, mx - nx * .8, mz - nz * .8)))
                        { exterior.Add(new Exterior { Plan = plan, Wall = wall, Index = index, Length = length, Dx = dx, Dz = dz, Nx = nx, Nz = nz }); break; }
                    }
                }
            }
            bool Free(Exterior e, double from, double to, double y0, double y1, bool ignoreOpening)
            {
                if (from < .3 || to > e.Length - .3) return false;
                double storeyHeight = e.Plan.CeilingY - e.Plan.Y;
                foreach (var p in plans)
                {
                    double lo = p.Y - e.Plan.Y, hi = lo + (p.CeilingY - p.Y); if (hi <= y0 || lo >= y1) continue;
                    if (p.Floor > top) return false;
                    var w = p.Walls.FirstOrDefault(x => SameWall(x, e.Wall)); if (w == null) return false;
                    var gaps = new List<(double From, double To, double Bottom, double Top)>();
                    if (w.Opening != null && !(ignoreOpening && p == e.Plan)) gaps.Add((w.Opening.From, w.Opening.To, 0, w.Opening.Height));
                    foreach (var g in w.Windows ?? new List<WallWindow>()) gaps.Add((g.From, g.To, g.Bottom, g.Top));
                    if (gaps.Any(g => g.From < to + .15 && g.To > from - .15 && lo + g.Bottom < y1 && lo + g.Top > y0)) return false;
                    if (p == e.Plan && y1 > storeyHeight + .2 && p.Floor == top) return false;
                }
                return true;
            }
            bool Mount(Exterior e, string id, string key, double along, double y0, double outward = .21, bool ignoreOpening = false)
            {
                if (!assets.TryGetValue(id, out var a)) return false;
                double width = a.Max[0] - a.Min[0], height = a.Max[1] - a.Min[1];
                if (!Free(e, along - width / 2, along + width / 2, y0, y0 + height, ignoreOpening)) return false;
                double yaw = JsMath.Atan2(e.Nx, e.Nz), c = JsMath.Cos(yaw), s = JsMath.Sin(yaw), mx = (a.Min[0] + a.Max[0]) / 2;
                double cx = e.Wall.A.X + e.Dx * along + e.Nx * (outward - a.Min[2]), cz = e.Wall.A.Z + e.Dz * along + e.Nz * (outward - a.Min[2]);
                Put(id, $"{e.Index}:{key}", e.Plan.Floor, cx - mx * c, e.Plan.Y + y0 - a.Min[1], cz + mx * s, yaw);
                return true;
            }
            int walls = 0, eaves = 0, fins = 0, yardDoors = 0;
            foreach (var e in exterior)
            {
                var w = e.Wall; var door = w.Opening != null && e.Plan.Floor == 0 ? w.Opening : null; bool entrance = door?.Use == "entrance";
                if (door != null && (entrance || yardDoors++ < 2))
                {
                    Mount(e, "BUILT-054", "lantern-a", door.From - .55, 1.76); Mount(e, "BUILT-054", "lantern-b", door.To + .55, 1.76);
                    if (FacadeDoorSide.TryGetValue(building.Kind, out var side) && assets.TryGetValue(side, out var sa))
                    {
                        double half = (sa.Max[0] - sa.Min[0]) / 2, y0 = side == "BUILT-116" ? .5 : 0;
                        if (!Mount(e, side, "door-side", door.To + 1.2 + half, y0) && !Mount(e, side, "door-side", door.From - 1.2 - half, y0))
                        {
                            double doorX = w.A.X + e.Dx * (door.From + door.To) / 2, doorZ = w.A.Z + e.Dz * (door.From + door.To) / 2, offset = doorX * e.Nx + doorZ * e.Nz;
                            var line = exterior.Where(o => o.Plan == e.Plan && o != e && Math.Abs(o.Nx - e.Nx) < 1e-6 && Math.Abs(o.Nz - e.Nz) < 1e-6 && Math.Abs(o.Wall.A.X * o.Nx + o.Wall.A.Z * o.Nz - offset) < 1e-6)
                                .Select(o => { double t = (doorX - o.Wall.A.X) * o.Dx + (doorZ - o.Wall.A.Z) * o.Dz; return (O: o, T: t, D: t < 0 ? -t : t > o.Length ? t - o.Length : 0); }).OrderBy(x => x.D).ToList();
                            if (line.Count > 0 && line[0].D < 8) Mount(line[0].O, side, "door-side", line[0].T <= 0 ? .6 + half : line[0].O.Length - .6 - half, y0);
                        }
                    }
                    if (entrance && (building.Kind == "hall" || building.Kind == "school" || building.Kind == "police")) Mount(e, "BUILT-108", "colonnade", (door.From + door.To) / 2, 0, .22, true);
                    if (entrance && building.DistrictId == "core") Mount(e, "BUILT-241", "emitter", door.From - 2.2, 0);
                }
                if (FacadeWall.TryGetValue(building.Kind, out var list))
                    for (int k = 0, placed = 0; list.Length > 0 && k < 6 && placed < FacadeWallPerFloor && walls < FacadeWallMax; k++)
                    {
                        var id = list[(seed + k + e.Index) % list.Length]; double along = e.Length * (k + .5) / 6;
                        if (Mount(e, id, "wall:" + k, along, id == "BUILT-045" ? .3 : 1.76)) { placed++; walls++; }
                    }
                if (e.Plan.Floor == top) for (double along = 2.6; along < e.Length - 2.6 && eaves < FacadeEaveMax; along += 6.2)
                {
                    var id = FacadeEave[(seed + (int)Math.Floor(along)) % FacadeEave.Length]; if (!assets.TryGetValue(id, out var a)) continue;
                    double storey = e.Plan.CeilingY - e.Plan.Y, wallTop = Math.Min(storey, w.Height);
                    if (Mount(e, id, "eave:" + Num(along), along, wallTop - (a.Max[1] - a.Min[1]))) eaves++;
                }
                if (plans.Count >= 8 && e.Plan.Floor == 0 && (building.Kind == "home" || building.Kind == "bank" || building.Kind == "hall"))
                    for (double along = 1.2; along < e.Length - 1.2 && fins < FacadeFinsMax; along += 2.4) if (Mount(e, "BUILT-219", "fin:" + Num(along), along, .2)) fins++;
            }
            return output;
        }

        /// <summary>Lamp glow fraction for city power and daylight (both clamped 0..1).</summary>
        public static double EmissiveFactor(double daylight, double power)
        {
            double p = JsMath.Min(1, JsMath.Max(0, power)), d = JsMath.Min(1, JsMath.Max(0, daylight));
            return p * (.35 + .65 * (1 - d));
        }
    }
}
