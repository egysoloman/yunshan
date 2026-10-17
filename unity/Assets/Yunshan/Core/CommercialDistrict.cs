// Port of src/commercial-district.ts: five existing market banks become towers.
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public static class CommercialDistrict
    {
        public const int GeometryRevision = 1, RouteRevision = 1;
        public const string RecipeVersion = "commercial-five-bank-towers-01";
        public static readonly (string Id, int Floors, double StoreyHeight)[] TowerSites =
        {
            ("market-b6", 40, 4.4), ("market-b38", 30, 4.4), ("market-b44", 25, 4.4), ("market-b41", 22, 4.4), ("market-b35", 20, 4.4),
        };
        static double Q(double value) => JsMath.Round(value * 5) / 5;
        static string Program(int floor, int floors) => floor == 0 ? "原钱庄公共柜台与接待"
            : floor == 1 ? "公共金融咨询与办事厅"
            : floor == floors - 1 ? "钱庄上层办公与城市会客厅"
            : new[] { "钱庄记账与结算办公室", "原钱庄业务办公区", "钱庄账务复核办公室", "钱庄档案与协作办公区" }[(floor - 2) % 4];

        public sealed class Conflict { public string SiteId, EdgeId; public int Floor, Segment; }

        public static List<Conflict> NetworkConflicts(WorldDefinition world)
        {
            var conflicts = new List<Conflict>();
            foreach (var site in world.Buildings)
            {
                if (site.CommercialGeometryRevision != 1) continue;
                var body = ArchitectureFloorPlan.GetBuildingBody(site);
                foreach (var edge in world.Edges)
                {
                    double half = edge.Mode == "flight" ? 22 : edge.Mode == "bridge" ? 4.5 : edge.Mode == "maglev" || edge.Mode == "lightRail" ? 3 : edge.Mode == "cable" ? 2 : 5;
                    double below = edge.Mode == "flight" ? 3 : 2.4, above = edge.Mode == "flight" ? 5 : 4.8;
                    for (int segment = 1; segment < edge.Points.Count; segment++)
                    {
                        Vec3 a = edge.Points[segment - 1], b = edge.Points[segment];
                        foreach (var plan in body.FloorPlans.Where(p => p.Floor >= 2))
                        {
                            var r = plan.Broadphase; double minY = site.Position.Y + .6 + plan.Y - .2, maxY = site.Position.Y + .6 + plan.CeilingY + 1.2;
                            double lo = 0, hi = 1;
                            var axes = new[]
                            {
                                (a.X, b.X, site.Position.X + r.X0 - half - .6, site.Position.X + r.X1 + half + .6),
                                (a.Z, b.Z, site.Position.Z + r.Z0 - half - .6, site.Position.Z + r.Z1 + half + .6),
                                (a.Y, b.Y, minY - above, maxY + below),
                            };
                            foreach (var (av, bv, min, max) in axes)
                            {
                                double delta = bv - av;
                                if (Math.Abs(delta) < 1e-12) { if (av < min || av > max) { lo = 2; break; } }
                                else { double u = (min - av) / delta, v = (max - av) / delta; lo = JsMath.Max(lo, JsMath.Min(u, v)); hi = JsMath.Min(hi, JsMath.Max(u, v)); }
                            }
                            if (lo <= hi) { conflicts.Add(new Conflict { SiteId = site.Id, EdgeId = edge.Id, Floor = plan.Floor, Segment = segment }); break; }
                        }
                    }
                }
            }
            return conflicts;
        }

        /// <summary>Mutates only the five declared banks of a fresh trusted v5 world.</summary>
        public static void Apply(WorldDefinition world)
        {
            var selected = TowerSites.Select(spec =>
            {
                var site = world.Buildings.FirstOrDefault(building => building.Id == spec.Id);
                if (site == null || site.Kind != "bank" || site.DistrictId != "market" || site.FloorPlanProfile != "v4-program-bodies-02"
                    || site.StairGeometryRevision != 2 || site.Rotation != 0 || site.Width < 40 || site.Depth < 33)
                    throw new InvalidOperationException($"商业高楼配方缺少可信原钱庄或尺寸不适用：{spec.Id}");
                return site;
            }).ToList();
            for (int index = 0; index < selected.Count; index++)
            {
                var site = selected[index]; var spec = TowerSites[index]; var door = site.Door.Copy();
                site.CommercialGeometryRevision = GeometryRevision;
                site.CommercialRouteRevision = RouteRevision;
                site.Floors = spec.Floors;
                site.Height = Q(spec.Floors * spec.StoreyHeight);
                site.FloorFootprints = Enumerable.Range(0, spec.Floors).Select(floor =>
                {
                    double scale = floor < 2 ? 1 : floor < Math.Ceiling(spec.Floors * .40) ? .92 : floor < Math.Ceiling(spec.Floors * .78) ? .86 : .80;
                    return new Footprint(floor < 2 ? site.Width : Q(site.Width * scale), floor < 2 ? site.Depth : Q(site.Depth * scale));
                }).ToList();
                site.FloorUses = Enumerable.Range(0, spec.Floors).Select(floor => Program(floor, spec.Floors)).ToList();
                site.FloorPermissions = Enumerable.Range(0, spec.Floors).Select(_ => "public").ToList();
                site.PublicFloors = spec.Floors;
                var entrance = ArchitectureFloorPlan.GetBuildingEntrance(site);
                if (JsMath.Hypot(entrance.X - door.X, entrance.Z - door.Z) > 1e-7 || Math.Abs(entrance.Y - door.Y) > 1e-7)
                    throw new InvalidOperationException($"商业高楼不得移动原钱庄入口：{site.Id}");
                site.FunctionPoints = Enumerable.Range(0, spec.Floors).SelectMany(floor => ArchitectureFloorPlan.GetBuildingUsePoints(site, floor)).ToList();
            }
            var conflicts = NetworkConflicts(world);
            if (conflicts.Count > 0) throw new InvalidOperationException($"商业高楼侵入现有真实交通走廊，拒绝此seed：{conflicts[0].SiteId}/{conflicts[0].EdgeId}");
        }
    }
}
