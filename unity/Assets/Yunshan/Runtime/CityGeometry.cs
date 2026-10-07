using System;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Yunshan.Core;
using CoreRect = Yunshan.Core.Rect;

namespace Yunshan.Runtime
{
    /// <summary>Display geometry read from the authoritative Core world. Nothing
    /// here changes collision, walking or simulation data.</summary>
    public static class CityGeometry
    {
        public const double TerrainChunk = 256, TerrainStep = 8;

        public sealed class TerrainChunkData { public int Cx, Cz, N; public double X0, Z0; public float[] Heights; }

        /// <summary>Samples World.TerrainHeight on a regular grid (pure; safe on a worker thread).</summary>
        public static TerrainChunkData SampleTerrain(WorldDefinition world, int cx, int cz)
        {
            int n = (int)(TerrainChunk / TerrainStep) + 1;
            var data = new TerrainChunkData { Cx = cx, Cz = cz, N = n, X0 = cx * TerrainChunk, Z0 = cz * TerrainChunk, Heights = new float[n * n] };
            for (int j = 0; j < n; j++) for (int i = 0; i < n; i++)
                    data.Heights[j * n + i] = (float)World.TerrainHeight(world, data.X0 + i * TerrainStep, data.Z0 + j * TerrainStep);
            return data;
        }

        public static Mesh TerrainMesh(TerrainChunkData data)
        {
            var builder = new GameMeshBuilder(); int n = data.N;
            Color grass = Space.Hex("#7f9466"), meadow = Space.Hex("#a5a77a"), rock = Space.Hex("#8c877b"), high = Space.Hex("#b9b6ad"), bank = Space.Hex("#9a8c6c");
            Vector3 P(int i, int j) => new Vector3((float)(data.X0 + i * TerrainStep), data.Heights[j * n + i], (float)(data.Z0 + j * TerrainStep));
            for (int j = 0; j < n - 1; j++) for (int i = 0; i < n - 1; i++)
                {
                    Vector3 a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
                    float slope = Mathf.Max(Mathf.Abs(a.y - c.y), Mathf.Abs(b.y - d.y)) / (float)(TerrainStep * 1.414);
                    float y = (a.y + b.y + c.y + d.y) / 4;
                    Color color = y < 20 ? bank : y > 420 ? high : Color.Lerp(grass, meadow, Mathf.PerlinNoise(a.x * .01f, a.z * .01f));
                    color = Color.Lerp(color, rock, Mathf.SmoothStep(0, 1, (slope - .45f) / .5f));
                    // Counter-clockwise seen from above (+Y) in right-handed game space.
                    builder.Quad(a, d, c, b, color);
                }
            return builder.Build($"地形 {data.Cx},{data.Cz}");
        }

        /// <summary>Roads, bridges, rails and runways as strips at their authoritative points.</summary>
        public static Mesh NetworkMesh(WorldDefinition world)
        {
            var builder = new GameMeshBuilder();
            Color road = Space.Hex("#6f716a"), bridge = Space.Hex("#7d7468"), rail = Space.Hex("#5c6766"), runway = Space.Hex("#5d605d"), pier = Space.Hex("#a0aaa0");
            foreach (var edge in world.Edges)
            {
                if (edge.Mode == "flight" || edge.Mode == "lift" || edge.Mode == "ferry" || edge.Mode == "cable") continue;
                bool isRail = edge.Mode == "maglev" || edge.Mode == "lightRail";
                double width = edge.Id.Contains("airport-runway-strip") ? 44 : edge.Mode == "bridge" ? 9 : isRail ? 6 : 10;
                Color color = edge.Id.Contains("runway") ? runway : edge.Mode == "bridge" ? bridge : isRail ? rail : road;
                for (int i = 1; i < edge.Points.Count; i++)
                {
                    Vec3 a = edge.Points[i - 1], b = edge.Points[i];
                    double dx = b.X - a.X, dz = b.Z - a.Z, l = Math.Sqrt(dx * dx + dz * dz); if (l < 1e-6) continue;
                    double nx = -dz / l * width / 2, nz = dx / l * width / 2, lift = isRail ? 0 : .02;
                    var p0 = new Vector3((float)(a.X - nx), (float)(a.Y + lift), (float)(a.Z - nz));
                    var p1 = new Vector3((float)(a.X + nx), (float)(a.Y + lift), (float)(a.Z + nz));
                    var p2 = new Vector3((float)(b.X + nx), (float)(b.Y + lift), (float)(b.Z + nz));
                    var p3 = new Vector3((float)(b.X - nx), (float)(b.Y + lift), (float)(b.Z - nz));
                    // Upward facing: choose the order whose normal has +Y.
                    if (Vector3.Cross(p1 - p0, p2 - p0).y > 0) builder.Quad(p0, p1, p2, p3, color); else builder.Quad(p3, p2, p1, p0, color);
                    var down = new Vector3(0, -.6f, 0);
                    if (Vector3.Cross(p1 - p0, p2 - p0).y > 0) builder.Quad(p3 + down, p2 + down, p1 + down, p0 + down, color); else builder.Quad(p0 + down, p1 + down, p2 + down, p3 + down, color);
                }
                if (isRail || (edge.Mode == "road" && !edge.Id.Contains("runway")))
                {
                    double interval = isRail ? 80 : 70, along = 0;
                    for (int i = 1; i < edge.Points.Count; i++)
                    {
                        Vec3 a = edge.Points[i - 1], b = edge.Points[i]; double length = Math.Sqrt((b.X - a.X) * (b.X - a.X) + (b.Z - a.Z) * (b.Z - a.Z));
                        for (double s = interval - along % interval; s <= length; s += interval)
                        {
                            double t = s / Math.Max(.01, length), x = a.X + (b.X - a.X) * t, z = a.Z + (b.Z - a.Z) * t, y = a.Y + (b.Y - a.Y) * t;
                            double ground = World.TerrainHeight(world, x, z);
                            if (y - ground > 5) { double half = isRail ? 1.5 : 2; builder.Box(x - half, ground, z - half, x + half, y - .6, z + half, pier); }
                        }
                        along += length;
                    }
                }
            }
            return builder.Build("路网 · 道路桥梁轨道");
        }

