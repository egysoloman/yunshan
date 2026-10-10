// Port of src/architecture-floor-plan.ts: the shared floor geometry contract
// (rooms, walls, openings, stairs, fixtures, support and in-building routes).
// Rendering, walking, NPC routes and saves all read this one description.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.CompilerServices;
using Yunshan.Core.Geometry;

namespace Yunshan.Core
{
    public sealed class Rect
    {
        public double X0, X1, Z0, Z1;
        public Rect(double x0, double x1, double z0, double z1) { X0 = x0; X1 = x1; Z0 = z0; Z1 = z1; }
        public Rect Copy() => new Rect(X0, X1, Z0, Z1);
    }

    /// <summary>A [x, z] pair (TypeScript tuple). Shared by reference like the original arrays.</summary>
    public sealed class Point2
    {
        public double X, Z;
        public Point2(double x, double z) { X = x; Z = z; }
        public string Key => JsMath.ToJsString(X) + "," + JsMath.ToJsString(Z);
    }

    public sealed class WallOpening { public double From, To, Height; public string Use; }
    public sealed class WallWindow { public double From, To, Bottom, Top; }
    public sealed class Wall
    {
        public Point2 A, B;
        public double Thickness, Height;
        public WallOpening Opening;
        public List<WallWindow> Windows;
    }
    public sealed class FloorFixture { public string Id, Kind; public Rect Rect; public double Bottom, Top; }
    public sealed class StairSurface { public string Id, Kind; public Rect Rect; public double Bottom, Top; public int FromFloor, ToFloor; }
    public sealed class UsePoint { public string Id; public double X, Z; }

    public sealed class FloorPlan
    {
        public int Floor;
        public double Y, CeilingY;
        public Rect Broadphase;
        public List<Rect> Interior, Circulation, Courtyard;
        public Rect StairHole, StairLanding;
        public List<FloorFixture> Fixtures = new List<FloorFixture>();
        public List<StairSurface> StairTreads = new List<StairSurface>(), StairLandings = new List<StairSurface>();
        public List<Wall> Walls;
        public Point2 Stair;
        public UsePoint UsePoint;
        public List<UsePoint> UsePoints;
        public string Program, Permission;
    }

    public sealed class BuildingBody
    {
        public string BuildingId, Family, Candidate, RoofRhythm;
        public bool NeedsV4, PreserveExistingMesh;
        public double Width, Depth, Height; public int Floors, Basements; public Vec3 Door;
        public List<FloorPlan> FloorPlans;
    }

    public sealed class WallPanel { public Rect Rect; public double Bottom, Top; public string Kind; }
    public sealed class FloorLink { public int FromFloor, ToFloor; }
    public sealed class FloorSupport { public string Kind; public int Floor; public double Y; public double LocalX, LocalZ; public FloorLink Link; }
    public sealed class RoofRegion { public Rect Rect; public double Bottom, Top; public int Floor; public string Kind, GableAxis; }

    public static class ArchitectureFloorPlan
    {
        public const string GeometryVersion = "architecture-v4-program-bodies-02-stairs-v1";
        public const string Profile = "v4-program-bodies-02";
        public const int ContinuousStairGeometryRevision = 2;
        const double Eps = 1e-7;

        static bool ContinuousStairs(Building b) => b.StairGeometryRevision == ContinuousStairGeometryRevision;
        public static double Q(double n) => JsMath.Round(n * 5) / 5;
        static Rect R(double x0, double x1, double z0, double z1) => new Rect(Q(x0), Q(x1), Q(z0), Q(z1));
        static double Sq(double v) => v * v;
        public static bool Contains(Rect r, double x, double z) => x >= r.X0 - Eps && x <= r.X1 + Eps && z >= r.Z0 - Eps && z <= r.Z1 + Eps;
        public static bool ContainsUnion(IReadOnlyList<Rect> rs, double x, double z) { for (int i = 0; i < rs.Count; i++) if (Contains(rs[i], x, z)) return true; return false; }

        public static string FamilyOf(Building b) =>
            b.Kind == "home" || b.Kind == "farm" ? "home" : b.Kind == "market" ? "market" : b.Kind == "workshop" ? "workshop"
            : b.Kind == "hall" || b.Kind == "school" || b.Kind == "police" || b.Kind == "core" ? "civic-academy"
            : b.Kind == "bank" || b.Kind == "clinic" ? "finance-health" : "transport-waterfront";

        static (double Width, double Depth) RawFloorDimensions(Building b, int floor)
        {
            if (floor >= 0 && b.FloorFootprints != null && floor < b.FloorFootprints.Count && b.FloorFootprints[floor] != null) return (b.FloorFootprints[floor].Width, b.FloorFootprints[floor].Depth);
            return (b.Width, b.Depth);
        }

        public static Vec3 RawStairPosition(Building b, int floor)
        {
            double width = b.Width, depth = b.Depth;
            if (b.FloorFootprints != null && b.FloorFootprints.Count > 0) foreach (var p in b.FloorFootprints) { width = JsMath.Min(width, p.Width); depth = JsMath.Min(depth, p.Depth); }
            else { width = JsMath.Min(width, b.Width); depth = JsMath.Min(depth, b.Depth); }
            return new Vec3(b.Position.X - width * .32, b.Position.Y + .6 + floor * b.Height / b.Floors, b.Position.Z - depth * .25);
        }

        static List<double> Cuts(IEnumerable<Rect> rects, bool x)
        {
            var values = new List<double>();
            foreach (var r in rects) { values.Add(Q(x ? r.X0 : r.Z0)); values.Add(Q(x ? r.X1 : r.Z1)); }
            return Js.DistinctSorted(values);
        }

