// Port of the program-body branch of src/rendering/architecture-detail.ts
// (buildProgramArchitectureDetails, architectureProgramSignPlacement,
// architectureProgramRoofEdges). Door frames, the entrance lantern, the
// plaque frame, window frames, wall-top bands, ground plinths, market/home
// bay divisions, eave tiles and brackets on the shared walls. Display only.
// Parity-tested against TypeScript (scripts/parity/architecture-detail.ts).
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public sealed class ArchitectureDetailPart
    {
        public string Purpose, Color; public Vec3 Position, Size; public int Floor; public bool Roof, Luminous;
    }

    public static class ArchitectureDetail
    {
        public const int Instances = 640;
        const string Wood = "#75563c", Edge = "#b89763", Stone = "#a1a394", Tile = "#69766a";
        static double Q(double n) => JsMath.Round(n * 5) / 5;

        struct Basis { public double Length, Dx, Dz, Nx, Nz; }
        static Basis WallBasis(Wall w)
        {
            double length = JsMath.Hypot(w.B.X - w.A.X, w.B.Z - w.A.Z), dx = (w.B.X - w.A.X) / length, dz = (w.B.Z - w.A.Z) / length;
            return new Basis { Length = length, Dx = dx, Dz = dz, Nx = dz, Nz = -dx };
        }
        static (double X, double Z) WallPoint(Wall w, double along, double normal = 0)
        {
            var b = WallBasis(w); return (w.A.X + b.Dx * along + b.Nx * normal, w.A.Z + b.Dz * along + b.Nz * normal);
        }
        static double WallDistanceSquared(Wall w, (double X, double Z) p)
        {
            var b = WallBasis(w); double along = Math.Min(b.Length, Math.Max(0, (p.X - w.A.X) * b.Dx + (p.Z - w.A.Z) * b.Dz));
            var n = WallPoint(w, along); return (n.X - p.X) * (n.X - p.X) + (n.Z - p.Z) * (n.Z - p.Z);
        }
        /// <summary>JavaScript Array.prototype.sort as V8 runs it (comparators here are a − b on floats).</summary>
        static List<T> Sorted<T>(IEnumerable<T> items, Func<T, T, double> compare)
        {
            var list = items.ToList(); V8Sort.Sort(list, compare); return list;
        }

        public sealed class SignPlacement { public double X, Y, Z, Width, Height; public Wall Wall; public double From, To; }
        public static SignPlacement ProgramSignPlacement(Building building)
        {
            var plan = ArchitectureFloorPlan.GetBuildingBody(building)?.FloorPlans.FirstOrDefault(p => p.Floor == 0);
            if (plan == null) return null;
            var entrance = plan.Walls.FirstOrDefault(w => w.Opening?.Use == "entrance");
            var focus = entrance?.Opening != null ? WallPoint(entrance, (entrance.Opening.From + entrance.Opening.To) / 2) : (0, building.Depth / 2);
            foreach (var wall in Sorted(plan.Walls, (a, b) => WallDistanceSquared(a, focus) - WallDistanceSquared(b, focus)))
            {
                double length = WallBasis(wall).Length;
                var gaps = Sorted(new List<(double From, double To)>(wall.Opening != null ? new[] { (wall.Opening.From, wall.Opening.To) } : Array.Empty<(double, double)>())
                    .Concat((wall.Windows ?? new List<WallWindow>()).Select(w => (w.From, w.To))), (a, b) => a.From - b.From);
                double start = 0;
                foreach (var end in gaps.Concat(new[] { (From: length, To: length) }))
                {
                    if (end.From - start >= 1.6 - 1e-7)
                    {
                        double from = Q(start + .4), to = Q(from + .8); var position = WallPoint(wall, (from + to) / 2, wall.Thickness / 2);
                        double height = Q(Math.Min(2.4, wall.Height - .4));
                        if (height < 1.6) continue;
                        return new SignPlacement { X = position.X, Z = position.Z, Y = plan.Y + .4 + height / 2, Width = .8, Height = height, Wall = wall, From = from, To = to };
                    }
                    start = Math.Max(start, end.To);
                }
            }
            return null;
        }

        public sealed class RoofEdge { public Point2 A, B; public double Y; public int Floor; public RoofRegion Region; }
        public static List<RoofEdge> ProgramRoofEdges(Building building)
        {
            var body = ArchitectureFloorPlan.GetBuildingBody(building); var edges = new List<RoofEdge>(); if (body == null) return edges;
            var keys = new List<string>(); var groups = new Dictionary<string, List<RoofRegion>>();
            foreach (var roof in ArchitectureFloorPlan.GetFloorPlanRoofRegions(body))
            {
                var key = $"{roof.Floor}:{JsMath.ToJsString(roof.Bottom)}";
                if (!groups.TryGetValue(key, out var group)) { groups[key] = group = new List<RoofRegion>(); keys.Add(key); }
                group.Add(roof);
            }
            foreach (var key in keys)
            {
                var group = groups[key];
                foreach (var loop in ArchitectureFloorPlan.BoundaryLoops(group.Select(r => r.Rect).ToList()))
                    for (int i = 0; i < loop.Count; i++)
                    {
                        Point2 a = loop[i], b = loop[(i + 1) % loop.Count]; double dx = Math.Sign(b.X - a.X), dz = Math.Sign(b.Z - a.Z);
                        double length = JsMath.Hypot(b.X - a.X, b.Z - a.Z); var cuts = new List<double> { 0 }; if (!cuts.Contains(length)) cuts.Add(length);
                        foreach (var roof in group) foreach (var corner in new[] { (roof.Rect.X0, roof.Rect.Z0), (roof.Rect.X1, roof.Rect.Z1) })
                        {
                            double u = (corner.Item1 - a.X) * dx + (corner.Item2 - a.Z) * dz;
                            if (u > 0 && u < length && !cuts.Contains(u)) cuts.Add(u);
                        }
                        cuts.Sort();
                        for (int j = 0; j < cuts.Count - 1; j++)
                        {
                            double from = cuts[j], to = cuts[j + 1], x = a.X + dx * (from + to) / 2, z = a.Z + dz * (from + to) / 2;
                            var roof = group.FirstOrDefault(r => x >= r.Rect.X0 - 1e-7 && x <= r.Rect.X1 + 1e-7 && z >= r.Rect.Z0 - 1e-7 && z <= r.Rect.Z1 + 1e-7);
                            if (roof == null || roof.Kind == "gable" && (roof.GableAxis == "x" ? dx != 0 : dz != 0)) continue;
                            edges.Add(new RoofEdge { A = new Point2(a.X + dx * from, a.Z + dz * from), B = new Point2(a.X + dx * to, a.Z + dz * to), Y = roof.Kind == "gable" ? Q(roof.Bottom + .4) : roof.Top, Floor = roof.Floor, Region = roof });
                        }
                    }
            }
            return edges;
        }

        /// <summary>Program-body details for the floors around nearFloor (null for legacy bodies).</summary>
        public static List<ArchitectureDetailPart> ProgramDetails(Building building, double nearFloor = 0, int limit = Instances)
        {
            var body = ArchitectureFloorPlan.GetBuildingBody(building); if (body == null) return null;
            var parts = new List<ArchitectureDetailPart>(); int cap = Math.Max(0, Math.Min(Instances, (int)Math.Floor((double)limit)));
            void Put(string purpose, double x0, double x1, double y0, double y1, double z0, double z1, string color, int floor, bool roof = false, bool luminous = false)
            {
                double lx = Q(Math.Min(x0, x1)), ly = Q(Math.Min(y0, y1)), lz = Q(Math.Min(z0, z1)), hx = Q(Math.Max(x0, x1)), hy = Q(Math.Max(y0, y1)), hz = Q(Math.Max(z0, z1));
                if (parts.Count >= cap || hx <= lx || hy <= ly || hz <= lz) return;
                parts.Add(new ArchitectureDetailPart { Purpose = purpose, Position = new Vec3((lx + hx) / 2, (ly + hy) / 2, (lz + hz) / 2), Size = new Vec3(hx - lx, hy - ly, hz - lz), Color = color, Floor = floor, Roof = roof, Luminous = luminous });
            }
            void Mounted(string purpose, Wall wall, double from, double to, double bottom, double top, double inward, double outward, string color, int floor, bool roof = false, bool luminous = false)
            {
                var c = new[] { WallPoint(wall, from, inward), WallPoint(wall, from, outward), WallPoint(wall, to, inward), WallPoint(wall, to, outward) };
                Put(purpose, c.Min(p => p.X), c.Max(p => p.X), bottom, top, c.Min(p => p.Z), c.Max(p => p.Z), color, floor, roof, luminous);
            }
            var ground = body.FloorPlans.First(p => p.Floor == 0);
            var entrance = ground.Walls.FirstOrDefault(w => w.Opening?.Use == "entrance");
            var focus = entrance?.Opening != null ? WallPoint(entrance, (entrance.Opening.From + entrance.Opening.To) / 2) : (0, building.Depth / 2);
            List<Wall> OrderedWalls(FloorPlan plan) => Sorted(plan.Walls, (a, b) => { double c = (b.Opening?.Use == "entrance" ? 1 : 0) - (a.Opening?.Use == "entrance" ? 1 : 0); return c != 0 ? c : WallDistanceSquared(a, focus) - WallDistanceSquared(b, focus); });
            foreach (var wall in OrderedWalls(ground).Where(w => w.Opening != null).Take(8))
            {
                var opening = wall.Opening; double n = wall.Thickness / 2;
                foreach (var u in new[] { opening.From - .2, opening.To }) Mounted("door", wall, u, u + .2, ground.Y, ground.Y + opening.Height, -n, n, Wood, 0);
                Mounted("door", wall, opening.From - .2, opening.To + .2, ground.Y + opening.Height, ground.Y + opening.Height + .2, -n, n, Edge, 0);
                Mounted("door", wall, opening.From - .4, opening.To + .4, ground.Y + opening.Height + .2, ground.Y + opening.Height + .4, -n, n, Wood, 0);
                if (opening.Use == "entrance")
                {
                    double u = opening.To + .4, y = Math.Max(2.4, opening.Height - .4);
                    Mounted("lantern", wall, u - .2, u + .2, y + .2, y + .4, -n, n + .6, Wood, 0);
                    Mounted("lantern", wall, u - .2, u + .2, y - .4, y + .2, n, n + .6, "#e7bc73", 0, false, true);
                    foreach (var yy in new[] { y - .6, y + .2 }) Mounted("lantern", wall, u - .4, u + .4, yy, yy + .2, n, n + .8, "#7c3e32", 0);
                }
            }
            var sign = ProgramSignPlacement(building);
            if (sign != null)
            {
                double lo = sign.Y - sign.Height / 2, hi = sign.Y + sign.Height / 2, n = sign.Wall.Thickness / 2;
                Mounted("sign", sign.Wall, sign.From - .2, sign.To + .2, lo - .2, hi + .2, -n, n, Wood, 0);
                foreach (var u in new[] { sign.From - .2, sign.To }) Mounted("sign", sign.Wall, u, u + .2, lo - .2, hi + .2, 0, n, Edge, 0);
                foreach (var yy in new[] { lo - .2, hi }) Mounted("sign", sign.Wall, sign.From - .2, sign.To + .2, yy, yy + .2, 0, n, Edge, 0);
            }
            int center = (int)Math.Min(Math.Max(Math.Floor(nearFloor), 0), Math.Max(0, building.Floors - 1));
            var selected = new[] { center, center + 1, center - 1 }.Where(f => f >= 0 && f < building.Floors).ToList();
            foreach (var floor in selected)
            {
                var plan = body.FloorPlans.First(p => p.Floor == floor);
                var windowList = OrderedWalls(plan).SelectMany(wall => (wall.Windows ?? new List<WallWindow>()).Select(window => (wall, window)));
                var windows = Sorted(windowList, (a, b) =>
                {
                    var p = WallPoint(a.wall, (a.window.From + a.window.To) / 2); var r = WallPoint(b.wall, (b.window.From + b.window.To) / 2);
                    return (p.X - focus.Item1) * (p.X - focus.Item1) + (p.Z - focus.Item2) * (p.Z - focus.Item2) - (r.X - focus.Item1) * (r.X - focus.Item1) - (r.Z - focus.Item2) * (r.Z - focus.Item2);
                }).Take(cap <= 384 ? (floor == center ? 8 : 4) : (floor == center ? 14 : 7));
                foreach (var (wall, window) in windows)
                {
                    double from = window.From, to = window.To, low = plan.Y + window.Bottom, high = plan.Y + window.Top, n = wall.Thickness / 2;
                    foreach (var u in new[] { from - .2, to }) Mounted("window", wall, u, u + .2, low - .2, high + .2, -n, n, Wood, floor);
                    foreach (var yy in new[] { low - .2, high }) Mounted("window", wall, from - .2, to + .2, yy, yy + .2, -n, n, Wood, floor);
                    foreach (var fraction in new[] { 1.0 / 3, 2.0 / 3 }) { double u = Q(from + (to - from) * fraction); Mounted("window", wall, u - .2, u, low, high, 0, n, Edge, floor); }
                    double midY = Q((low + high) / 2); Mounted("window", wall, from, to, midY - .2, midY, 0, n, Edge, floor);
                    Mounted("window", wall, from - .2, to + .2, low - .4, low - .2, -n, n, Stone, floor);
                    Mounted("window", wall, from - .2, to + .2, high + .2, high + .4, -n, n, Edge, floor);
                }
                foreach (var wall in OrderedWalls(plan).Take(floor == center ? 12 : 6))
                {
                    double length = WallBasis(wall).Length, n = wall.Thickness / 2;
                    Mounted("frame", wall, 0, length, plan.Y + wall.Height - .2, plan.Y + wall.Height, -n, n, Wood, floor);
                    if (floor == 0)
                        foreach (var (from, to) in wall.Opening != null ? new[] { (0.0, wall.Opening.From), (wall.Opening.To, length) } : new[] { (0.0, length) })
                        {
                            if (to - from < .8) continue;
                            Mounted("masonry", wall, from + .2, to - .2, plan.Y, plan.Y + .4, 0, n, Stone, floor);
                        }
                }
                if (floor == 0 && (building.Kind == "market" || building.Kind == "home"))
                {
                    double Distance(WallPanel p) => JsMath.Hypot((p.Rect.X0 + p.Rect.X1) / 2 - focus.Item1, (p.Rect.Z0 + p.Rect.Z1) / 2 - focus.Item2);
                    var panels = Sorted(ArchitectureFloorPlan.WallPanels(plan).Where(p => p.Kind == "solid" && p.Top - p.Bottom >= .8 && Math.Max(p.Rect.X1 - p.Rect.X0, p.Rect.Z1 - p.Rect.Z0) >= 4), (a, b) => Distance(a) - Distance(b)).Take(10);
                    foreach (var panel in panels)
                    {
                        var r = panel.Rect; bool alongX = r.X1 - r.X0 > r.Z1 - r.Z0; double lo = alongX ? r.X0 : r.Z0, hi = alongX ? r.X1 : r.Z1;
                        for (double u = Q(lo + 3.2); u < hi - .4; u += 3.2)
                            Put("frame", alongX ? u - .1 : r.X0, alongX ? u + .1 : r.X1, plan.Y + panel.Bottom, plan.Y + panel.Top, alongX ? r.Z0 : u - .1, alongX ? r.Z1 : u + .1, "#90724e", 0);
                        double bandY = Q(plan.Y + panel.Bottom + .4);
                        Put("frame", r.X0, r.X1, bandY, bandY + .2, r.Z0, r.Z1, "#a88c62", 0);
                    }
                }
            }
            double EdgeDistance(RoofEdge e) => (e.A.X - focus.Item1) * (e.A.X - focus.Item1) + (e.A.Z - focus.Item2) * (e.A.Z - focus.Item2);
            var roofs = Sorted(ProgramRoofEdges(building).Where(e => selected.Contains(e.Floor)), (a, b) => { double c = (b.Floor == center ? 1 : 0) - (a.Floor == center ? 1 : 0); return c != 0 ? c : EdgeDistance(a) - EdgeDistance(b); })
                .Take(cap <= 384 ? 6 : 10);
            foreach (var edge in roofs)
            {
                var wall = new Wall { A = edge.A, B = edge.B, Height = .2, Thickness = .2 }; double length = WallBasis(wall).Length;
                double span = Math.Min(7.2, length), from = Q((length - span) / 2), to = Q(from + span);
                Mounted("tile", wall, from, to, edge.Y - .2, edge.Y, 0, .2, Wood, edge.Floor, true);
                if (edge.Region.Kind != "gallery-flat") Mounted("tile", wall, from, to, edge.Y - .4, edge.Y - .2, 0, .2, "#4e3c2c", edge.Floor, true);
                int tileIndex = 0;
                for (double u = from + .2; u <= to - .2 + 1e-7; u += .6) Mounted("tile", wall, u - .2, u + .2, edge.Y, edge.Y + .2, -.2, .2, tileIndex++ % 3 == 0 ? "#829080" : Tile, edge.Floor, true);
                var plan = body.FloorPlans.First(p => p.Floor == edge.Floor);
                foreach (var u in new[] { from + .6, to - .6 })
                {
                    if (u < from || u > to) continue;
                    var point = WallPoint(wall, u); var below = plan.Walls.FirstOrDefault(c => WallDistanceSquared(c, point) < 1e-7);
                    if (below == null || edge.Region.Bottom - (plan.Y + below.Height) < .2) continue;
                    double wallTop = plan.Y + below.Height;
                    if (edge.Region.Bottom - wallTop >= .4 - 1e-7)
                    {
                        Mounted("bracket", wall, u - .2, u + .2, wallTop, edge.Region.Bottom - .2, 0, .2, Edge, edge.Floor, true);
                        Mounted("bracket", wall, u - .6, u + .6, edge.Region.Bottom - .2, edge.Region.Bottom, -.2, .2, Wood, edge.Floor, true);
                    }
                    else Mounted("bracket", wall, u - .2, u + .2, wallTop, edge.Region.Bottom, -.2, .2, Edge, edge.Floor, true);
                }
            }
            return parts;
        }
    }
}
