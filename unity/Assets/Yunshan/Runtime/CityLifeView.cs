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
        readonly InstancedBoxes bodies, lamps, voxels;
        readonly Dictionary<string, Motion> motion = new Dictionary<string, Motion>();
        readonly Dictionary<string, SimFrame.Citizen> previousCitizens = new Dictionary<string, SimFrame.Citizen>();
        readonly Dictionary<string, SimFrame.Vehicle> previousVehicles = new Dictionary<string, SimFrame.Vehicle>();
        readonly LineRenderer navigation;
        SimFrame indexed;
        public int Residents { get; private set; }

        public CityLifeView(WorldDefinition world, Transform parent)
        {
            this.world = world;
            foreach (var e in world.Edges) edges[e.Id] = e;
            foreach (var n in world.Nodes) if (n.Station) stations.Add(n);
            var shader = Shader.Find("Yunshan/InstancedColor");
            if (shader == null) shader = Shader.Find("Standard");
            bodies = new InstancedBoxes(new Material(shader) { name = "云山 · 居民与载具" });
            var glow = new Material(shader) { name = "云山 · 信号灯" }; glow.SetFloat("_Emission", 1.6f);
            lamps = new InstancedBoxes(glow) { CastShadows = false };
            voxels = new InstancedBoxes(new Material(shader) { name = "云山 · 体素" });
            var line = new GameObject("导航金线", typeof(LineRenderer)); line.transform.SetParent(parent, false);
            navigation = line.GetComponent<LineRenderer>();
            navigation.material = new Material(Shader.Find("Sprites/Default")); navigation.widthMultiplier = .35f;
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
            bodies.Clear(); lamps.Clear(); voxels.Clear();
            DrawCitizens(frame, t, camera);
            DrawVehicles(frame, t, camera);
            DrawSignals(frame);
            DrawAircraft(frame);
            foreach (var v in session.Voxels) voxels.Add(Space.ToUnity(v.X, v.Y + .1, v.Z), Quaternion.identity, Vector3.one * .2f, Space.Hex("#d0b784"));
            bodies.Draw(); lamps.Draw(); voxels.Draw();
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
                bool near = !dead && range <= 110;
                var parts = CitizenAppearance.Describe(c.Id, c.Role ?? "", c.Age, new CitizenAppearance.Pose { Yaw = yaw, Phase = phase, Walking = walking, Seated = seated, Dead = dead }, near);
                double cy = Math.Cos(yaw), sy = Math.Sin(yaw);
                var yawRotation = Space.Yaw(yaw);
                foreach (var part in parts)
                {
                    double x = part.Position.X, y = part.Position.Y, z = part.Position.Z;
                    if (part.Pivot != null && part.RotationX != 0)
                    {
                        double py = y - part.Pivot.Y, pz = z - part.Pivot.Z, c2 = Math.Cos(part.RotationX), s2 = Math.Sin(part.RotationX);
                        y = part.Pivot.Y + py * c2 - pz * s2; z = part.Pivot.Z + py * s2 + pz * c2;
                    }
                    if (dead) { double priorY = y; y = .1 - z; z = priorY; }
                    var world = Space.ToUnity(position.X + x * cy + z * sy, position.Y + y, position.Z + z * cy - x * sy);
                    var rotation = yawRotation * Quaternion.AngleAxis((float)((part.RotationX + (dead ? Math.PI / 2 : 0)) * Mathf.Rad2Deg), Vector3.right);
                    bodies.Add(world, rotation, new Vector3((float)part.Size.X, (float)part.Size.Y, (float)part.Size.Z), Space.Hex(part.Color));
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