        public static Mesh WaterMesh(WorldDefinition world)
        {
            var builder = new GameMeshBuilder(); Color water = Space.Hex("#4f8d93"), sheet = Space.Hex("#cfe7e6");
            for (int i = 1; i < world.River.Count; i++)
            {
                Vec3 a = world.River[i - 1], b = world.River[i]; double dx = b.X - a.X, dz = b.Z - a.Z, l = Math.Sqrt(dx * dx + dz * dz), w = 15;
                double nx = -dz / l * w, nz = dx / l * w;
                var p0 = new Vector3((float)(a.X - nx), (float)(a.Y - .9), (float)(a.Z - nz)); var p1 = new Vector3((float)(a.X + nx), (float)(a.Y - .9), (float)(a.Z + nz));
                var p2 = new Vector3((float)(b.X + nx), (float)(b.Y - .9), (float)(b.Z + nz)); var p3 = new Vector3((float)(b.X - nx), (float)(b.Y - .9), (float)(b.Z - nz));
                if (Vector3.Cross(p1 - p0, p2 - p0).y > 0) builder.Quad(p0, p1, p2, p3, water); else builder.Quad(p3, p2, p1, p0, water);
            }
            var bottom = world.Waterfall.Bottom; var top = world.Waterfall.Top;
            const int Segments = 32;
            for (int k = 0; k < Segments; k++)
            {
                double a0 = k * Math.PI * 2 / Segments, a1 = (k + 1) * Math.PI * 2 / Segments, r = 44;
                var c = new Vector3((float)bottom.X, (float)(bottom.Y - .9), (float)bottom.Z);
                var e0 = c + new Vector3((float)(Math.Cos(a0) * r), 0, (float)(Math.Sin(a0) * r)); var e1 = c + new Vector3((float)(Math.Cos(a1) * r), 0, (float)(Math.Sin(a1) * r));
                if (Vector3.Cross(e1 - c, e0 - c).y > 0) builder.Triangle(c, e1, e0, water); else builder.Triangle(c, e0, e1, water);
            }
            double half = world.Waterfall.Width / 2;
            var s0 = new Vector3((float)(top.X - half), (float)top.Y, (float)(top.Z + 34)); var s1 = new Vector3((float)(top.X + half), (float)top.Y, (float)(top.Z + 34));
            var s2 = new Vector3((float)(top.X + half), (float)bottom.Y, (float)(top.Z + 44)); var s3 = new Vector3((float)(top.X - half), (float)bottom.Y, (float)(top.Z + 44));
            builder.Quad(s3, s2, s1, s0, sheet); builder.Quad(s0, s1, s2, s3, sheet);
            return builder.Build("水系 · 溪流瀑布潭");
        }

        static string WallColor(Building b) => b.CommercialGeometryRevision == 1 ? "#adb5b3"
            : b.Kind == "home" || b.Kind == "market" ? (b.Kind == "market" ? "#d2c3a4" : new[] { "#dbd1b9", "#cfc5ab", "#e0d6bf", "#d3ccb9" }[(int)b.Seed % 4])
            : b.Kind == "clinic" ? "#d8d7c4" : b.Kind == "bank" ? "#c3b9a3" : b.Kind == "workshop" ? "#b4a086" : b.Kind == "school" ? "#d8c9a7" : new[] { "#d3c09d", "#c1b498", "#d8c6a6", "#c8b18e" }[(int)b.Seed % 4];

