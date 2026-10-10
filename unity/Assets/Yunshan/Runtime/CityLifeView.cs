using System;
using System.Collections.Generic;
using UnityEngine;
using Yunshan.Core;
using Yunshan.Core.Host;

namespace Yunshan.Runtime
{
    /// <summary>Draws the simulation's residents, vehicles, station signals,
    /// aircraft, placed voxels and the navigation line from host frames. Read
    /// only: poses follow actual displacement between frames (no independent
    /// walk clock), as src/rendering/citizen-appearance.ts does.</summary>
    public sealed class CityLifeView
    {
        sealed class Motion { public Vec3 Position; public double Yaw, Phase; }
        readonly WorldDefinition world;
        readonly Dictionary<string, NetworkEdge> edges = new Dictionary<string, NetworkEdge>();
        readonly List<NetworkNode> stations = new List<NetworkNode>();
        readonly Dictionary<string, List<MarketCounter>> counters = new Dictionary<string, List<MarketCounter>>();
        readonly InstancedBoxes bodies, lamps, voxels, faces;
        readonly Dictionary<string, Motion> motion = new Dictionary<string, Motion>();
        readonly Dictionary<string, List<CitizenAppearance.Part>> templates = new Dictionary<string, List<CitizenAppearance.Part>>();
        readonly Dictionary<string, SimFrame.Citizen> previousCitizens = new Dictionary<string, SimFrame.Citizen>();
        readonly Dictionary<string, SimFrame.Vehicle> previousVehicles = new Dictionary<string, SimFrame.Vehicle>();
        readonly LineRenderer navigation;
        SimFrame indexed;
        public int Residents { get; private set; }
        /// <summary>Residents drawn by StudioCharacterView (left out of the box residents).</summary>
        public HashSet<string> Modelled = new HashSet<string>();
        /// <summary>The interpolated position, yaw and displacement-driven walk phase of a resident.</summary>
        public bool TryMotion(string id, out Vec3 position, out double yaw, out double phase)
        {
            if (motion.TryGetValue(id, out var m)) { position = m.Position; yaw = m.Yaw; phase = m.Phase; return true; }
            position = null; yaw = phase = 0; return false;
        }

        public CityLifeView(WorldDefinition world, Transform parent)
        {
            this.world = world;
            foreach (var e in world.Edges) edges[e.Id] = e;
            foreach (var n in world.Nodes) if (n.Station) stations.Add(n);
            foreach (var b in world.Buildings) if (b.Kind == "market") counters[b.Id] = SiteFixtures.MarketCounters(world, b);
            var shader = Shader.Find("Yunshan/InstancedColor");
            if (shader == null) shader = Shader.Find("Standard");
            bodies = new InstancedBoxes(new Material(shader) { name = "云山 · 居民与载具" });
            var glow = new Material(shader) { name = "云山 · 信号灯" }; glow.SetFloat("_Emission", 1.6f);
            lamps = new InstancedBoxes(glow) { CastShadows = false };
            voxels = new InstancedBoxes(new Material(shader) { name = "云山 · 体素" });
            var faceShader = Shader.Find("Yunshan/CitizenFace");
            if (faceShader != null)
            {
                var atlas = new Texture2D(CitizenFaceTexture.Width, CitizenFaceTexture.Height, TextureFormat.RGBA32, false, false) { name = "居民面孔图集", filterMode = FilterMode.Point, wrapMode = TextureWrapMode.Clamp };
                atlas.LoadRawTextureData(CitizenFaceTexture.Pixels()); atlas.Apply();
                var faceMaterial = new Material(faceShader) { name = "云山 · 居民面孔" }; faceMaterial.SetTexture("_FaceTex", atlas);
                faces = new InstancedBoxes(faceMaterial, InstancedBoxes.FaceCube(), "_FaceStyle");
            }
            var line = new GameObject("导航金线", typeof(LineRenderer)); line.transform.SetParent(parent, false);
            navigation = line.GetComponent<LineRenderer>();
            var overlay = Shader.Find("Yunshan/UnlitColor"); if (overlay == null) overlay = Shader.Find("Sprites/Default");
            navigation.material = new Material(overlay); navigation.widthMultiplier = .35f;
            navigation.startColor = navigation.endColor = new Color(.92f, .76f, .43f, .75f); navigation.positionCount = 0;
        }

