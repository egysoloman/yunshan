// Port of src/rendering/network-structures.ts (emitNetworkStructures, the
// suspension-tower simpleRoof and emitBridge): decks, rails, curbs, centre
// lines, guardrails, supports and ties, lift cages, cable lines, bridge
// cables, hangers, towers and abutments, station platforms and junction
// poles. Display only. Parity-tested call by call (scripts/parity/network.ts).
using System;
using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core
{
    public interface INetworkSink
    {
        /// <summary>Centred box; rotation about Y in game radians.</summary>
        void Box(string key, double x, double y, double z, double sx, double sy, double sz, string color = null, double rotation = 0, bool roof = false);
        /// <summary>Box of width × height along a→b, both raised by lift (three.js segment).</summary>
        void Segment(string key, Vec3 a, Vec3 b, double width, double height, double lift = 0, string color = null);
    }

    public static class NetworkStructures
    {
        static Vec3 V(double x, double y, double z) => new Vec3(x, y, z);
        const string Paving = "#8a8170";
        public const double CableTowerSpacing = 120;
        public const double StairGrade = .06, StairTread = 1.6;

        public sealed class PavedDeck { public string Id; public double Half, MinX, MaxX, MinZ, MaxZ; public List<Vec3> Points; }

        /// <summary>Port of pavedDecks: each paved street's deck, for clipping other paved streets' kerbs.</summary>
        public static List<PavedDeck> PavedDecks(WorldDefinition world)
        {
            var output = new List<PavedDeck>();
            foreach (var edge in world.Edges)
            {
                if (!TransportGeometry.PavedStreet(world, edge)) continue;
                double half = TransportGeometry.DeckWidth(edge) / 2;
                output.Add(new PavedDeck { Id = edge.Id, Half = half, Points = edge.Points, MinX = edge.Points.Min(p => p.X) - half, MaxX = edge.Points.Max(p => p.X) + half, MinZ = edge.Points.Min(p => p.Z) - half, MaxZ = edge.Points.Max(p => p.Z) + half });
            }
            return output;
        }

        /// <summary>Port of insidePavedDeck: whether a point lies on another paved street's deck.</summary>
        public static bool InsidePavedDeck(Vec3 p, List<PavedDeck> decks, string selfId)
        {
            foreach (var d in decks)
            {
                if (d.Id == selfId || p.X < d.MinX || p.X > d.MaxX || p.Z < d.MinZ || p.Z > d.MaxZ) continue;
                for (int i = 1; i < d.Points.Count; i++)
                {
                    Vec3 a = d.Points[i - 1], b = d.Points[i]; double dx = b.X - a.X, dz = b.Z - a.Z, n = dx * dx + dz * dz, t = n > 0 ? Math.Max(0, Math.Min(1, ((p.X - a.X) * dx + (p.Z - a.Z) * dz) / n)) : 0;
                    double ex = p.X - a.X - dx * t, ez = p.Z - a.Z - dz * t, limit = d.Half - .05;
                    if (ex * ex + ez * ez < limit * limit && Math.Abs(p.Y - (a.Y + (b.Y - a.Y) * t)) < 1.5) return true;
                }
            }
            return false;
        }

        public const double KerbSample = .5;

        /// <summary>Port of kerbRuns: the runs of a kerb outside every other paved deck.</summary>
        public static List<(Vec3, Vec3)> KerbRuns(Vec3 aa, Vec3 bb, List<PavedDeck> decks, string selfId)
        {
            var near = decks.Where(d => d.Id != selfId && Math.Max(aa.X, bb.X) >= d.MinX && Math.Min(aa.X, bb.X) <= d.MaxX && Math.Max(aa.Z, bb.Z) >= d.MinZ && Math.Min(aa.Z, bb.Z) <= d.MaxZ).ToList();
            if (near.Count == 0) return new List<(Vec3, Vec3)> { (aa, bb) };
            bool Inside(Vec3 p) => InsidePavedDeck(p, near, selfId);
            int count = Math.Max(1, (int)Math.Ceiling(JsMath.Hypot(bb.X - aa.X, bb.Z - aa.Z) / KerbSample));
            Vec3 At(int k) => k == 0 ? aa : k == count ? bb : V(aa.X + (bb.X - aa.X) * k / count, aa.Y + (bb.Y - aa.Y) * k / count, aa.Z + (bb.Z - aa.Z) * k / count);
            var runs = new List<(Vec3, Vec3)>(); int start = -1;
            for (int k = 0; k <= count; k++)
            {
                bool outside = !Inside(At(k));
                if (outside && start < 0) start = k;
                if ((!outside || k == count) && start >= 0) { int end = outside ? k : k - 1; if (end > start) runs.Add((At(start), At(end))); start = -1; }
            }
            return runs;
        }

        public static void Emit(WorldDefinition world, INetworkSink sink, bool dressesStations, bool dressesRunway, bool dressesRailDeck = false, bool dressesBridgeDeck = false, bool dressesRoadDeck = false, bool dressesRailKerb = false, bool dressesRailPierCaps = false)
        {
            // current-v8 streets bend at any angle: a square deck at each interior
            // vertex (on the bisector) closes the wedge between rigid segment boxes,
            // and a pad covers every street junction. Older layouts keep their boxes.
            bool anyAngleStreets = StreetLayouts.IsStreetLayout(world.LayoutVersion);
            var decks = anyAngleStreets ? PavedDecks(world) : new List<PavedDeck>();
            foreach (var edge in world.Edges)
            {
                if (edge.Mode == "flight") continue;
                // Terrace streets and door paths are stone paving, not slate road (network-structures.ts).
                bool paved = TransportGeometry.PavedStreet(world, edge);
                if (anyAngleStreets && edge.Mode == "road" && !edge.Id.Contains("runway")) for (int i = 1; i < edge.Points.Count - 1; i++)
                {
                    Vec3 a = edge.Points[i - 1], p = edge.Points[i], b = edge.Points[i + 1];
                    double width = TransportGeometry.DeckWidth(edge) - .04, yaw = JsMath.Atan2(b.X - a.X, b.Z - a.Z);
                    sink.Box("stone", p.X, p.Y - .28, p.Z, width, .5, width, paved ? Paving : "#555f61", yaw);
                }
                double supportRemainder = 0, towerRemainder = 0;
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    Vec3 a = edge.Points[i - 1], b = edge.Points[i];
                    if (edge.Mode == "ferry") continue;
                    if (edge.Mode == "cable")
                    {
                        sink.Segment("wood", a, b, .45, .45, 9); sink.Segment("cyan", a, b, .15, .15, 8.5);
                        // current-v8 ropeway towers (network-structures.ts).
                        if (anyAngleStreets)
                        {
                            double span = JsMath.Hypot(b.X - a.X, b.Z - a.Z), yaw = JsMath.Atan2(b.X - a.X, b.Z - a.Z);
                            for (double along = CableTowerSpacing - towerRemainder; along <= span; along += CableTowerSpacing)
                            {
                                double t = along / JsMath.Max(.01, span), x = a.X + (b.X - a.X) * t, z = a.Z + (b.Z - a.Z) * t, top = a.Y + (b.Y - a.Y) * t + 9, ground = World.TerrainHeight(world, x, z), tall = top - ground;
                                if (tall > 6 && tall < 240) { sink.Box("stone", x, ground + tall / 2, z, 1.4, tall, 1.4, "#6f7a74"); sink.Box("wood", x, top + .5, z, 5.2, .6, .6, "#5b4a3a", yaw); }
                            }
                            towerRemainder = (towerRemainder + span) % CableTowerSpacing;
                        }
                        continue;
                    }
                    if (edge.Mode == "lift")
                    {
                        foreach (var x in new[] { -2.5, 2.5 }) foreach (var z in new[] { -2.5, 2.5 }) sink.Segment("stone", V(a.X + x, a.Y, a.Z + z), V(b.X + x, b.Y, b.Z + z), .6, .6, 0, "#a4b0a2");
                        for (double y = JsMath.Min(a.Y, b.Y); y <= JsMath.Max(a.Y, b.Y); y += 12)
                        {
                            foreach (var x in new[] { -2.5, 2.5 }) sink.Box("wood", a.X + x, y, a.Z, .6, .6, 5.6, "#698780");
                            foreach (var z in new[] { -2.5, 2.5 }) sink.Box("wood", a.X, y, a.Z + z, 5.6, .6, .6, "#698780");
                        }
                        sink.Segment("cyan", V(a.X + 3.2, a.Y, a.Z), V(b.X + 3.2, b.Y, b.Z), .3, .3); continue;
                    }
                    bool rail = edge.Mode == "maglev" || edge.Mode == "lightRail";
                    double width = TransportGeometry.DeckWidth(edge);
                    bool dressedDeck = edge.Id == "road-airport-runway-strip" && dressesRunway || rail && dressesRailDeck || edge.Mode == "bridge" && dressesBridgeDeck;
                    // Near studio road tiles (BUILT-131/132/134) sit at the exact deck, line and kerb extents; these boxes shrink slightly.
                    bool roadTiled = edge.Mode == "road" && !edge.Id.Contains("runway") && dressesRoadDeck, surfaceTiled = roadTiled && !paved;
                    if (!dressedDeck) sink.Segment("stone", a, b, surfaceTiled ? width - .04 : width, rail ? 1.4 : .5, rail ? -.9 : surfaceTiled ? -.28 : -.25, rail ? "#84948e" : edge.Mode == "bridge" ? "#b8b3a0" : paved ? Paving : roadTiled ? "#555f61" : "#969987");
                    if (rail) { sink.Segment("cyan", V(a.X - 1.8, a.Y, a.Z), V(b.X - 1.8, b.Y, b.Z), .28, .24, .16); sink.Segment("cyan", V(a.X + 1.8, a.Y, a.Z), V(b.X + 1.8, b.Y, b.Z), .28, .24, .16); }
                    else if (edge.Mode != "bridge" && !paved) sink.Segment("stone", a, b, roadTiled ? .12 : .16, roadTiled ? .06 : .08, roadTiled ? .06 : .07, "#d1c6a1");
                    double dx = b.X - a.X, dz = b.Z - a.Z, horizontal = JsMath.Hypot(dx, dz); if (horizontal == 0) horizontal = 1;
                    double nx = -dz / horizontal, nz = dx / horizontal;
                    foreach (var side in new[] { -1, 1 })
                    {
                        double offset = TransportGeometry.GuardrailOffset(edge);
                        var aa = V(a.X + nx * offset * side, a.Y, a.Z + nz * offset * side); var bb = V(b.X + nx * offset * side, b.Y, b.Z + nz * offset * side);
                        bool railKerbTiled = rail && dressesRailKerb;
                        foreach (var (ka, kb) in paved ? KerbRuns(aa, bb, decks, edge.Id) : new List<(Vec3, Vec3)> { (aa, bb) }) sink.Segment("stone", ka, kb, rail ? railKerbTiled ? .31 : .35 : roadTiled ? .36 : .4, rail ? railKerbTiled ? .46 : .5 : roadTiled ? .18 : .2, rail ? -.1 : roadTiled ? .11 : .12, "#c0c2ac");
                        bool elevated = (a.Y + b.Y) / 2 - World.TerrainHeight(world, (a.X + b.X) / 2, (a.Z + b.Z) / 2) > 4;
                        if (edge.Mode == "bridge" || rail || elevated && edge.Mode == "road")
                            foreach (var span in TransportGeometry.GuardrailSpans(world, edge, i))
                                sink.Segment("wood", V(span.A.X + nx * offset * side, span.A.Y, span.A.Z + nz * offset * side), V(span.B.X + nx * offset * side, span.B.Y, span.B.Z + nz * offset * side), TransportGeometry.GuardrailThickness, .2, 1.1, "#6b7771");
                    }
                    if (paved)
                    {
                        // Steep stone streets read as stair streets (network-structures.ts).
                        double grade = Math.Abs(b.Y - a.Y) / JsMath.Max(.01, horizontal);
                        int steps = grade >= StairGrade ? (int)JsMath.Max(1, JsMath.Round(horizontal / StairTread)) : 0;
                        var cuts = new List<double>();
                        if (steps > 0) for (int k = 0; k < Math.Max(0, steps - 1); k++) cuts.Add((double)(k + 1) / steps); else cuts.AddRange(new[] { .25, .5, .75 });
                        foreach (var t in cuts)
                        {
                            var m = V(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t + (steps > 0 ? .06 : .02), a.Z + (b.Z - a.Z) * t);
                            foreach (var (sa, sb) in KerbRuns(V(m.X - nx * 4.6, m.Y, m.Z - nz * 4.6), V(m.X + nx * 4.6, m.Y, m.Z + nz * 4.6), decks, edge.Id)) sink.Segment("stone", sa, sb, steps > 0 ? .3 : .14, steps > 0 ? .14 : .05, 0, steps > 0 ? "#5f594d" : "#6d675a");
                        }
                    }
                    else if (edge.Mode == "road" && !edge.Id.Contains("runway"))
                    {
                        var middle = V((a.X + b.X) / 2, (a.Y + b.Y) / 2 + .04, (a.Z + b.Z) / 2);
                        sink.Segment("stone", V(middle.X - nx * 3.5, middle.Y, middle.Z - nz * 3.5), V(middle.X + nx * 3.5, middle.Y, middle.Z + nz * 3.5), .08, .04, 0, "#757e73");
                    }
                    // current-v8 terrace streets stand on stone embankments (network-structures.ts).
                    if (anyAngleStreets && edge.Mode == "road" && edge.Id.Contains("-terrace-"))
                    {
                        double ground = JsMath.Min(JsMath.Min(World.TerrainHeight(world, a.X, a.Z), World.TerrainHeight(world, b.X, b.Z)), World.TerrainHeight(world, (a.X + b.X) / 2, (a.Z + b.Z) / 2));
                        double fill = JsMath.Min(a.Y, b.Y) - .5 - ground;
                        if (fill > 1.2 && fill < 14) sink.Segment("stone", a, b, width + .8, fill + .5, -.5 - (fill + .5) / 2, "#8d8a7b");
                    }
                    double length = JsMath.Hypot(b.X - a.X, b.Z - a.Z), interval = rail ? 80 : 70;
                    for (double along = interval - supportRemainder; along <= length; along += interval)
                    {
                        double t = along / JsMath.Max(.01, length), x = a.X + (b.X - a.X) * t, z = a.Z + (b.Z - a.Z) * t, y = a.Y + (b.Y - a.Y) * t, ground = World.TerrainHeight(world, x, z);
                        if (y - ground > 5 && edge.Mode != "bridge")
                        {
                            double tall = y - ground;
                            sink.Box("stone", x, ground + 1, z, rail ? 7 : 8, 2, rail ? 7 : 8, "#939e91");
                            sink.Box("stone", x, ground + tall / 2, z, rail ? 3 : 4, tall, rail ? 3 : 4, "#a0aaa0");
                            if (!(rail && dressesRailPierCaps)) sink.Box("stone", x, y - 1.3, z, width + 1, 1.8, 4, "#929d92");
                            if (tall > 25) for (double tie = ground + 12; tie < y - 5; tie += 16) sink.Box("wood", x, tie, z, rail ? 4 : 5, .6, rail ? 4 : 5);
                        }
                    }
                    supportRemainder = (supportRemainder + length) % interval;
                }
                if (edge.Mode == "bridge") EmitBridge(world, edge, sink);
            }
            // current-v8 junctions meet at any angle: the pole stands on whichever
            // corner keeps the most clearance from every nearby street centreline (network-structures.ts).
            const double Cell = 32;
            var segments = new Dictionary<(double, double), List<(Vec3 A, Vec3 B)>>();
            if (anyAngleStreets) foreach (var edge in world.Edges) if (edge.Mode == "road" && !edge.Id.Contains("runway")) for (int i = 1; i < edge.Points.Count; i++)
            {
                Vec3 a = edge.Points[i - 1], b = edge.Points[i];
                for (double gx = Math.Floor(JsMath.Min(a.X, b.X) / Cell); gx <= Math.Floor(JsMath.Max(a.X, b.X) / Cell); gx++)
                    for (double gz = Math.Floor(JsMath.Min(a.Z, b.Z) / Cell); gz <= Math.Floor(JsMath.Max(a.Z, b.Z) / Cell); gz++)
                    {
                        var key = (gx, gz);
                        if (!segments.TryGetValue(key, out var list)) segments[key] = list = new List<(Vec3 A, Vec3 B)>();
                        list.Add((a, b));
                    }
            }
            double Clearance(double x, double z)
            {
                double best = double.PositiveInfinity;
                for (double gx = Math.Floor(x / Cell) - 1; gx <= Math.Floor(x / Cell) + 1; gx++)
                    for (double gz = Math.Floor(z / Cell) - 1; gz <= Math.Floor(z / Cell) + 1; gz++)
                        if (segments.TryGetValue((gx, gz), out var list)) foreach (var (a, b) in list)
                        {
                            double dx = b.X - a.X, dz = b.Z - a.Z, n = dx * dx + dz * dz, t = n == 0 ? 0 : JsMath.Max(0, JsMath.Min(1, ((x - a.X) * dx + (z - a.Z) * dz) / n));
                            best = JsMath.Min(best, JsMath.Hypot(x - a.X - dx * t, z - a.Z - dz * t));
                        }
                return best;
            }
            (double X, double Z) PoleCorner(Vec3 p)
            {
                (double X, double Z) best = (p.X + 4, p.Z + 4); double score = double.NegativeInfinity;
                foreach (var reach in new[] { 6.5, 9.5 })
                    foreach (var (cx, cz) in new[] { (1.0, 1.0), (-1.0, 1.0), (-1.0, -1.0), (1.0, -1.0) })
                    {
                        double x = p.X + cx * reach, z = p.Z + cz * reach, clear = Clearance(x, z);
                        if (clear > score) { score = clear; best = (x, z); }
                    }
                return best;
            }
            foreach (var node in world.Nodes)
            {
                var p = node.Position;
                if (node.Station)
                {
                    if (!dressesStations)
                    {
                        sink.Box("stone", p.X, p.Y - .6, p.Z, 22, 1, 18); sink.Box("cyan", p.X, p.Y + .1, p.Z + 8, 20, .2, .35);
                        foreach (var x in new[] { -8.0, 8.0 }) { sink.Box("wood", p.X + x, p.Y + 3, p.Z, .8, 6, .8); sink.Box("amber", p.X + x, p.Y + 5.7, p.Z, 1.5, .35, 1.5); }
                        sink.Box("roof", p.X, p.Y + 6.4, p.Z, 23, .65, 11, null, 0, true);
                    }
                    sink.Box("wood", p.X + 12, p.Y + 1.8, p.Z + 11, .35, 3.6, .35); sink.Box("wood", p.X + 12, p.Y + 3.5, p.Z + 11, 1, 1.6, .65);
                }
                else if (node.Id.Contains("junction") || node.Id.Contains("road")) { var pole = anyAngleStreets ? PoleCorner(p) : (X: p.X + 4, Z: p.Z + 4); sink.Box("wood", pole.X, p.Y + 2.2, pole.Z, .4, 4.4, .4); if (anyAngleStreets && node.Id.StartsWith("junction-")) sink.Box("stone", p.X, p.Y - .28, p.Z, 11, .5, 11, "#555f61"); }
            }
        }

        static void SimpleRoof(Action<string, double, double, double, double, double, double> box, double w, double d, double y, double magnitude)
        {
            double overhang = JsMath.Max(2, JsMath.Min(12, w * .14)), rise = JsMath.Max(2.8, JsMath.Min(14, w * .18)) * magnitude;
            box("wood", 0, y + .12, 0, w + overhang * 1.3, .2, d + overhang * 1.3);
            const int levels = 3;
            for (int step = 0; step < levels; step++) { double fraction = (double)step / levels; box("roof", 0, y + .4 + fraction * rise, 0, (w + overhang * 2) * (1 - fraction * .78), rise / levels + .2, (d + overhang * 2) * (1 - fraction * .76)); }
            box("roof", 0, y + rise + .8, 0, JsMath.Max(1.2, w * .48), .4, JsMath.Max(.6, d * .035));
            box("amber", 0, y + .2, d / 2 + overhang * .8, w + overhang, .12, .16);
            foreach (var sx in new[] { -1, 1 }) foreach (var sz in new[] { -1, 1 }) for (int i = 2; i < 3; i++)
                box("roof", sx * (w / 2 + overhang * (.45 + i * .2)), y + .7 + i * .43, sz * (d / 2 + overhang * (.45 + i * .2)), overhang * .55, .58, overhang * .55);
        }

        static void EmitBridge(WorldDefinition world, NetworkEdge edge, INetworkSink sink)
        {
            var pts = edge.Points; if (pts.Count < 2) return;
            double length = 0, arcLength = 0;
            for (int i = 1; i < pts.Count; i++) { length += JsMath.Hypot(pts[i].X - pts[i - 1].X, pts[i].Z - pts[i - 1].Z); arcLength += JsMath.Hypot(pts[i].X - pts[i - 1].X, pts[i].Y - pts[i - 1].Y, pts[i].Z - pts[i - 1].Z); }
            int samples = (int)JsMath.Max(8, Math.Ceiling(length / 8));
            Vec3 Point(double t, double side, double lift)
            {
                Vec3 p = World.SamplePolyline(pts, t), a = World.SamplePolyline(pts, JsMath.Max(0, t - .01)), b = World.SamplePolyline(pts, JsMath.Min(1, t + .01));
                double dx = b.X - a.X, dz = b.Z - a.Z, l = JsMath.Hypot(dx, dz); if (l == 0) l = 1;
                return V(p.X - dz / l * side * 4.1, p.Y + lift, p.Z + dx / l * side * 4.1);
            }
            double Lift(double t) => t < .16 ? 3 + t / .16 * 27 : t > .84 ? 3 + (1 - t) / .16 * 27 : 30 - 21 * JsMath.Sin((t - .16) / .68 * Math.PI);
            bool suspension = length > 140;
            foreach (var side in new[] { -1, 1 })
            {
                for (int i = 0; i <= samples; i++)
                {
                    double t = (double)i / samples; var deck = Point(t, side, 0);
                    bool guarded = TransportGeometry.HasGuardrailAt(world, edge, t * arcLength);
                    if (guarded) sink.Box("wood", deck.X, deck.Y + .55, deck.Z, .4, 1.1, .4, "#6c7871");
                    if (suspension)
                    {
                        var cable = Point(t, side, Lift(t));
                        if (i != 0) { double previousT = (double)(i - 1) / samples; sink.Segment("wood", Point(previousT, side, Lift(previousT)), cable, .5, .5, 0, "#627d7c"); }
                        if (guarded) sink.Segment("stone", V(deck.X, deck.Y + 1.1, deck.Z), cable, .2, .2, 0, "#9eb1a7");
                    }
                }
                foreach (var t in suspension ? new[] { .16, .84 } : new[] { 0.0, 1.0 })
                {
                    if (suspension && !TransportGeometry.HasGuardrailAt(world, edge, t * arcLength)) continue;
                    double offset = suspension ? 6 : 6.5; var deck = Point(t, side * offset / 4.1, 0);
                    double ground = JsMath.Min(World.TerrainHeight(world, deck.X, deck.Z), deck.Y - 2.6), height = deck.Y - ground + (suspension ? 32 : 2.4);
                    sink.Box("stone", deck.X, ground + .8, deck.Z, 9, 1.6, 9, "#a4aa9b");
                    sink.Box("stone", deck.X, ground + height / 2, deck.Z, 2, height, 2, "#8c9b95");
                    if (suspension)
                    {
                        var across = Point(t, -side * offset / 4.1, 28);
                        sink.Segment("stone", V(deck.X, deck.Y + 28, deck.Z), across, 1.6, 1.6, 0, "#8b9b95");
                        SimpleRoof((key, x, y, z, sx, sy, sz) => sink.Box(key, deck.X + x, deck.Y + y, deck.Z + z, sx, sy, sz), 5, 5, 32, .35);
                    }
                }
            }
            foreach (var t in new[] { 0.0, 1.0 })
            {
                var p = World.SamplePolyline(pts, t); double ground = World.TerrainHeight(world, p.X, p.Z);
                sink.Box("stone", p.X, (p.Y + ground) / 2, p.Z, 12, JsMath.Max(1, p.Y - ground), 10, "#a2a88f");
            }
        }
    }
}