        /// <summary>Distant envelope: one box per run of floors sharing an interior.</summary>
        public static Mesh FarBuildingMesh(Building b)
        {
            var builder = new GameMeshBuilder(); var frame = GameMeshBuilder.GameFrame(b.Position.X, b.Position.Y + .6, b.Position.Z, b.Rotation);
            Color wall = Space.Hex(WallColor(b)), roof = Space.Hex(b.CommercialGeometryRevision == 1 ? "#344f51" : "#3f4f4c"), plinth = Space.Hex("#939487");
            var body = ArchitectureFloorPlan.GetBuildingBody(b);
            if (body != null)
            {
                var plans = body.FloorPlans;
                for (int i = 0; i < plans.Count;)
                {
                    var first = plans[i]; int end = i + 1;
                    while (end < plans.Count && SameRects(first.Interior, plans[end].Interior)) end++;
                    double top = plans[end - 1].CeilingY;
                    foreach (var r in ArchitectureFloorPlan.RectangleCover(first.Interior)) builder.LocalBox(frame, r.X0, first.Y, r.Z0, r.X1, top, r.Z1, first.Floor < 0 ? plinth : wall);
                    i = end;
                }
                foreach (var region in ArchitectureFloorPlan.GetFloorPlanRoofRegions(body)) builder.LocalBox(frame, region.Rect.X0, region.Bottom, region.Rect.Z0, region.Rect.X1, region.Top, region.Rect.Z1, roof);
            }
            else LegacyBuilding(builder, b, wall, roof);
            return builder.Build(b.Name + " · 远景");
        }

        static bool SameRects(List<CoreRect> a, List<CoreRect> b) => a.Count == b.Count && a.Zip(b, (x, y) => x.X0 == y.X0 && x.X1 == y.X1 && x.Z0 == y.Z0 && x.Z1 == y.Z1).All(s => s);

        /// <summary>Buildings without a shared floor plan (天枢阁, pavilions): stepped tiers.</summary>
        static void LegacyBuilding(GameMeshBuilder builder, Building b, Color wall, Color roof)
        {
            var frame = GameMeshBuilder.GameFrame(b.Position.X, b.Position.Y + .6, b.Position.Z, b.Rotation);
            double storey = b.Height / b.Floors;
            if (b.Kind == "pavilion")
            {
                foreach (var x in new[] { -b.Width * .4, b.Width * .4 }) foreach (var z in new[] { -b.Depth * .4, b.Depth * .4 }) builder.LocalBox(frame, x - .6, 0, z - .6, x + .6, b.Height * .8, z + .6, Space.Hex("#7a5236"));
                builder.LocalBox(frame, -b.Width / 2 - 1, b.Height * .78, -b.Depth / 2 - 1, b.Width / 2 + 1, b.Height * .78 + 1.2, b.Depth / 2 + 1, roof);
                builder.LocalBox(frame, -b.Width * .25, b.Height + 1.6, -b.Depth * .25, b.Width * .25, b.Height + 2.6, b.Depth * .25, roof);
                return;
            }
            for (int floor = 0; floor < b.Floors; floor++)
            {
                var f = Access.GetFloorDimensions(b, floor);
                builder.LocalBox(frame, -f.Width / 2, floor * storey, -f.Depth / 2, f.Width / 2, (floor + 1) * storey, f.Depth / 2, wall);
                if (floor == b.Floors - 1 || Access.GetFloorDimensions(b, floor + 1).Width < f.Width)
                    builder.LocalBox(frame, -f.Width / 2 - 1.2, (floor + 1) * storey - .2, -f.Depth / 2 - 1.2, f.Width / 2 + 1.2, (floor + 1) * storey + .6, f.Depth / 2 + 1.2, roof);
            }
        }

        public sealed class NearBuildingMeshes { public Mesh Solid, Glass; }