        static Vec3 Lerp(Vec3 a, Vec3 b, double t) => new Vec3(a.X + (b.X - a.X) * t, a.Y + (b.Y - a.Y) * t, a.Z + (b.Z - a.Z) * t);
        static double Distance(Vec3 a, Vec3 b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y) + (a.Z - b.Z) * (a.Z - b.Z));

        public void Draw(SimSession session, Vec3 camera)
        {
            var frame = session.Frame; if (frame == null) return;
            if (!ReferenceEquals(indexed, frame))
            {
                previousCitizens.Clear(); previousVehicles.Clear();
                var prior = session.PreviousFrame;
                if (prior != null) { foreach (var c in prior.Citizens) previousCitizens[c.Id] = c; foreach (var v in prior.Vehicles) previousVehicles[v.Id] = v; }
                indexed = frame;
            }
            double t = Mathf.Clamp01((Time.unscaledTime - session.FrameArrivedAt) / session.FrameInterval);
            bodies.Clear(); lamps.Clear(); voxels.Clear(); faces?.Clear();
            DrawCitizens(frame, t, camera);
            DrawVehicles(frame, t, camera);
            DrawSignals(frame);
            DrawAircraft(frame);
            DrawMarketGoods(frame, camera);
            DrawClosures(frame);
            foreach (var v in session.Voxels) voxels.Add(Space.ToUnity(v.X, v.Y + .1, v.Z), Quaternion.identity, Vector3.one * .2f, Space.Hex("#d0b784"));
            bodies.Draw(); lamps.Draw(); voxels.Draw(); faces?.Draw();
            navigation.positionCount = frame.NavigationPoints.Count;
            for (int i = 0; i < frame.NavigationPoints.Count; i++) { var p = frame.NavigationPoints[i]; navigation.SetPosition(i, Space.ToUnity(p.X, p.Y + .3, p.Z)); }
        }

        void DrawCitizens(SimFrame frame, double t, Vec3 camera)
        {
            var seen = new HashSet<string>(); Residents = 0;
            foreach (var c in frame.Citizens)
            {
                seen.Add(c.Id);
                var position = previousCitizens.TryGetValue(c.Id, out var before) && Distance(before.Position, c.Position) < 30 ? Lerp(before.Position, c.Position, t) : c.Position;
                bool dead = !c.Alive, seated = c.Seated, walking = c.State == "moving" && !seated && !dead;
                motion.TryGetValue(c.Id, out var previous);
                double dx = previous != null ? position.X - previous.Position.X : 0, dz = previous != null ? position.Z - previous.Position.Z : 0, travel = Math.Sqrt(dx * dx + dz * dz);
                double initialYaw = c.Next != null ? Math.Atan2(c.Next.X - c.Position.X, c.Next.Z - c.Position.Z) : CitizenAppearance.Hash(c.Id) % 628 / 100.0;
                double yaw = travel > .001 && travel < 50 ? Math.Atan2(dx, dz) : previous?.Yaw ?? initialYaw;
                double phase = (previous?.Phase ?? 0) + (walking && !frame.Paused && travel < 50 ? travel * Math.PI / 1.1 : 0);
                motion[c.Id] = new Motion { Position = position, Yaw = yaw, Phase = phase };
                double range = Distance(position, camera);
                if (Modelled.Contains(c.Id)) { Residents++; continue; }
                bool near = !dead && range <= 110;
                // Parts are cached per appearance; a walking stride only scales the
                // template's swing (taken at phase π/2) by sin(phase).
                string key = $"{c.Id}|{c.Role}|{c.Age}|{(near ? 1 : 0)}{(walking ? 1 : 0)}{(seated ? 1 : 0)}{(dead ? 1 : 0)}";
                if (!templates.TryGetValue(key, out var parts))
                {
                    if (templates.Count > 4096) templates.Clear();
                    parts = CitizenAppearance.Describe(c.Id, c.Role ?? "", c.Age, new CitizenAppearance.Pose { Phase = Math.PI / 2, Walking = walking, Seated = seated, Dead = dead }, near);
                    templates[key] = parts;
                }
                double stride = walking ? Math.Sin(phase) : 1;
                double cy = Math.Cos(yaw), sy = Math.Sin(yaw);
                var yawRotation = Space.Yaw(yaw);
                foreach (var part in parts)
                {
                    double x = part.Position.X, y = part.Position.Y, z = part.Position.Z, rotationX = part.RotationX * stride;
                    if (part.Pivot != null && rotationX != 0)
                    {
                        double py = y - part.Pivot.Y, pz = z - part.Pivot.Z, c2 = Math.Cos(rotationX), s2 = Math.Sin(rotationX);
                        y = part.Pivot.Y + py * c2 - pz * s2; z = part.Pivot.Z + py * s2 + pz * c2;
                    }
                    if (dead) { double priorY = y; y = .1 - z; z = priorY; }
                    var world = Space.ToUnity(position.X + x * cy + z * sy, position.Y + y, position.Z + z * cy - x * sy);
                    var rotation = yawRotation * Quaternion.AngleAxis((float)((rotationX + (dead ? Math.PI / 2 : 0)) * Mathf.Rad2Deg), Vector3.right);
                    var size = new Vector3((float)part.Size.X, (float)part.Size.Y, (float)part.Size.Z);
                    // Faces within the web's balanced face range (85 m) use the ink atlas.
                    if (part.Face && faces != null && range <= 85) faces.Add(world, rotation, size, Space.Hex(part.Color), CitizenAppearance.FaceStyle(c.Age, c.Mood, c.Stress));
                    else bodies.Add(world, rotation, size, Space.Hex(part.Color));
                }
                Residents++;
            }
            if (motion.Count > seen.Count * 2 + 64) { var stale = new List<string>(); foreach (var id in motion.Keys) if (!seen.Contains(id)) stale.Add(id); foreach (var id in stale) motion.Remove(id); }
        }