        /// <summary>Rectilinear union boundary loops (counter-clockwise corners).</summary>
        public static List<List<Point2>> BoundaryLoops(IReadOnlyList<Rect> regions, IReadOnlyList<Rect> holes = null)
        {
            holes ??= Array.Empty<Rect>();
            var all = regions.Concat(holes).ToList();
            foreach (var r in all)
                if (!IsFinite(r.X0) || !IsFinite(r.X1) || !IsFinite(r.Z0) || !IsFinite(r.Z1) || r.X1 <= r.X0 || r.Z1 <= r.Z0) throw new InvalidOperationException("invalid region");
            var xs = Cuts(all, true); var zs = Cuts(all, false);
            int nx = xs.Count - 1, nz = zs.Count - 1;
            var occupancy = new bool[Math.Max(0, nx) * Math.Max(0, nz)];
            for (int i = 0; i < nx; i++) for (int j = 0; j < nz; j++)
                    occupancy[i * nz + j] = ContainsUnion(regions, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2) && !ContainsUnion(holes, (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2);
            bool Occupied(int i, int j) => i >= 0 && j >= 0 && i < nx && j < nz && occupancy[i * nz + j];
            var edges = new OrderedMap<string, List<Point2>>();
            void Add(Point2 a, Point2 b) { var k = a.Key; if (!edges.TryGetValue(k, out var list)) { list = new List<Point2>(); edges.Set(k, list); } list.Add(b); }
            for (int i = 0; i < nx; i++) for (int j = 0; j < nz; j++) if (Occupied(i, j))
                    {
                        if (!Occupied(i, j - 1)) Add(new Point2(xs[i], zs[j]), new Point2(xs[i + 1], zs[j]));
                        if (!Occupied(i + 1, j)) Add(new Point2(xs[i + 1], zs[j]), new Point2(xs[i + 1], zs[j + 1]));
                        if (!Occupied(i, j + 1)) Add(new Point2(xs[i + 1], zs[j + 1]), new Point2(xs[i], zs[j + 1]));
                        if (!Occupied(i - 1, j)) Add(new Point2(xs[i], zs[j + 1]), new Point2(xs[i], zs[j]));
                    }
            var loops = new List<List<Point2>>();
            while (edges.Count > 0)
            {
                string first = edges.FirstKey, cursor = first; var loop = new List<Point2>();
                do
                {
                    if (!edges.TryGetValue(cursor, out var list) || list.Count != 1) throw new InvalidOperationException($"ambiguous/disconnected boundary at {cursor}");
                    var parts = cursor.Split(',');
                    loop.Add(new Point2(ParseJsNumber(parts[0]), ParseJsNumber(parts[1])));
                    var next = list[0]; edges.Delete(cursor); cursor = next.Key;
                } while (cursor != first);
                var corners = new List<Point2>();
                for (int i = 0; i < loop.Count; i++)
                {
                    Point2 p = loop[i], a = loop[(i + loop.Count - 1) % loop.Count], b = loop[(i + 1) % loop.Count];
                    if (Math.Abs((p.X - a.X) * (b.Z - p.Z) - (p.Z - a.Z) * (b.X - p.X)) > Eps) corners.Add(p);
                }
                if (corners.Count < 4) throw new InvalidOperationException("degenerate polygon boundary");
                loops.Add(corners);
            }
            return loops;
        }

        static bool IsFinite(double v) => !double.IsNaN(v) && !double.IsInfinity(v);
        static double ParseJsNumber(string s) => double.Parse(s, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture);

        /// <summary>Disjoint rectangle cover of the occupied union.</summary>
        public static List<Rect> RectangleCover(IReadOnlyList<Rect> regions, IReadOnlyList<Rect> holes = null)
        {
            holes ??= Array.Empty<Rect>();
            var all = regions.Concat(holes).ToList();
            var xs = Cuts(all, true); var zs = Cuts(all, false);
            int nx = xs.Count - 1, nz = zs.Count - 1;
            var filled = new HashSet<int>();
            for (int z = 0; z < nz; z++) for (int x = 0; x < nx; x++)
                    if (ContainsUnion(regions, (xs[x] + xs[x + 1]) / 2, (zs[z] + zs[z + 1]) / 2) && !ContainsUnion(holes, (xs[x] + xs[x + 1]) / 2, (zs[z] + zs[z + 1]) / 2)) filled.Add(z * nx + x);
            var cover = new List<Rect>();
            for (int z = 0; z < nz; z++) for (int x = 0; x < nx; x++) if (filled.Contains(z * nx + x))
                    {
                        int endX = x + 1, endZ = z + 1;
                        while (endX < nx && filled.Contains(z * nx + endX)) endX++;
                        while (endZ < nz) { bool all2 = true; for (int dx = 0; dx < endX - x; dx++) if (!filled.Contains(endZ * nx + x + dx)) { all2 = false; break; } if (!all2) break; endZ++; }
                        for (int zz = z; zz < endZ; zz++) for (int xx = x; xx < endX; xx++) filled.Remove(zz * nx + xx);
                        cover.Add(R(xs[x], xs[endX], zs[z], zs[endZ]));
                    }
            return cover;
        }

        static double CircleRectDistanceSquared(double x, double z, Rect r) => Sq(JsMath.Max(JsMath.Max(r.X0 - x, 0), x - r.X1)) + Sq(JsMath.Max(JsMath.Max(r.Z0 - z, 0), z - r.Z1));

        static List<FloorFixture> CreateFloorFixtures(Building b, FloorPlan p)
        {
            var fixtures = new List<FloorFixture>();
            bool CanPlace(Rect r)
            {
                foreach (var (x, z) in new[] { (r.X0, r.Z0), (r.X0, r.Z1), (r.X1, r.Z0), (r.X1, r.Z1) }) if (!ContainsUnion(p.Interior, x, z) || !CanStandInFloorPlan(p, x, z, .05)) return false;
                var stairs = new List<Rect> { p.StairLanding }; stairs.AddRange(p.StairTreads.Select(t => t.Rect)); stairs.AddRange(p.StairLandings.Select(t => t.Rect));
                if (ContainsUnion(stairs, (r.X0 + r.X1) / 2, (r.Z0 + r.Z1) / 2)) return false;
                if (p.UsePoints.Any(point => CircleRectDistanceSquared(point.X, point.Z, r) < .8 * .8 - Eps)) return false;
                return !fixtures.Any(f => r.X0 < f.Rect.X1 + .4 && r.X1 > f.Rect.X0 - .4 && r.Z0 < f.Rect.Z1 + .4 && r.Z1 > f.Rect.Z0 - .4);
            }
            foreach (var point in p.UsePoints)
            {
                double width = b.Kind == "market" ? 3.2 : 2.4; var r = R(point.X - width / 2, point.X + width / 2, point.Z - 2, point.Z - .8);
                if (CanPlace(r)) fixtures.Add(new FloorFixture { Id = point.Id + ":" + (b.Kind == "market" ? "counter" : "table"), Kind = b.Kind == "market" ? "counter" : "table", Rect = r, Bottom = 0, Top = b.Kind == "market" ? 1 : .8 });
            }
            if (b.Kind == "home")
                foreach (var region in RectangleCover(p.Interior))
                {
                    var r = R(region.X0 + .8, region.X0 + 3.2, region.Z0 + .8, region.Z0 + 2); if (!CanPlace(r)) continue;
                    fixtures.Add(new FloorFixture { Id = "home-bed", Kind = "bed", Rect = r, Bottom = 0, Top = .6 }); break;
                }
            return fixtures;
        }

        static BuildingBody MakeBody(Building b)
        {
            bool commercial = b.CommercialGeometryRevision == 1;
            string candidate = commercial ? "v6-commercial" : "v4-wings", family = FamilyOf(b);
            var plans = new List<FloorPlan>(); double floorHeight = b.Height / b.Floors;
            int basements = b.Basements ?? 0;
            for (int floor = basements > 0 ? -basements : 0; floor < b.Floors; floor++)
            {
                var (w, d) = RawFloorDimensions(b, floor);
                var full = new Rect(-w / 2, w / 2, -d / 2, d / 2);
                var originalStair = RawStairPosition(b, floor); var stair = new Point2(originalStair.X - b.Position.X, originalStair.Z - b.Position.Z);
                double levels = JsMath.Round(floorHeight / .2), longestRun = JsMath.Max(Math.Floor(levels / 2), Math.Ceiling(levels / 2)) * .4;
                var stairHull = R(stair.X - 2.4, stair.X + 2.4, stair.Z - 1.2, stair.Z + .8 + longestRun + 2);
                Rect Norm(double x0, double x1, double z0, double z1) => R(w * x0, w * x1, d * z0, d * z1);
                var spine = Norm(-.08, .08, -.42, floor == 0 ? .5 : .05);
                List<Rect> interior;
                if (commercial || floor < 0) interior = new List<Rect> { full };
                else if (family == "home")
                {
                    interior = new List<Rect> { Norm(-.5, .02, -.5, .04), spine };
                    if (floor < 2) { interior.Add(Norm(.14, .46, -.34, .06)); interior.Add(Norm(-.06, .18, -.18, -.06)); }
                    if (floor == 0) { interior.Add(Norm(-.48, -.22, .18, .44)); interior.Add(Norm(-.32, -.20, .00, .20)); }
                }
                else if (family == "market")
                {
                    interior = new List<Rect> { Norm(-.5, .5, -.5, -.18), spine };
                    if (floor == 0) { interior.Add(Norm(-.5, -.20, .04, .34)); interior.Add(Norm(-.16, .16, .04, .34)); interior.Add(Norm(.20, .5, .04, .34)); }
                }
                else if (family == "workshop") interior = new List<Rect> { Norm(-.5, .5, -.5, floor == b.Floors - 1 ? -.18 : .20), spine };
                else if (family == "civic-academy")
                {
                    interior = new List<Rect> { Norm(-.5, floor < 2 ? .5 : .20, -.5, -.26), spine };
                    if (floor < 2) { interior.Add(Norm(-.5, -.32, -.28, .26)); interior.Add(Norm(.30, .5, -.28, .26)); }
                    if (floor == 0) interior.Add(Norm(-.26, .26, .36, .5));
                }
                else if (family == "finance-health" && b.Kind == "bank") interior = floor < 2 ? new List<Rect> { full } : new List<Rect> { Norm(-.5, .14, -.5, .18), spine };
                else if (family == "finance-health")
                {
                    interior = new List<Rect> { Norm(-.5, -.26, -.5, .36), Norm(-.28, .30, -.08, .08), spine };
                    if (floor < Math.Max(2, b.Floors - 2)) interior.Add(Norm(.28, .5, -.40, .28));
                }
                else
                {
                    interior = new List<Rect> { Norm(-.5, -.20, -.5, .02) };
                    if (floor == 0) interior.Add(spine);
                    if (floor == 0) interior.Add(Norm(.26, .5, -.5, -.18));
                }
                interior.Add(stairHull);
                List<Rect> galleries = family == "market" ? new List<Rect> { Norm(-.5, .5, -.08, .04), Norm(-.5, .5, .34, .46) }
                    : family == "home" ? new List<Rect> { Norm(-.20, .18, .02, .14) }
                    : family == "civic-academy" ? new List<Rect> { Norm(-.32, .30, .18, .30) }
                    : family == "finance-health" ? new List<Rect> { Norm(-.26, .28, .12, .22) }
                    : family == "transport-waterfront" ? new List<Rect> { Norm(-.20, .26, -.38, .30), Norm(.26, .5, -.08, .28) }
                    : new List<Rect> { Norm(-.46, .46, .22, .36) };
                var circulation = floor == 0 ? RectangleCover(galleries, interior) : new List<Rect>();
                var courtyard = floor == 0 ? RectangleCover(new List<Rect> { full }, interior) : new List<Rect>();
                double height = Q(floorHeight - .4);
                var walls = new List<Wall>();
                foreach (var loop in BoundaryLoops(interior))
                    for (int i = 0; i < loop.Count; i++)
                    {
                        Point2 a = loop[i], z = loop[(i + 1) % loop.Count];
                        double length = JsMath.Hypot(z.X - a.X, z.Z - a.Z);
                        var wall = new Wall { A = a, B = z, Thickness = .4, Height = height };
                        bool entrance = floor == 0 && Math.Abs(a.Z - d / 2) < Eps && Math.Abs(z.Z - d / 2) < Eps && JsMath.Min(a.X, z.X) < 0 && JsMath.Max(a.X, z.X) > 0;
                        bool courtyardDoor = floor == 0 && !entrance && length >= 4 && Math.Abs((a.X + z.X) / 2) < w * .48 && Math.Abs((a.Z + z.Z) / 2) < d * .4;
                        if (entrance || courtyardDoor)
                        {
                            double halfWidth = Q(JsMath.Min(entrance ? 2.4 : 1.6, (length - .8) / 2)), mid = entrance ? Math.Abs(a.X) : length / 2;
                            wall.Opening = new WallOpening { From = Q(mid - halfWidth), To = Q(mid + halfWidth), Height = Q(JsMath.Min(2.8, height)), Use = entrance ? "entrance" : "courtyard" };
                        }
                        wall.Windows = new List<WallWindow>();
                        for (double mid = 2.4; mid < length - 1.6; mid += 4.8)
                        {
                            double half = commercial ? 1.8 : .8, from = Q(mid - half), to = Q(mid + half);
                            if (to > length - .6) continue;
                            if (wall.Opening != null && from < wall.Opening.To + .6 && to > wall.Opening.From - .6) continue;
                            wall.Windows.Add(new WallWindow { From = from, To = to, Bottom = commercial ? .4 : .8, Top = Q(commercial ? height - .4 : JsMath.Min(2.2, height - .4)) });
                        }
                        walls.Add(wall);
                    }
                var usePoint = family == "home" && floor >= 0 ? new UsePoint { Id = "program", X = Q(-w * .20), Z = Q(-d * .26) }
                    : family == "finance-health" && b.Kind != "bank" && floor >= 0 ? new UsePoint { Id = "program", X = 0, Z = 0 }
                    : family == "transport-waterfront" && floor > 0 ? new UsePoint { Id = "program", X = Q(-w * .40), Z = Q(-d * .08) }
                    : new UsePoint { Id = "program", X = 0, Z = Q(-d * .34) };
                List<UsePoint> usePoints = commercial && floor >= 2
                    ? new List<UsePoint> { new UsePoint { Id = "program", X = usePoint.X, Z = usePoint.Z }, new UsePoint { Id = "office-west", X = Q(-w * .18), Z = Q(d * .12) }, new UsePoint { Id = "office-east", X = Q(w * .22), Z = Q(d * .12) } }
                    : family == "market" && floor == 0
                    ? new List<UsePoint> { new UsePoint { Id = "sale-west", X = Q(-w * .35), Z = Q(d * .18) }, new UsePoint { Id = "sale-center", X = 0, Z = Q(d * .18) }, new UsePoint { Id = "sale-east", X = Q(w * .35), Z = Q(d * .18) } }
                    : new List<UsePoint> { new UsePoint { Id = "program", X = usePoint.X, Z = usePoint.Z } };
                string program = floor < 0 ? (b.BasementUses != null && -floor - 1 < b.BasementUses.Count ? b.BasementUses[-floor - 1] : null) ?? "地下空间"
                    : (b.FloorUses != null && floor < b.FloorUses.Count ? b.FloorUses[floor] : null) ?? b.Kind;
                string permission = floor < 0 ? "original-canAccessFloor"
                    : (b.FloorPermissions != null && floor < b.FloorPermissions.Count ? b.FloorPermissions[floor] : null) ?? (floor < (b.PublicFloors ?? b.Floors) ? "public" : b.RequiredPermission ?? "public");
                plans.Add(new FloorPlan
                {
                    Floor = floor, Y = Q(floor * floorHeight), CeilingY = Q((floor + 1) * floorHeight), Broadphase = full, Interior = interior, Circulation = circulation, Courtyard = courtyard,
                    StairHole = floor > -basements ? R(stair.X - 2, stair.X + 2, stair.Z + .8, stair.Z + .8 + longestRun + 2) : null,
                    StairLanding = R(stair.X - 1.8, stair.X + 1.8, stair.Z - .8, stair.Z + .8), Walls = walls, Stair = stair, UsePoint = usePoint, UsePoints = usePoints, Program = program, Permission = permission,
                });
            }
            for (int index = 0; index < plans.Count; index++)
            {
                var p = plans[index]; var next = index + 1 < plans.Count ? plans[index + 1] : null;
                if (next == null) continue;
                double levels = JsMath.Round((next.Y - p.Y) / .2); int a = (int)Math.Floor(levels / 2), z = (int)levels - a;
                double run = Math.Max(a, z) * .4, start = p.Stair.Z + .8, offset = run - a * .4;
                StairSurface Surface(string id, Rect region, double top, string kind) => new StairSurface { Id = id, Rect = region, Bottom = Q(top - .2), Top = Q(top), FromFloor = p.Floor, ToFloor = next.Floor, Kind = kind };
                if (ContinuousStairs(b))
                {
                    double origin = JsMath.Round(start * 5); const int going = 2; int runTicks = Math.Max(a, z) * going, offsetTicks = runTicks - a * going;
                    double Edge(int ticks) => (origin + ticks) / 5;
                    if (offsetTicks > 0) p.StairLandings.Add(Surface("lower-link", R(p.Stair.X - 1.8, p.Stair.X - .2, Edge(0), Edge(offsetTicks)), p.Y, "landing"));
                    for (int i = 1; i <= a; i++) p.StairTreads.Add(Surface($"up-{i}", R(p.Stair.X - 1.8, p.Stair.X - .2, Edge(offsetTicks + (i - 1) * going), Edge(offsetTicks + i * going)), p.Y + i * .2, "tread"));
                    p.StairLandings.Add(Surface("half-turn", R(p.Stair.X - 1.8, p.Stair.X + 1.8, Edge(runTicks), Edge(runTicks + 8)), p.Y + a * .2, "landing"));
                    for (int i = 1; i <= z; i++) p.StairTreads.Add(Surface($"return-{i}", R(p.Stair.X + .2, p.Stair.X + 1.8, Edge(runTicks - i * going), Edge(runTicks - (i - 1) * going)), p.Y + (a + i) * .2, "tread"));
                }
                else
                {
                    if (offset > .01) p.StairLandings.Add(Surface("lower-link", R(p.Stair.X - 1.8, p.Stair.X - .2, start, start + offset), p.Y, "landing"));
                    for (int i = 1; i <= a; i++) p.StairTreads.Add(Surface($"up-{i}", R(p.Stair.X - 1.8, p.Stair.X - .2, start + offset + (i - 1) * .4, start + offset + i * .4), p.Y + i * .2, "tread"));
                    p.StairLandings.Add(Surface("half-turn", R(p.Stair.X - 1.8, p.Stair.X + 1.8, start + run, start + run + 1.6), p.Y + a * .2, "landing"));
                    for (int i = 1; i <= z; i++) p.StairTreads.Add(Surface($"return-{i}", R(p.Stair.X + .2, p.Stair.X + 1.8, start + run - i * .4, start + run - (i - 1) * .4), p.Y + (a + i) * .2, "tread"));
                }
            }
            foreach (var p in plans) p.Fixtures = CreateFloorFixtures(b, p);
            string rhythm = commercial ? "terraced-finance-tower" : family switch
            {
                "home" => "split-gable", "market" => "hall-and-shops", "workshop" => "industrial-spans", "civic-academy" => "court-wings",
                "finance-health" => "hall-and-service-tower", _ => "covered-platform",
            };
            return new BuildingBody { BuildingId = b.Id, Family = family, Candidate = candidate, NeedsV4 = true, PreserveExistingMesh = false, Width = b.Width, Depth = b.Depth, Height = b.Height, Floors = b.Floors, Basements = basements, Door = b.Door.Copy(), FloorPlans = plans, RoofRhythm = rhythm };
        }

        sealed class BodyCache
        {
            public bool Commercial, Continuous; public double Width, Depth, Height, Rotation, X, Y, Z; public int Floors, Basements;
            public string Kind, RequiredPermission, Facility; public int? PublicFloors;
            public object Footprints, Uses, Permissions; public BuildingBody Body;
        }
        static readonly ConditionalWeakTable<Building, BodyCache> Bodies = new ConditionalWeakTable<Building, BodyCache>();

        public static BuildingBody GetBuildingBody(Building b)
        {
            if (b.FloorPlanProfile != Profile || b.Id == "core-main" || b.Kind == "pavilion") return null;
            if (Bodies.TryGetValue(b, out var c) && c.Commercial == (b.CommercialGeometryRevision == 1) && c.Continuous == ContinuousStairs(b) && c.Width == b.Width && c.Depth == b.Depth && c.Height == b.Height
                && c.Floors == b.Floors && c.Basements == (b.Basements ?? 0) && c.Rotation == b.Rotation && c.X == b.Position.X && c.Y == b.Position.Y && c.Z == b.Position.Z && c.Kind == b.Kind
                && c.PublicFloors == b.PublicFloors && c.RequiredPermission == b.RequiredPermission && c.Facility == b.Facility
                && ReferenceEquals(c.Footprints, b.FloorFootprints) && ReferenceEquals(c.Uses, b.FloorUses) && ReferenceEquals(c.Permissions, b.FloorPermissions)) return c.Body;
            var body = MakeBody(b);
            Bodies.Remove(b);
            Bodies.Add(b, new BodyCache
            {
                Commercial = b.CommercialGeometryRevision == 1, Continuous = ContinuousStairs(b), Width = b.Width, Depth = b.Depth, Height = b.Height, Floors = b.Floors, Basements = b.Basements ?? 0,
                Rotation = b.Rotation, X = b.Position.X, Y = b.Position.Y, Z = b.Position.Z, Kind = b.Kind, PublicFloors = b.PublicFloors, RequiredPermission = b.RequiredPermission, Facility = b.Facility,
                Footprints = b.FloorFootprints, Uses = b.FloorUses, Permissions = b.FloorPermissions, Body = body,
            });
            return body;
        }

        public static FloorPlan GetBuildingFloorPlan(Building b, int floor)
        {
            var body = GetBuildingBody(b); if (body == null) return null;
            foreach (var p in body.FloorPlans) if (p.Floor == floor) return p;
            return null;
        }

        public static Vec3 BuildingLocalPosition(Building b, Vec3 p)
        {
            double dx = p.X - b.Position.X, dz = p.Z - b.Position.Z, c = JsMath.Cos(b.Rotation), s = JsMath.Sin(b.Rotation);
            return new Vec3(dx * c - dz * s, p.Y - b.Position.Y - .6, dx * s + dz * c);
        }
        public static Vec3 BuildingWorldPosition(Building b, Vec3 p)
        {
            double c = JsMath.Cos(b.Rotation), s = JsMath.Sin(b.Rotation);
            return new Vec3(b.Position.X + p.X * c + p.Z * s, b.Position.Y + .6 + p.Y, b.Position.Z - p.X * s + p.Z * c);
        }
        public static Vec3 GetFloorPlanStairPosition(Building b, int floor)
        {
            var p = GetBuildingFloorPlan(b, floor);
            return p != null ? BuildingWorldPosition(b, new Vec3(p.Stair.X, p.Y, p.Stair.Z)) : RawStairPosition(b, floor);
        }
        public static Vec3 GetBuildingEntrance(Building b)
        {
            var p = GetBuildingFloorPlan(b, 0); var w = p?.Walls.FirstOrDefault(x => x.Opening?.Use == "entrance");
            if (p == null || w?.Opening == null) return b.Door.Copy();
            double length = JsMath.Hypot(w.B.X - w.A.X, w.B.Z - w.A.Z), t = (w.Opening.From + w.Opening.To) / 2;
            return BuildingWorldPosition(b, new Vec3(w.A.X + (w.B.X - w.A.X) * t / length, p.Y, w.A.Z + (w.B.Z - w.A.Z) * t / length));
        }

        static readonly HashSet<string> ServiceKinds = new HashSet<string> { "home", "school", "hall", "police", "clinic", "bank", "station", "airport", "starport", "dock", "core", "farm" };
        static readonly HashSet<string> SaleKinds = new HashSet<string> { "market", "workshop", "farm", "dock" };
        public static List<BuildingFunctionPoint> GetBuildingUsePoints(Building b, int floor)
        {
            var p = GetBuildingFloorPlan(b, floor); var result = new List<BuildingFunctionPoint>(); if (p == null) return result;
            var purposes = new List<string> { "work" };
            if (ServiceKinds.Contains(b.Kind)) purposes.Add("service");
            if (floor == 0 && SaleKinds.Contains(b.Kind)) purposes.Add("sale");
            foreach (var point in p.UsePoints) foreach (var purpose in purposes)
                    result.Add(new BuildingFunctionPoint { Id = $"{floor}:{point.Id}:{purpose}", Purpose = purpose, Floor = floor, Position = BuildingWorldPosition(b, new Vec3(point.X, p.Y, point.Z)) });
            return result;
        }

        static readonly ConditionalWeakTable<FloorPlan, List<WallPanel>> PanelCache = new ConditionalWeakTable<FloorPlan, List<WallPanel>>();
        sealed class Gap { public double From, To, Bottom, Top; public string Kind; }
        /// <summary>A real door is empty; windows are glass solids.</summary>
        public static List<WallPanel> WallPanels(FloorPlan p)
        {
            if (PanelCache.TryGetValue(p, out var cached)) return cached;
            var panels = new List<WallPanel>();
            foreach (var w in p.Walls)
            {
                double length = JsMath.Hypot(w.B.X - w.A.X, w.B.Z - w.A.Z), dx = (w.B.X - w.A.X) / length, dz = (w.B.Z - w.A.Z) / length;
                var gaps = new List<Gap>();
                if (w.Opening != null) gaps.Add(new Gap { From = w.Opening.From, To = w.Opening.To, Bottom = 0, Top = w.Opening.Height, Kind = "door" });
                foreach (var o in w.Windows ?? new List<WallWindow>()) gaps.Add(new Gap { From = o.From, To = o.To, Bottom = o.Bottom, Top = o.Top, Kind = "window" });
                var xsIn = new List<double> { 0, length }; foreach (var o in gaps) { xsIn.Add(o.From); xsIn.Add(o.To); }
                var ysIn = new List<double> { 0, w.Height }; foreach (var o in gaps) { ysIn.Add(o.Bottom); ysIn.Add(o.Top); }
                var xs = Js.DistinctSorted(xsIn); var ys = Js.DistinctSorted(ysIn);
                for (int i = 0; i < xs.Count - 1; i++) for (int j = 0; j < ys.Count - 1; j++)
                    {
                        double from = xs[i], to = xs[i + 1], bottom = ys[j], top = ys[j + 1]; if (to - from < Eps || top - bottom < Eps) continue;
                        var gap = gaps.FirstOrDefault(o => (from + to) / 2 > o.From - Eps && (from + to) / 2 < o.To + Eps && (bottom + top) / 2 > o.Bottom - Eps && (bottom + top) / 2 < o.Top + Eps);
                        if (gap?.Kind == "door") continue;
                        double thickness = gap?.Kind == "window" ? .2 : w.Thickness;
                        double tx = dz != 0 ? thickness / 2 : 0, tz = dx != 0 ? thickness / 2 : 0;
                        panels.Add(new WallPanel
                        {
                            Rect = R(JsMath.Min(w.A.X + dx * from, w.A.X + dx * to) - tx, JsMath.Max(w.A.X + dx * from, w.A.X + dx * to) + tx, JsMath.Min(w.A.Z + dz * from, w.A.Z + dz * to) - tz, JsMath.Max(w.A.Z + dz * from, w.A.Z + dz * to) + tz),
                            Bottom = bottom, Top = top, Kind = gap?.Kind == "window" ? "glass" : "solid",
                        });
                    }
            }
            PanelCache.Add(p, panels); return panels;
        }

        sealed class SupportCache { public List<Rect> Regions; public List<List<Point2>> Boundaries; }
        static readonly ConditionalWeakTable<FloorPlan, SupportCache> SupportCaches = new ConditionalWeakTable<FloorPlan, SupportCache>();
        public static List<Rect> GetFloorPlanSlabRegions(FloorPlan p) => Support(p).Regions;
        static SupportCache Support(FloorPlan p)
        {
            if (SupportCaches.TryGetValue(p, out var cached)) return cached;
            var baseRegions = p.Interior.Concat(p.Circulation).Concat(p.Courtyard).ToList();
            List<Rect> regions;
            if (p.StairHole != null) { regions = RectangleCover(baseRegions, new[] { p.StairHole }); regions.Add(p.StairLanding); }
            else regions = baseRegions;
            cached = new SupportCache { Regions = regions, Boundaries = BoundaryLoops(regions) };
            SupportCaches.Add(p, cached); return cached;
        }

        static double SegmentDistanceSquared(double x, double z, double ax, double az, double bx, double bz)
        {
            double dx = bx - ax, dz = bz - az, lengthSquared = dx * dx + dz * dz;
            if (lengthSquared == 0) return Sq(x - ax) + Sq(z - az);
            double t = JsMath.Max(0, JsMath.Min(1, ((x - ax) * dx + (z - az) * dz) / lengthSquared));
            return Sq(x - ax - dx * t) + Sq(z - az - dz * t);
        }

        public static bool CanStandInFloorPlan(FloorPlan p, double x, double z, double radius = .35)
        {
            var support = Support(p);
            if (!ContainsUnion(support.Regions, x, z)) return false;
            if (radius > 0) foreach (var loop in support.Boundaries) for (int i = 0; i < loop.Count; i++)
                    {
                        Point2 a = loop[i], b = loop[(i + 1) % loop.Count];
                        if (SegmentDistanceSquared(x, z, a.X, a.Z, b.X, b.Z) < radius * radius - Eps) return false;
                    }
            bool Blocks(Rect r, double bottom, double top) => bottom < 1.72 && top > .05 && (radius == 0 ? Contains(r, x, z) : CircleRectDistanceSquared(x, z, r) < radius * radius - Eps);
            foreach (var w in WallPanels(p)) if (Blocks(w.Rect, w.Bottom, w.Top)) return false;
            foreach (var f in p.Fixtures) if (Blocks(f.Rect, f.Bottom, f.Top)) return false;
            return true;
        }

        static List<FloorPlan> NearPlans(Building b, FloorPlan p) => GetBuildingBody(b).FloorPlans.Where(f => Math.Abs(f.Floor - p.Floor) <= 1).ToList();
        static List<StairSurface> StairSurfaces(List<FloorPlan> plans)
        {
            var result = new List<StairSurface>();
            foreach (var f in plans) { result.AddRange(f.StairTreads); result.AddRange(f.StairLandings); }
            return result;
        }

        struct LocalSolid { public Rect Rect; public double Bottom, Top; public bool Steppable; }
        static List<LocalSolid> LocalSolids(FloorPlan p, List<FloorPlan> plans, List<StairSurface> surfaces)
        {
            var result = new List<LocalSolid>();
            foreach (var f in plans)
            {
                foreach (var s in WallPanels(f)) result.Add(new LocalSolid { Rect = s.Rect, Bottom = f.Y + s.Bottom, Top = f.Y + s.Top, Steppable = false });
                foreach (var s in f.Fixtures) result.Add(new LocalSolid { Rect = s.Rect, Bottom = f.Y + s.Bottom, Top = f.Y + s.Top, Steppable = false });
            }
            foreach (var s in surfaces) result.Add(new LocalSolid { Rect = s.Rect, Bottom = s.Bottom, Top = s.Top, Steppable = true });
            foreach (var f in plans) if (f.Floor > p.Floor) foreach (var r in GetFloorPlanSlabRegions(f)) result.Add(new LocalSolid { Rect = r, Bottom = f.Y - .2, Top = f.Y, Steppable = false });
            return result;
        }

        sealed class Choice { public double Top; public string Kind; public int Floor; public FloorLink Link; }
        public static FloorSupport FloorPlanSupport(Building b, int floor, Vec3 worldPosition, double radius = .35)
        {
            var p = GetBuildingFloorPlan(b, floor); if (p == null) return null;
            var local = BuildingLocalPosition(b, worldPosition); var plans = NearPlans(b, p); var surfaces = StairSurfaces(plans);
            var choices = new List<Choice>();
            var baseRegions = GetFloorPlanSlabRegions(p);
            var supportedAt = new Dictionary<double, bool>();
            var footprintByTop = new Dictionary<double, (List<Rect> Regions, List<List<Point2>> Boundaries)>();
            bool DiskSupportedAt(double top)
            {
                if (supportedAt.TryGetValue(top, out var known)) return known;
                if (!footprintByTop.TryGetValue(top, out var footprint))
                {
                    var regions = new List<Rect>();
                    foreach (var slab in plans) if (slab.Y <= top + .22 + Eps && slab.Y >= top - .42 - Eps) regions.AddRange(GetFloorPlanSlabRegions(slab));
                    foreach (var s in surfaces) if (s.Top <= top + .22 + Eps && s.Top >= top - .42 - Eps) regions.Add(s.Rect);
                    footprint = (regions, null); footprintByTop[top] = footprint;
                }
                bool supported = ContainsUnion(footprint.Regions, local.X, local.Z);
                if (supported && radius != 0)
                {
                    var loops = footprint.Boundaries ?? BoundaryLoops(footprint.Regions); footprintByTop[top] = (footprint.Regions, loops);
                    double minimum = radius * radius - Eps;
                    foreach (var loop in loops) { for (int i = 0; i < loop.Count; i++) if (!(SegmentDistanceSquared(local.X, local.Z, loop[i].X, loop[i].Z, loop[(i + 1) % loop.Count].X, loop[(i + 1) % loop.Count].Z) >= minimum)) { supported = false; break; } if (!supported) break; }
                }
                supportedAt[top] = supported; return supported;
            }
            bool raisedStair = false;
            foreach (var s in surfaces) if (Contains(s.Rect, local.X, local.Z) && s.Top > p.Y + Eps && s.Top <= local.Y + .22 + Eps && s.Top >= local.Y - .42 - Eps) { raisedStair = true; break; }
            if (!raisedStair && ContainsUnion(baseRegions, local.X, local.Z) && (radius == 0 || Math.Abs(p.Y - local.Y) <= .42 + Eps) && DiskSupportedAt(p.Y))
            {
                string kind = Contains(p.StairLanding, local.X, local.Z) ? "stairs" : ContainsUnion(p.Interior, local.X, local.Z) ? "room" : ContainsUnion(p.Circulation, local.X, local.Z) ? "gallery" : "courtyard";
                choices.Add(new Choice { Top = p.Y, Kind = kind, Floor = p.Floor });
            }
            bool onStair = surfaces.Any(s => Contains(s.Rect, local.X, local.Z));
            if (onStair) foreach (var s in surfaces)
                {
                    if (!Contains(s.Rect, local.X, local.Z) || s.Top > local.Y + .22 + Eps || s.Top < local.Y - .42 - Eps || !DiskSupportedAt(s.Top)) continue;
                    var target = GetBuildingFloorPlan(b, s.ToFloor);
                    choices.Add(new Choice { Top = s.Top, Kind = "stairs", Floor = s.Top >= target.Y - Eps ? s.ToFloor : s.FromFloor, Link = new FloorLink { FromFloor = s.FromFloor, ToFloor = s.ToFloor } });
                }
            foreach (var f in p.Fixtures) if (Contains(f.Rect, local.X, local.Z) && Math.Abs(local.Y - (p.Y + f.Top)) < .01) choices.Add(new Choice { Top = p.Y + f.Top, Kind = "room", Floor = floor });
            Js.StableSort(choices, (a, z) => Js.Or(Math.Abs(a.Top - local.Y) - Math.Abs(z.Top - local.Y), () => z.Top - a.Top));
            if (radius > 0 && choices.Count == 0) return null;
            var solids = radius > 0 ? LocalSolids(p, plans, surfaces) : new List<LocalSolid>();
            double reach = Math.Abs(radius) + Eps, x0 = local.X - reach, x1 = local.X + reach, z0 = local.Z - reach, z1 = local.Z + reach;
            foreach (var choice in choices)
            {
                bool blocked = false;
                if (radius > 0) foreach (var s in solids)
                    {
                        if (!(s.Top > choice.Top + (s.Steppable ? .22 : .01) && s.Bottom < choice.Top + 1.72 - Eps)) continue;
                        var r = s.Rect;
                        if (r.X0 <= r.X1 && r.Z0 <= r.Z1 && (r.X1 < x0 || r.X0 > x1 || r.Z1 < z0 || r.Z0 > z1)) continue;
                        if (Sq(JsMath.Max(JsMath.Max(r.X0 - local.X, 0), local.X - r.X1)) + Sq(JsMath.Max(JsMath.Max(r.Z0 - local.Z, 0), local.Z - r.Z1)) < radius * radius - Eps) { blocked = true; break; }
                    }
                if (blocked) continue;
                return new FloorSupport { Kind = choice.Kind, Floor = choice.Floor, Y = b.Position.Y + .6 + choice.Top, LocalX = local.X, LocalZ = local.Z, Link = choice.Link };
            }
            return null;
        }

        static bool SegmentIntersectsRectEps(Vec3 a, Vec3 b, Rect r)
        {
            double lo = 0, hi = 1;
            foreach (var (start, change, min, max) in new[] { (a.X, b.X - a.X, r.X0, r.X1), (a.Z, b.Z - a.Z, r.Z0, r.Z1) })
            {
                if (Math.Abs(change) < Eps) { if (start < min || start > max) return false; continue; }
                double t0 = (min - start) / change, t1 = (max - start) / change; lo = JsMath.Max(lo, JsMath.Min(t0, t1)); hi = JsMath.Min(hi, JsMath.Max(t0, t1)); if (lo > hi) return false;
            }
            return true;
        }

        public static bool BlocksFloorPlanMovement(Building b, int floor, Vec3 from, Vec3 to, double radius = .35, double eyeHeight = 1.72)
        {
            var p = GetBuildingFloorPlan(b, floor); if (p == null) return false;
            Vec3 a = BuildingLocalPosition(b, from), z = BuildingLocalPosition(b, to);
            double reach = IsFinite(radius) && IsFinite(a.X) && IsFinite(a.Z) && IsFinite(z.X) && IsFinite(z.Z) ? Math.Abs(radius) + Eps : double.PositiveInfinity;
            double x0 = JsMath.Min(a.X, z.X) - reach, x1 = JsMath.Max(a.X, z.X) + reach, z0 = JsMath.Min(a.Z, z.Z) - reach, z1 = JsMath.Max(a.Z, z.Z) + reach;
            var plans = NearPlans(b, p);
            foreach (var w in LocalSolids(p, plans, StairSurfaces(plans)))
            {
                if (w.Top <= JsMath.Max(a.Y, z.Y) + (w.Steppable ? .22 : .01) || w.Bottom >= JsMath.Max(a.Y, z.Y) + eyeHeight) continue;
                var r = w.Rect;
                if (IsFinite(r.X0) && IsFinite(r.X1) && IsFinite(r.Z0) && IsFinite(r.Z1) && (JsMath.Max(r.X0, r.X1) < x0 || JsMath.Min(r.X0, r.X1) > x1 || JsMath.Max(r.Z0, r.Z1) < z0 || JsMath.Min(r.Z0, r.Z1) > z1)) continue;
                if (SegmentIntersectsRectEps(a, z, r)) return true;
                double distance = JsMath.Min(CircleRectDistanceSquared(a.X, a.Z, r), CircleRectDistanceSquared(z.X, z.Z, r));
                foreach (var (px, pz) in new[] { (r.X0, r.Z0), (r.X0, r.Z1), (r.X1, r.Z0), (r.X1, r.Z1) }) distance = JsMath.Min(distance, SegmentDistanceSquared(px, pz, a.X, a.Z, z.X, z.Z));
                if (distance < radius * radius - Eps) return true;
            }
            return BlocksRoofMovement(b, from, to, radius, eyeHeight);
        }

        public static bool BlocksFloorPlanReferenceMovement(Building b, int floor, Vec3 from, Vec3 to, double radius = .35, double eyeHeight = 1.72)
        {
            var p = GetBuildingFloorPlan(b, floor); if (p == null) return false;
            Vec3 a = BuildingLocalPosition(b, from), z = BuildingLocalPosition(b, to);
            double reach = radius + Eps, x0 = JsMath.Min(a.X, z.X) - reach, x1 = JsMath.Max(a.X, z.X) + reach, z0 = JsMath.Min(a.Z, z.Z) - reach, z1 = JsMath.Max(a.Z, z.Z) + reach;
            var plans = NearPlans(b, p);
            foreach (var solid in LocalSolids(p, plans, StairSurfaces(plans)))
            {
                var r = solid.Rect;
                if (IsFinite(r.X0) && IsFinite(r.X1) && IsFinite(r.Z0) && IsFinite(r.Z1) && IsFinite(solid.Bottom) && IsFinite(solid.Top) && r.X0 <= r.X1 && r.Z0 <= r.Z1 && solid.Bottom < solid.Top
                    && (r.X1 < x0 || r.X0 > x1 || r.Z1 < z0 || r.Z0 > z1)) continue;
                if (UprightCylinderSweep.Blocks(a, z, new UprightCylinderBox(r.X0, r.X1, r.Z0, r.Z1, solid.Bottom, solid.Top), radius, eyeHeight, solid.Steppable ? .22 : .01)) return true;
            }
            return BlocksRoofMovement(b, from, to, radius, eyeHeight);
        }

        static readonly ConditionalWeakTable<BuildingBody, List<RoofRegion>> RoofCache = new ConditionalWeakTable<BuildingBody, List<RoofRegion>>();
        public static List<RoofRegion> GetFloorPlanRoofRegions(BuildingBody body)
        {
            if (RoofCache.TryGetValue(body, out var cached)) return cached;
            var regions = new List<RoofRegion>();
            for (int i = 0; i < body.FloorPlans.Count; i++)
            {
                var p = body.FloorPlans[i]; var next = i + 1 < body.FloorPlans.Count ? body.FloorPlans[i + 1] : null; if (p.Floor < 0) continue;
                var nextInterior = next?.Interior ?? new List<Rect>();
                foreach (var r in RectangleCover(p.Circulation, p.Interior.Concat(nextInterior).ToList()))
                    regions.Add(new RoofRegion { Rect = r, Bottom = p.Y + 2.6, Top = p.Y + 2.8, Floor = p.Floor, Kind = "gallery-flat" });
                foreach (var outline in RectangleCover(p.Interior, nextInterior))
                {
                    var r = outline.Copy(); bool alongX = r.X1 - r.X0 <= r.Z1 - r.Z0; double span = alongX ? r.X1 - r.X0 : r.Z1 - r.Z0;
                    if (JsMath.Round(span * 5) % 2 != 0)
                    {
                        var strip = alongX ? R(r.X1 - .2, r.X1, r.Z0, r.Z1) : R(r.X0, r.X1, r.Z1 - .2, r.Z1);
                        regions.Add(new RoofRegion { Rect = strip, Bottom = p.CeilingY, Top = Q(p.CeilingY + .4), Floor = p.Floor, Kind = "weather-strip" });
                        if (alongX) r.X1 = Q(r.X1 - .2); else r.Z1 = Q(r.Z1 - .2);
                    }
                    if (r.X1 > r.X0 && r.Z1 > r.Z0) regions.Add(new RoofRegion { Rect = r, Bottom = p.CeilingY, Top = Q(p.CeilingY + 1.2), Floor = p.Floor, Kind = "gable", GableAxis = alongX ? "x" : "z" });
                }
            }
            RoofCache.Add(body, regions); return regions;
        }

        static bool LocalSegmentClear(FloorPlan p, Vec3 a, Vec3 b, double radius, Building building, Func<Vec3, Vec3, bool> segmentBlocked)
        {
            if (segmentBlocked != null && segmentBlocked(BuildingWorldPosition(building, a), BuildingWorldPosition(building, b))) return false;
            if (BlocksFloorPlanMovement(building, p.Floor, BuildingWorldPosition(building, a), BuildingWorldPosition(building, b), radius)) return false;
            int steps = (int)JsMath.Max(1, Math.Ceiling(JsMath.Hypot(b.X - a.X, b.Z - a.Z) / .4));
            for (int i = 0; i <= steps; i++) { double t = (double)i / steps; if (!CanStandInFloorPlan(p, a.X + (b.X - a.X) * t, a.Z + (b.Z - a.Z) * t, radius)) return false; }
            return true;
        }

        sealed class RouteGrid { public double X0, Z0, Step; public int Nx, Nz; public bool[] Walkable; }
        static readonly ConditionalWeakTable<FloorPlan, Dictionary<double, RouteGrid>> RouteGrids = new ConditionalWeakTable<FloorPlan, Dictionary<double, RouteGrid>>();
        static RouteGrid GetRouteGrid(FloorPlan p, double radius)
        {
            var maps = RouteGrids.GetOrCreateValue(p); if (maps.TryGetValue(radius, out var found)) return found;
            double step = .8, x0 = Math.Ceiling((p.Broadphase.X0 + radius) / step) * step, z0 = Math.Ceiling((p.Broadphase.Z0 + radius) / step) * step;
            int nx = (int)Math.Floor((p.Broadphase.X1 - radius - x0) / step) + 1, nz = (int)Math.Floor((p.Broadphase.Z1 - radius - z0) / step) + 1;
            var walkable = new bool[nx * nz];
            for (int z = 0; z < nz; z++) for (int x = 0; x < nx; x++) walkable[z * nx + x] = CanStandInFloorPlan(p, x0 + x * step, z0 + z * step, radius);
            var g = new RouteGrid { X0 = x0, Z0 = z0, Nx = nx, Nz = nz, Step = step, Walkable = walkable }; maps[radius] = g; return g;
        }

        sealed class StairRecovery { public FloorLink Link; public int Index; public Vec3 Point; public double Distance; }
        static List<StairRecovery> StairRecoveries(Building b, FloorPlan p, Vec3 from, double radius, FloorSupport support, Func<Vec3, Vec3, bool> segmentBlocked)
        {
            if (support == null) return null;
            var local = BuildingLocalPosition(b, from);
            if (Math.Abs(from.Y - (b.Position.Y + .6 + p.Y)) <= .01 && CanStandInFloorPlan(p, local.X, local.Z, radius)) return null;
            if (support.Link == null && support.Kind != "stairs") return null;
            var candidates = new List<StairRecovery>();
            foreach (int fromFloor in support.Link != null ? new[] { support.Link.FromFloor } : new[] { p.Floor - 1, p.Floor })
            {
                var route = GetFloorPlanStairRoute(b, fromFloor, fromFloor + 1); if (route == null) continue;
                for (int i = 0; i < route.Count - 1; i++)
                {
                    Vec3 a = route[i], z = route[i + 1]; double dx = z.X - a.X, dy = z.Y - a.Y, dz = z.Z - a.Z, l2 = dx * dx + dy * dy + dz * dz;
                    double t = l2 != 0 ? JsMath.Max(0, JsMath.Min(1, ((from.X - a.X) * dx + (from.Y - a.Y) * dy + (from.Z - a.Z) * dz) / l2)) : 0;
                    var nearest = new Vec3(a.X + t * dx, a.Y + t * dy, a.Z + t * dz); double d = JsMath.Hypot(nearest.X - from.X, nearest.Y - from.Y, nearest.Z - from.Z);
                    if ((support.Link == null && Math.Abs(nearest.Y - from.Y) > .01) || (segmentBlocked != null && segmentBlocked(from, nearest)) || BlocksFloorPlanMovement(b, p.Floor, from, nearest, radius)) continue;
                    int steps = (int)JsMath.Max(1, Math.Ceiling(d / .1)); bool clear = true;
                    for (int step = 0; step <= steps; step++)
                    {
                        double fraction = (double)step / steps; var point = new Vec3(from.X + (nearest.X - from.X) * fraction, from.Y + (nearest.Y - from.Y) * fraction, from.Z + (nearest.Z - from.Z) * fraction);
                        var actual = FloorPlanSupport(b, p.Floor, point, radius);
                        if (actual == null || (support.Link == null && Math.Abs(actual.Y - point.Y) > .01)) { clear = false; break; }
                    }
                    if (clear) candidates.Add(new StairRecovery { Link = new FloorLink { FromFloor = fromFloor, ToFloor = fromFloor + 1 }, Index = i, Point = nearest, Distance = d });
                }
            }
            Js.StableSort(candidates, (a, z) => Js.Or(a.Distance - z.Distance, () => Js.Or(a.Link.FromFloor - z.Link.FromFloor, () => a.Index - z.Index)));
            return candidates;
        }

        /// <summary>Deterministic physical route on one shared floor. Legacy/unknown returns null.</summary>
        public static List<Vec3> FindFloorPlanRoute(Building b, int floor, Vec3 fromWorld, Vec3 toWorld, double radius = .35, Func<Vec3, Vec3, bool> segmentBlocked = null)
        {
            var p = GetBuildingFloorPlan(b, floor); if (p == null) return null;
            var support = FloorPlanSupport(b, floor, fromWorld, radius);
            if (StairRecoveries(b, p, fromWorld, radius, support, segmentBlocked) != null) return FindBuildingFloorPlanRoute(b, floor, floor, fromWorld, toWorld, radius, segmentBlocked);
            Vec3 originalFrom = BuildingLocalPosition(b, fromWorld), originalTo = BuildingLocalPosition(b, toWorld);
            Vec3 Endpoint(Vec3 point)
            {
                if (CanStandInFloorPlan(p, point.X, point.Z, radius)) return new Vec3(point.X, p.Y, point.Z);
                if (floor != 0) return null;
                var entrance = BuildingLocalPosition(b, GetBuildingEntrance(b));
                var wall = p.Walls.FirstOrDefault(w => w.Opening?.Use == "entrance"); if (wall?.Opening == null) return null;
                double half = (wall.Opening.To - wall.Opening.From) / 2;
                if (point.Z < entrance.Z - radius || point.Z > entrance.Z + 4 || Math.Abs(point.X - entrance.X) > half - radius) return null;
                var inner = new Vec3(entrance.X, p.Y, entrance.Z - 1);
                if (!CanStandInFloorPlan(p, inner.X, inner.Z, radius) || BlocksFloorPlanMovement(b, floor, BuildingWorldPosition(b, point), BuildingWorldPosition(b, inner), radius)) return null;
                return inner;
            }
            Vec3 from = Endpoint(originalFrom), to = Endpoint(originalTo); if (from == null || to == null) return null;
            List<Vec3> local;
            if (LocalSegmentClear(p, from, to, radius, b, segmentBlocked)) local = new List<Vec3> { from, to };
            else
            {
                var g = GetRouteGrid(p, radius);
                Vec3 Point(int id) => new Vec3(g.X0 + (id % g.Nx) * g.Step, p.Y, g.Z0 + Math.Floor((double)id / g.Nx) * g.Step);
                int? Attach(Vec3 target)
                {
                    int cx = (int)JsMath.Round((target.X - g.X0) / g.Step), cz = (int)JsMath.Round((target.Z - g.Z0) / g.Step);
                    var choices = new List<(int Id, double Distance)>();
                    for (int z = Math.Max(0, cz - 3); z <= Math.Min(g.Nz - 1, cz + 3); z++) for (int x = Math.Max(0, cx - 3); x <= Math.Min(g.Nx - 1, cx + 3); x++)
                        { int id = z * g.Nx + x; if (g.Walkable[id]) choices.Add((id, JsMath.Hypot(Point(id).X - target.X, Point(id).Z - target.Z))); }
                    Js.StableSort(choices, (a, z) => Js.Or(a.Distance - z.Distance, () => a.Id - z.Id));
                    foreach (var c in choices) if (LocalSegmentClear(p, target, Point(c.Id), radius, b, segmentBlocked)) return c.Id;
                    return null;
                }
                int? start = Attach(from), goal = Attach(to); if (start == null || goal == null) return null;
                var previous = new int[g.Walkable.Length]; for (int i = 0; i < previous.Length; i++) previous[i] = -1;
                var queue = new int[g.Walkable.Length]; int head = 0, tail = 0; previous[start.Value] = start.Value; queue[tail++] = start.Value;
                var dirs = new[] { (1, 0), (-1, 0), (0, 1), (0, -1) };
                while (head < tail && previous[goal.Value] == -1)
                {
                    int id = queue[head++], x = id % g.Nx, z = id / g.Nx;
                    foreach (var (dx, dz) in dirs)
                    {
                        int xx = x + dx, zz = z + dz; if (xx < 0 || xx >= g.Nx || zz < 0 || zz >= g.Nz) continue; int next = zz * g.Nx + xx;
                        if (previous[next] != -1 || !g.Walkable[next] || !LocalSegmentClear(p, Point(id), Point(next), radius, b, segmentBlocked)) continue; previous[next] = id; queue[tail++] = next;
                    }
                }
                if (previous[goal.Value] == -1) return null;
                var path = new List<Vec3>(); for (int id = goal.Value; ; id = previous[id]) { path.Add(Point(id)); if (id == start.Value) break; }
                path.Reverse();
                var raw = new List<Vec3> { from }; raw.AddRange(path); raw.Add(to);
                local = new List<Vec3> { raw[0] }; int anchor = 0;
                while (anchor < raw.Count - 1) { int next = raw.Count - 1; while (next > anchor + 1 && !LocalSegmentClear(p, raw[anchor], raw[next], radius, b, segmentBlocked)) next--; local.Add(raw[next]); anchor = next; }
            }
            var world = local.Select(point => BuildingWorldPosition(b, point)).ToList();
            if (JsMath.Hypot(originalFrom.X - from.X, originalFrom.Z - from.Z) > Eps) world.Insert(0, fromWorld.Copy());
            if (JsMath.Hypot(originalTo.X - to.X, originalTo.Z - to.Z) > Eps) world.Add(toWorld.Copy());
            return world;
        }

        public static List<Vec3> GetFloorPlanStairRoute(Building b, int fromFloor, int toFloor)
        {
            if (toFloor != fromFloor + 1) return null;
            FloorPlan p = GetBuildingFloorPlan(b, fromFloor), next = GetBuildingFloorPlan(b, toFloor); if (p == null || next == null || p.StairTreads.Count == 0) return null;
            double cx = p.Stair.X, cz = p.Stair.Z, left = cx - 1, right = cx + 1;
            var local = new List<Vec3> { new Vec3(cx, p.Y, cz), new Vec3(left, p.Y, cz + .4) };
            var lower = p.StairLandings.FirstOrDefault(s => s.Id == "lower-link"); if (lower != null) local.Add(new Vec3(left, lower.Top, (lower.Rect.Z0 + lower.Rect.Z1) / 2));
            bool compact = b.CommercialGeometryRevision == 1 && b.CommercialRouteRevision == 1 && ContinuousStairs(b);
            List<StairSurface> Flight(string prefix) { var treads = p.StairTreads.Where(s => s.Id.StartsWith(prefix, StringComparison.Ordinal)).ToList(); return compact && treads.Count > 2 ? new List<StairSurface> { treads[0], treads[treads.Count - 1] } : treads; }
            foreach (var t in Flight("up-")) local.Add(new Vec3(left, t.Top, (t.Rect.Z0 + t.Rect.Z1) / 2));
            var turn = p.StairLandings.First(s => s.Id == "half-turn"); double tz = (turn.Rect.Z0 + turn.Rect.Z1) / 2;
            local.Add(new Vec3(left, turn.Top, tz)); local.Add(new Vec3(right, turn.Top, tz));
            foreach (var t in Flight("return-")) local.Add(new Vec3(right, t.Top, (t.Rect.Z0 + t.Rect.Z1) / 2));
            local.Add(new Vec3(right, next.Y, cz + .4)); local.Add(new Vec3(cx, next.Y, cz));
            return local.Select(point => BuildingWorldPosition(b, point)).ToList();
        }

        public static List<Vec3> FindBuildingFloorPlanRoute(Building b, int fromFloor, int toFloor, Vec3 fromWorld, Vec3 toWorld, double radius = .35, Func<Vec3, Vec3, bool> segmentBlocked = null)
        {
            if (GetBuildingFloorPlan(b, fromFloor) == null || GetBuildingFloorPlan(b, toFloor) == null) return null;
            var p = GetBuildingFloorPlan(b, fromFloor); var support = FloorPlanSupport(b, fromFloor, fromWorld, radius);
            var recoveries = StairRecoveries(b, p, fromWorld, radius, support, segmentBlocked);
            bool SegmentsBlocked(List<Vec3> pts) { if (segmentBlocked == null) return false; for (int i = 1; i < pts.Count; i++) if (segmentBlocked(pts[i - 1], pts[i])) return true; return false; }
            if (recoveries != null)
            {
                foreach (var recovery in recoveries)
                {
                    var whole = GetFloorPlanStairRoute(b, recovery.Link.FromFloor, recovery.Link.ToFloor);
                    bool down = toFloor <= recovery.Link.FromFloor;
                    var path = down ? whole.Take(recovery.Index + 1).Reverse().ToList() : whole.Skip(recovery.Index + 1).ToList();
                    int exitFloor = down ? recovery.Link.FromFloor : recovery.Link.ToFloor; var exit = path[path.Count - 1];
                    var prefix = new List<Vec3> { fromWorld.Copy(), recovery.Point }; prefix.AddRange(path);
                    var exitPlan = GetBuildingFloorPlan(b, exitFloor); var exitLocal = BuildingLocalPosition(b, exit);
                    if (!CanStandInFloorPlan(exitPlan, exitLocal.X, exitLocal.Z, radius) || SegmentsBlocked(prefix)) continue;
                    var tail = FindBuildingFloorPlanRoute(b, exitFloor, toFloor, exit, toWorld, radius, segmentBlocked); if (tail == null) continue;
                    var result = new List<Vec3>(prefix); result.AddRange(tail.Skip(1));
                    if (SegmentsBlocked(result)) continue;
                    return result;
                }
                return null;
            }
            if (fromFloor == toFloor) return FindFloorPlanRoute(b, fromFloor, fromWorld, toWorld, radius, segmentBlocked);
            Vec3 start = GetFloorPlanStairPosition(b, fromFloor), end = GetFloorPlanStairPosition(b, toFloor);
            var first = FindFloorPlanRoute(b, fromFloor, fromWorld, start, radius, segmentBlocked); var last = FindFloorPlanRoute(b, toFloor, end, toWorld, radius, segmentBlocked);
            if (first == null || last == null) return null;
            var route = new List<Vec3>(first); int direction = Math.Sign(toFloor - fromFloor);
            for (int floor = fromFloor; floor != toFloor; floor += direction)
            {
                List<Vec3> step;
                if (direction > 0) step = GetFloorPlanStairRoute(b, floor, floor + 1);
                else { step = GetFloorPlanStairRoute(b, floor - 1, floor); step?.Reverse(); }
                if (step == null) return null;
                for (int i = 1; i < step.Count; i++) { if (segmentBlocked != null && segmentBlocked(route[route.Count - 1], step[i])) return null; route.Add(step[i]); }
            }
            route.AddRange(last.Skip(1)); return route;
        }

        static double? RoofTopUnderCircle(RoofRegion roof, double x, double z, double radius)
        {
            if (CircleRectDistanceSquared(x, z, roof.Rect) > radius * radius + Eps) return null;
            if (roof.Kind != "gable") return roof.Top;
            bool alongX = roof.GableAxis == "x"; double cross = alongX ? x : z, orth = alongX ? z : x, min = alongX ? roof.Rect.X0 : roof.Rect.Z0, max = alongX ? roof.Rect.X1 : roof.Rect.Z1, orthMin = alongX ? roof.Rect.Z0 : roof.Rect.X0, orthMax = alongX ? roof.Rect.Z1 : roof.Rect.X1;
            double d = JsMath.Max(JsMath.Max(orthMin - orth, 0), orth - orthMax), reach = Math.Sqrt(JsMath.Max(0, radius * radius - d * d)), lo = JsMath.Max(min, cross - reach), hi = JsMath.Min(max, cross + reach);
            if (lo > hi + Eps) return null;
            double position = JsMath.Max(lo, JsMath.Min(hi, (min + max) / 2)), t = (position - min) / (max - min);
            return roof.Bottom + .4 + .8 * (1 - Math.Abs(2 * t - 1));
        }

        public static FloorSupport GetFloorPlanRoofSupport(Building b, Vec3 reference, double radius = .35)
        {
            var body = GetBuildingBody(b); if (body == null) return null; var local = BuildingLocalPosition(b, reference); FloorSupport best = null;
            foreach (var roof in GetFloorPlanRoofRegions(body))
            {
                if (!Contains(roof.Rect, local.X, local.Z)) continue; var top = RoofTopUnderCircle(roof, local.X, local.Z, radius); if (top == null || top.Value > local.Y + .6 + Eps) continue;
                double y = b.Position.Y + .6 + top.Value; if (best == null || y > best.Y) best = new FloorSupport { Kind = "roof", Floor = roof.Floor, Y = y, LocalX = local.X, LocalZ = local.Z };
            }
            return best;
        }

        static bool BlocksRoofMovement(Building b, Vec3 from, Vec3 to, double radius, double eyeHeight)
        {
            var body = GetBuildingBody(b); if (body == null) return false; Vec3 a = BuildingLocalPosition(b, from), z = BuildingLocalPosition(b, to);
            int steps = (int)JsMath.Max(1, Math.Ceiling(JsMath.Hypot(z.X - a.X, z.Z - a.Z) / .1));
            foreach (var roof in GetFloorPlanRoofRegions(body)) for (int i = 0; i <= steps; i++)
                {
                    double t = (double)i / steps, x = a.X + (z.X - a.X) * t, zz = a.Z + (z.Z - a.Z) * t, feet = a.Y + (z.Y - a.Y) * t; var top = RoofTopUnderCircle(roof, x, zz, radius);
                    if (top != null && feet + eyeHeight > roof.Bottom + Eps && feet < top.Value - Eps) return true;
                }
            return false;
        }
    }
}