        /// <summary>Walkable detail: slabs, wall panels, glass, stairs, roofs and fixtures
        /// not shown by a studio model.</summary>
        public static NearBuildingMeshes NearBuilding(Building b, IReadOnlyDictionary<string, StudioAssetBounds> studioAssets)
        {
            var solid = new GameMeshBuilder(); var glass = new GameMeshBuilder();
            var frame = GameMeshBuilder.GameFrame(b.Position.X, b.Position.Y + .6, b.Position.Z, b.Rotation);
            Color wall = Space.Hex(WallColor(b)), stone = Space.Hex("#aaa38b"), wood = Space.Hex("#98704d"), roof = Space.Hex(b.CommercialGeometryRevision == 1 ? "#344f51" : "#3f4f4c"), pane = Space.Hex("#7fa3a6"), stair = Space.Hex("#a39a83"), furniture = Space.Hex("#846346"), linen = Space.Hex("#d7d0b9");
            var body = ArchitectureFloorPlan.GetBuildingBody(b);
            if (body == null) { LegacyBuilding(solid, b, wall, roof); return new NearBuildingMeshes { Solid = solid.Build(b.Name), Glass = null }; }
            foreach (var plan in body.FloorPlans)
            {
                foreach (var r in ArchitectureFloorPlan.GetFloorPlanSlabRegions(plan)) solid.LocalBox(frame, r.X0, plan.Y - .2, r.Z0, r.X1, plan.Y, r.Z1, plan.Floor <= 0 ? stone : wood, bottom: true);
                foreach (var panel in ArchitectureFloorPlan.WallPanels(plan))
                {
                    var r = panel.Rect;
                    if (panel.Kind == "glass") glass.LocalBox(frame, r.X0, plan.Y + panel.Bottom, r.Z0, r.X1, plan.Y + panel.Top, r.Z1, pane);
                    else solid.LocalBox(frame, r.X0, plan.Y + panel.Bottom, r.Z0, r.X1, plan.Y + panel.Top, r.Z1, plan.Floor < 0 ? stone : wall);
                }
                foreach (var s in plan.StairTreads.Concat(plan.StairLandings)) solid.LocalBox(frame, s.Rect.X0, s.Bottom, s.Rect.Z0, s.Rect.X1, s.Top, s.Rect.Z1, stair);
                foreach (var f in plan.Fixtures)
                {
                    if (StudioPropLayout.DressesFixture(f, b.Kind, studioAssets)) continue;
                    var r = f.Rect;
                    solid.LocalBox(frame, r.X0, plan.Y + f.Bottom, r.Z0, r.X1, plan.Y + f.Top - (f.Kind == "bed" ? .2 : 0), r.Z1, furniture);
                    if (f.Kind == "bed") solid.LocalBox(frame, r.X0 + .2, plan.Y + f.Top - .2, r.Z0 + .2, r.X1 - .2, plan.Y + f.Top, r.Z1 - .2, linen);
                }
            }
            foreach (var region in ArchitectureFloorPlan.GetFloorPlanRoofRegions(body))
            {
                var r = region.Rect;
                if (region.Kind != "gable") { solid.LocalBox(frame, r.X0, region.Bottom, r.Z0, r.X1, region.Top, r.Z1, roof); continue; }
                solid.LocalBox(frame, r.X0, region.Bottom, r.Z0, r.X1, region.Bottom + .4, r.Z1, roof);
                GableRidge(solid, frame, region, roof);
            }
            return new NearBuildingMeshes { Solid = solid.Build(b.Name), Glass = glass.VertexCount > 0 ? glass.Build(b.Name + " · 玻璃") : null };
        }

        /// <summary>Triangular prism whose height follows the shared roof support profile.</summary>
        static void GableRidge(GameMeshBuilder builder, Matrix4x4 frame, RoofRegion region, Color color)
        {
            var r = region.Rect; double y0 = region.Bottom + .4, y1 = region.Bottom + 1.2;
            Vector3 P(double x, double y, double z) => frame.MultiplyPoint3x4(new Vector3((float)x, (float)y, (float)z));
            if (region.GableAxis == "x")
            {
                double mid = (r.X0 + r.X1) / 2;
                Vector3 a0 = P(r.X0, y0, r.Z0), b0 = P(mid, y1, r.Z0), c0 = P(r.X1, y0, r.Z0), a1 = P(r.X0, y0, r.Z1), b1 = P(mid, y1, r.Z1), c1 = P(r.X1, y0, r.Z1);
                var inside = (a0 + b0 + c0 + a1 + b1 + c1) / 6;
                builder.QuadOutward(a0, a1, b1, b0, inside, color); builder.QuadOutward(b0, b1, c1, c0, inside, color);
                builder.TriangleOutward(a0, b0, c0, inside, color); builder.TriangleOutward(c1, b1, a1, inside, color);
            }
            else
            {
                double mid = (r.Z0 + r.Z1) / 2;
                Vector3 a0 = P(r.X0, y0, r.Z0), b0 = P(r.X0, y1, mid), c0 = P(r.X0, y0, r.Z1), a1 = P(r.X1, y0, r.Z0), b1 = P(r.X1, y1, mid), c1 = P(r.X1, y0, r.Z1);
                var inside = (a0 + b0 + c0 + a1 + b1 + c1) / 6;
                builder.QuadOutward(a0, b0, b1, a1, inside, color); builder.QuadOutward(b0, c0, c1, b1, inside, color);
                builder.TriangleOutward(c0, b0, a0, inside, color); builder.TriangleOutward(a1, b1, c1, inside, color);
            }
        }
    }
}