        void DrawVehicles(SimFrame frame, double t, Vec3 camera)
        {
            foreach (var v in frame.Vehicles)
            {
                if (v.Id == frame.Player.VehicleId && Distance(v.Position, camera) < 25) continue;
                var p = previousVehicles.TryGetValue(v.Id, out var before) && Distance(before.Position, v.Position) < 40 ? Lerp(before.Position, v.Position, t) : v.Position;
                double direction = 0;
                if (edges.TryGetValue(v.EdgeId, out var edge) && edge.Points.Count > 1)
                {
                    double progress = Math.Max(0, Math.Min(.99999, v.Progress));
                    int i = Math.Min(edge.Points.Count - 2, (int)Math.Floor(progress * (edge.Points.Count - 1)));
                    var a = edge.Points[i]; var b = edge.Points[i + 1];
                    direction = Math.Atan2(b.X - a.X, b.Z - a.Z) + (v.Direction < 0 ? Math.PI : 0);
                }
                bool flight = v.Kind == "flight", train = v.Kind == "maglev" || v.Kind == "lightRail", boat = v.Kind == "ferry";
                double length = flight ? 17 : train ? 16 : boat ? 11 : v.Kind == "cable" ? 3.5 : 5.5, width = flight ? 14 : train ? 3.3 : boat ? 4.5 : 2.5, lift = v.Kind == "cable" ? 2.5 : 0;
                var rotation = Space.Yaw(direction);
                bodies.Add(Space.ToUnity(p.X, p.Y + 1.1 + lift, p.Z), rotation, new Vector3((float)width, flight ? .8f : 1.5f, (float)length), Space.Hex(flight ? "#d5c7aa" : train ? "#d0b985" : "#a77851"));
                bodies.Add(Space.ToUnity(p.X, p.Y + 2.1 + lift, p.Z), rotation, new Vector3((float)(flight ? 3 : width * .85), flight ? 1.8f : .8f, (float)(length * .68)), Space.Hex("#517f82"));
                bodies.Add(Space.ToUnity(p.X, p.Y + .6 + lift, p.Z), rotation, new Vector3((float)(width + .25), .2f, (float)(length * .85)), Space.Hex("#3f6f73"));
            }
        }

        /// <summary>Web MarketGoodsPool: up to 8 real food units per open market,
        /// two rows on its counters, within 110 m of the camera.</summary>
        void DrawMarketGoods(SimFrame frame, Vec3 camera)
        {
            foreach (var pair in frame.MarketUnits)
            {
                if (!counters.TryGetValue(pair.Key, out var list) || list.Count == 0) continue;
                for (int unit = 0; unit < pair.Value; unit++)
                {
                    var counter = list[unit % list.Count];
                    if (camera != null && Distance(camera, counter.Position) > 110) continue;
                    int columns = Math.Max(1, Math.Min(4, (int)Math.Floor((counter.Size.X - .4) / .6) + 1)), slot = unit / list.Count, row = slot / columns;
                    if (row > 1) continue;
                    double x = (slot % columns - (columns - 1) / 2.0) * .6, z = (row - .5) * .4, c = Math.Cos(counter.Rotation), s = Math.Sin(counter.Rotation);
                    var position = Space.ToUnity(counter.Position.X + x * c + z * s, counter.Position.Y + counter.Size.Y / 2 + .1, counter.Position.Z + z * c - x * s);
                    bodies.Add(position, Space.Yaw(counter.Rotation), new Vector3(.4f, .2f, .4f), Space.Hex(unit % 2 == 1 ? "#d5bb8d" : "#b9c4a4"));
                }
            }
        }

        /// <summary>Web RoadClosureOverlay: a warning beam on two feet near each end.</summary>
        void DrawClosures(SimFrame frame)
        {
            foreach (var id in frame.ClosedEdges)
            {
                if (!edges.TryGetValue(id, out var edge) || edge.Points.Count < 2) continue;
                double length = Math.Max(1, edge.Length);
                foreach (var progress in new[] { Math.Min(.02, 2 / length), Math.Max(.98, 1 - 2 / length) })
                {
                    var at = World.SamplePolyline(edge.Points, progress); var before = World.SamplePolyline(edge.Points, Math.Max(0, progress - .001)); var after = World.SamplePolyline(edge.Points, Math.Min(1, progress + .001));
                    var rotation = Space.Yaw(Math.Atan2(after.X - before.X, after.Z - before.Z));
                    double width = Math.Min(10, TransportGeometry.DeckWidth(edge) - 1);
                    var origin = Space.ToUnity(at);
                    bodies.Add(origin + rotation * new Vector3(0, .9f, 0), rotation, new Vector3((float)width, .26f, .18f), Space.Hex("#dfad50"));
                    foreach (var x in new[] { -width * .4, width * .4 }) bodies.Add(origin + rotation * new Vector3(-(float)x, .45f, 0), rotation, new Vector3(.12f, .9f, .5f), Space.Hex("#3f423b"));
                }
            }
        }

        void DrawSignals(SimFrame frame)
        {
            var size = new Vector3(.7f, .55f, .35f);
            foreach (var node in stations)
            {
                frame.Signals.TryGetValue(node.Id, out var phase); bool known = frame.Signals.ContainsKey(node.Id);
                var p = node.Position;
                lamps.Add(Space.ToUnity(p.X + 12, p.Y + 3.9, p.Z + 11.4), Quaternion.identity, size, Space.Hex(known && phase == 0 ? "#ff6753" : "#210b0b"));
                lamps.Add(Space.ToUnity(p.X + 12, p.Y + 3.15, p.Z + 11.4), Quaternion.identity, size, Space.Hex(known && phase == 1 ? "#7ff0bd" : "#0a2018"));
            }
        }

        void DrawAircraft(SimFrame frame)
        {
            foreach (var a in frame.AircraftList)
            {
                if (a.Active) continue; // the player is in the cockpit
                bool jet = a.Kind == "jet"; var rotation = Space.Yaw(a.Yaw);
                bodies.Add(Space.ToUnity(a.Position.X, a.Position.Y + .4, a.Position.Z), rotation, jet ? new Vector3(14, .8f, 17) : new Vector3(2.4f, .7f, 2.4f), Space.Hex(jet ? "#7d8a86" : "#d5c7aa"));
                bodies.Add(Space.ToUnity(a.Position.X, a.Position.Y + 1.1, a.Position.Z), rotation, jet ? new Vector3(3, 1.8f, 11) : new Vector3(1.4f, .8f, 1.4f), Space.Hex("#517f82"));
            }
        }
    }
}
